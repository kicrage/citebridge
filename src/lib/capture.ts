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
  // コトバンクは 1 ページに複数の辞書の項目が並ぶ。選択範囲の直前にある項目の目印（id="w-数字"）を探す
  let entryAnchor: CapturedPage['entryAnchor'];
  if (/(^|\.)kotobank\.jp$/.test(location.hostname)) {
    const markers = Array.from(document.querySelectorAll<HTMLElement>('[id^="w-"]')).filter((e) => /^w-\d+$/.test(e.id));
    const sel = window.getSelection();
    const node = sel && sel.rangeCount > 0 && !sel.isCollapsed ? sel.anchorNode : null;
    let picked: HTMLElement | undefined;
    if (node) {
      for (const m of markers) if (m.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) picked = m;
    } else {
      for (const m of markers) if (m.getBoundingClientRect().top <= window.innerHeight * 0.4) picked = m;
      picked ??= markers[0];
    }
    if (picked) entryAnchor = { wid: picked.id.slice(2), from: node ? 'selection' : 'viewport' };
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
