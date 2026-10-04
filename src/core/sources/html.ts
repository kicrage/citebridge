import type { SourceResult } from '../model/record';
import type { SourceContext } from './http';
import { parsePageSnapshot, type MetaPairs, type PageSnapshot } from './pagemeta';

const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');

const attr = (tag: string, name: string) =>
  new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)?.slice(1).find((x) => x !== undefined);

/** DOMParser の無い環境（Service Worker・テスト）でも使える、HTML からの meta/JSON-LD 抽出 */
export function snapshotFromHtml(html: string, url: string): PageSnapshot {
  const head = html.slice(0, 400_000);
  const metas: MetaPairs = [];
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const k = attr(m[0], 'name') ?? attr(m[0], 'property');
    const v = attr(m[0], 'content');
    if (k && v !== undefined) metas.push([k.toLowerCase(), decode(v)]);
  }
  const jsonLd: unknown[] = [];
  for (const m of head.matchAll(/<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      jsonLd.push(JSON.parse(m[1]));
    } catch {
      /* 壊れた JSON-LD は無視 */
    }
  }
  const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? '').trim();
  const lang = /<html[^>]*\slang\s*=\s*["']?([\w-]+)/i.exec(head)?.[1];
  return { url, title, metas, jsonLd, lang };
}

export async function fetchHtmlMeta(url: string, ctx: SourceContext): Promise<SourceResult> {
  const html = await ctx.http.text(url, { headers: { Accept: 'text/html' } });
  const snap = snapshotFromHtml(html, url);
  return { source: 'page', record: parsePageSnapshot(snap), raw: snap };
}
