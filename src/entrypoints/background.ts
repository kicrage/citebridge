import { detectIds } from '@/core/ids/detect';
import { idKey, type DetectedId } from '@/core/ids/types';
import { mergeResults } from '@/core/merge/merge';
import type { Passage } from '@/core/model/passage';
import type { CiteRecord, SourceResult } from '@/core/model/record';
import { pageResult } from '@/core/sources/pagemeta';
import { resolveId } from '@/core/sources/resolve';
import { addClip, db, purgeExpiredRaw, saveRecord } from '@/db/dexie';
import { createCachedHttp } from '@/lib/cached-http';
import { collectPage, type CapturedPage } from '@/lib/capture';
import type { BgRequest, CaptureResponse, ResolveResponse } from '@/lib/messages';
import { loadSettings } from '@/lib/settings';

const MENU_PASSAGE = 'citebridge-save-passage';
const MENU_PAGE = 'citebridge-capture-page';

async function context(bypassCache = false) {
  const s = await loadSettings();
  return { http: createCachedHttp({ bypassCache }), mailto: s.mailto || undefined };
}

async function handleResolve(input: string, id: DetectedId | undefined, bypassCache: boolean): Promise<ResolveResponse> {
  if (!id) {
    const found = detectIds(input);
    if (!found.length) return { ok: false, error: '識別子として認識できませんでした（DOI・CRID・ISBN・NDL書誌ID・URL などを入力してください）' };
    // 推測しかできない（純数字など）場合は利用者に選んでもらう
    const exact = found.filter((d) => d.confidence === 'exact');
    if (!exact.length && found.length > 1) return { ok: true, candidates: found };
    id = exact[0] ?? found[0];
  }
  try {
    const { record, errors } = await resolveId(id, await context(bypassCache));
    await saveRecord(record, errors);
    return { ok: true, record, errors };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

/** ページの識別子のうち、正式なソースで引き直せるもの */
function primaryId(page: SourceResult, url: string): DetectedId | undefined {
  const fromUrl = detectIds(url).filter((d) => d.type !== 'url');
  const ids = page.record.ids ?? {};
  if (ids.doi) return { type: 'doi', value: ids.doi, confidence: 'exact' };
  return fromUrl[0];
}

async function capture(tabId: number, tab: { url?: string; title?: string } | undefined, selectionText?: string, withSelection = true): Promise<CaptureResponse> {
  let snap: CapturedPage;
  let injected = true;
  try {
    const [res] = await browser.scripting.executeScript({ target: { tabId }, func: collectPage });
    snap = res.result as CapturedPage;
  } catch {
    // Chrome 内蔵の PDF ビューアや、権限の無いページ（サイドパネルのボタンからは activeTab が付かない）
    if (!tab?.url || !/^https?:/.test(tab.url)) return { ok: false, error: 'このページからは取り込めません' };
    snap = { url: tab.url, title: tab.title ?? '', metas: [], jsonLd: [], selection: selectionText ?? '' };
    injected = false;
  }
  const page = pageResult(snap);
  // ページの中を読めなかったときは URL を Citoid に任せる
  const pid = primaryId(page, snap.url) ?? (injected ? undefined : ({ type: 'url', value: snap.url, confidence: 'exact' } as DetectedId));
  let record: CiteRecord;
  let errors: { source: string; message: string }[] = [];
  if (pid) {
    try {
      const r = await resolveId(pid, await context());
      record = mergeResults(r.record.key, [...r.results, page], ['user', 'jalc', 'crossref', 'cinii', 'ndl', 'citoid', 'page']);
      if (r.record.koma) record.koma = r.record.koma;
      errors = r.errors;
    } catch (e: any) {
      record = mergeResults(idKey(pid), [page], ['page']);
      errors = [{ source: pid.type, message: String(e?.message ?? e) }];
    }
  } else {
    record = mergeResults(idKey({ type: 'url', value: snap.url }), [page], ['page']);
  }
  record.url ??= snap.url;
  await saveRecord(record, errors);
  await addClip(record.key);

  let passageId: string | undefined;
  const text = (snap.selection || selectionText || '').trim();
  if (withSelection && text) {
    const koma = detectIds(snap.url).find((d) => d.type === 'ndldc')?.extra?.koma;
    const p: Passage = {
      id: crypto.randomUUID(),
      recordKey: record.key,
      text,
      ...(koma ? { page: String(koma), pageKind: 'koma' as const } : { pageKind: 'p' as const }),
      sourceUrl: snap.url,
      capturedAt: new Date().toISOString(),
    };
    await db.passages.put(p);
    passageId = p.id;
  }
  // サイドパネルに「いま取り込んだもの」を知らせる（ページ番号の入力を促す）
  await browser.storage.local.set({ focus: { recordKey: record.key, passageId, at: Date.now() } });
  return { ok: true, recordKey: record.key, passageId };
}

function openPanel(windowId?: number) {
  // ユーザー操作の直後に同期的に呼ぶ必要がある（await を挟むと拒否される）
  if (windowId !== undefined) browser.sidePanel.open({ windowId }).catch(() => undefined);
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({ id: MENU_PASSAGE, title: '選択範囲を一節として保存', contexts: ['selection'] });
    browser.contextMenus.create({ id: MENU_PAGE, title: 'このページを出典クリップボードに取り込む', contexts: ['page'] });
    purgeExpiredRaw().catch(() => undefined);
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id) return;
    openPanel(tab.windowId);
    if (info.menuItemId === MENU_PASSAGE) capture(tab.id, tab, info.selectionText, true);
    else if (info.menuItemId === MENU_PAGE) capture(tab.id, tab, undefined, false);
  });

  browser.commands.onCommand.addListener((command, tab) => {
    if (command !== 'save-passage' || !tab?.id) return;
    openPanel(tab.windowId);
    capture(tab.id, tab, undefined, true);
  });

  browser.runtime.onMessage.addListener((msg: BgRequest, _sender, sendResponse) => {
    if (msg?.type === 'resolve') {
      handleResolve(msg.input, msg.id, !!msg.bypassCache).then(sendResponse);
      return true;
    }
    if (msg?.type === 'capture-tab') {
      browser.tabs
        .get(msg.tabId)
        .then((tab) => capture(msg.tabId, tab, undefined, msg.withSelection))
        .catch((e) => ({ ok: false, error: String(e?.message ?? e) }))
        .then(sendResponse);
      return true;
    }
  });
});
