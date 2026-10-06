import { KOBE_HANDLE_PREFIX } from '../ids/detect';
import type { CiteRecord, Name, SourceResult } from '../model/record';
import { parseDate } from '../transforms/dates';
import { parseName } from '../transforms/names';
import { splitSubtitle } from '../transforms/numbers';
import { decode } from './html';
import { NotFoundError, type SourceContext } from './http';

/**
 * 神戸大学附属図書館 新聞記事文庫（https://da.lib.kobe-u.ac.jp/da/np/{メタデータID}/）。
 * citation_* 等の meta は無く、書誌は本文の表（<th>項目名</th><td>…metadata_value…</td>）にだけある。
 * 同じ項目が複数行になる（切抜帳など）ので、項目名 → 値の配列にする。
 */
export function parseKobeTable(html: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let label: string | undefined;
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const th = /<th\b[^>]*>([\s\S]*?)<\/th>/i.exec(row[1]);
    if (th) label = decode(th[1].replace(/<[^>]+>/g, '')).trim();
    if (!label) continue;
    for (const td of row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)) {
      const v = decode(td[1].replace(/<[^>]+>/g, ' ')).replace(/[\s　]+/g, ' ').trim();
      if (v) out.set(label, [...(out.get(label) ?? []), v]);
    }
  }
  return out;
}

/** 新聞記事文庫の記事ページの HTML から書誌を取り出す。記事ページでなければ undefined */
export function parseKobeNp(html: string, id: string): Partial<CiteRecord> | undefined {
  const t = parseKobeTable(html);
  const first = (k: string) => t.get(k)?.[0];
  const rawTitle = first('タイトル');
  if (!rawTitle) return undefined;
  // 見出しは「主見出し : 副見出し」の形（連載は「（一〜五）」が主見出しに付く）
  const { title, subtitle } = splitSubtitle(rawTitle);

  // 著者名は「大屋霊城:大阪府技師」（氏名:肩書）
  const authors: Name[] = (t.get('著者名') ?? []).map((a) => parseName(a.split(/[:：]/)[0]).name);

  // 出版日は連載だと「1922-12-21/1922-12-28」の範囲。出典の date= には初回の日付を使う
  const issued = parseDate(first('出版日')?.split('/')[0]) ?? parseDate(first('出版年（和暦）'));

  return {
    type: 'article-newspaper',
    ids: { kobenp: id },
    title: { ja: title },
    ...(subtitle ? { subtitle: { ja: subtitle } } : {}),
    container: first('新聞名') ? { ja: first('新聞名')! } : undefined,
    authors,
    issued,
    language: 'ja',
  };
}

/** ハンドル（20.500.14094/0100165761）→ メタデータID。神戸大学以外のハンドルなら undefined */
export function kobeIdFromHandle(h: string): string | undefined {
  const [prefix, suffix] = h.split('/');
  return prefix === KOBE_HANDLE_PREFIX && /^\d{10}$/.test(suffix ?? '') ? suffix : undefined;
}

export const kobeNpUrl = (id: string) => `https://da.lib.kobe-u.ac.jp/da/np/${id}/`;

export async function fetchKobeNp(id: string, ctx: SourceContext): Promise<SourceResult> {
  const raw = await ctx.http.text(kobeNpUrl(id), { headers: { Accept: 'text/html' } });
  const record = parseKobeNp(raw, id);
  if (!record) throw new NotFoundError(`新聞記事文庫: ${id}`);
  return { source: 'kobe', record, raw };
}
