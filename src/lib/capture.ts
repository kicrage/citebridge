import type { PageSnapshot } from '@/core/sources/pagemeta';

export interface CapturedPage extends PageSnapshot {
  selection: string;
  /** コトバンクで、選択範囲（無ければ画面に見えている位置）の項目の #w- の数字 */
  entryAnchor?: { wid: string; from: 'selection' | 'viewport' };
}

/**
 * 閲覧中のタブに注入して meta 要素・JSON-LD・選択範囲を集める。
 * scripting.executeScript で関数ごと送られるので、外の変数や import を参照してはならない。
 */
export function collectPage(): CapturedPage {
  const metas: [string, string][] = [];
  document.querySelectorAll('meta[name], meta[property]').forEach((m) => {
    const k = m.getAttribute('name') ?? m.getAttribute('property');
    const v = m.getAttribute('content');
    if (k && v !== null) metas.push([k.toLowerCase(), v]);
  });
  const jsonLd: unknown[] = [];
  document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    try {
      jsonLd.push(JSON.parse(s.textContent ?? ''));
    } catch {
      /* 壊れた JSON-LD は無視 */
    }
  });
  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
  if (canonical) metas.push(['og:url', canonical]);
  // meta に無く本文の表にだけある NCID（機関リポジトリの「識別子タイプ NCID ／ 関連識別子 AN00029633」）
  const ncid = /NCID[\s\S]{0,40}?\b([A-Z]{2}\d{7}[\dX])\b/.exec(document.body?.innerText ?? '')?.[1];
  if (ncid) metas.push(['citebridge:ncid', ncid]);
  // コトバンクは 1 ページに複数の辞書の項目が並ぶ。選択範囲（無ければ画面の上から 4 割の位置）がどの項目かを調べる。
  // 別の辞書の項目に飛ばないよう、基準の位置を含む <article>（辞書ごとのまとまり）の中で目印（id="w-数字"）を探す
  let entryAnchor: CapturedPage['entryAnchor'];
  if (/(^|\.)kotobank\.jp$/.test(location.hostname)) {
    const sel = window.getSelection();
    const node = sel && sel.rangeCount > 0 && !sel.isCollapsed ? sel.anchorNode : null;
    const base = node ? (node.nodeType === 1 ? (node as Element) : node.parentElement) : document.elementFromPoint(window.innerWidth / 2, window.innerHeight * 0.4);
    const art = base?.closest('article') ?? null;
    let wid: string | undefined;
    if (art?.id === 'sekai_refs') {
      // 「世界大百科事典（旧版）内の〇〇の言及」は目印が無い。何番目の抜粋か（ref1, ref2…）
      const blocks = Array.from(art.querySelectorAll('.ex'));
      wid = `ref${Math.max(0, blocks.findIndex((x) => x.contains(base))) + 1}`;
    } else {
      const markers = Array.from((art ?? document).querySelectorAll<HTMLElement>('[id^="w-"]')).filter((e) => /^w-\d+$/.test(e.id));
      let picked: HTMLElement | undefined;
      if (node) {
        for (const m of markers) if (m.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) picked = m;
      } else {
        for (const m of markers) if (m.getBoundingClientRect().top <= window.innerHeight * 0.4) picked = m;
      }
      picked ??= markers[0];
      if (picked) wid = picked.id.slice(2);
    }
    if (wid) entryAnchor = { wid, from: node ? 'selection' : 'viewport' };
  }
  return {
    url: location.href,
    title: document.title,
    metas,
    jsonLd,
    lang: document.documentElement.lang || undefined,
    selection: String(window.getSelection() ?? '').trim(),
    ...(entryAnchor ? { entryAnchor } : {}),
  };
}
