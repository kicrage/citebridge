import type { PageSnapshot } from '@/core/sources/pagemeta';

export interface CapturedPage extends PageSnapshot {
  selection: string;
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
  return {
    url: location.href,
    title: document.title,
    metas,
    jsonLd,
    lang: document.documentElement.lang || undefined,
    selection: String(window.getSelection() ?? '').trim(),
  };
}
