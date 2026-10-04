import type { CiteRecord, Multilingual, Name, SourceResult, WorkType } from '../model/record';
import { parseDate } from '../transforms/dates';
import { joinPages } from '../transforms/numbers';
import type { SourceContext } from './http';

/** JaLC content_type → 資料種別 */
const TYPE_MAP: Record<string, WorkType> = {
  JA: 'article-journal',
  BK: 'book',
  RD: 'dataset',
  EL: 'other',
  GD: 'other',
};

/** article_type 等による補正（紀要・学位論文など） */
function refineType(d: any): WorkType {
  const t = TYPE_MAP[d.content_type] ?? 'other';
  if (t === 'book' && d.title_list && d.book_title_list) return 'chapter';
  return t;
}

function multi(list: any[] | undefined, key: string): Multilingual | undefined {
  if (!list?.length) return undefined;
  const out: Multilingual = {};
  for (const it of list) {
    const v = it[key];
    if (!v) continue;
    if (it.type && it.type !== 'full') continue; // 略誌名を除く
    const lang = it.lang ?? 'und';
    if (!out[lang]) out[lang] = String(v).trim();
  }
  return Object.keys(out).length ? out : undefined;
}

/** creator_list の各人について、日本語表記を優先しつつ姓名を取る */
function creators(list: any[] | undefined, prefer = 'ja'): Name[] {
  if (!list) return [];
  return [...list]
    .sort((a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0))
    .map((c) => {
      const names: any[] = c.names ?? [];
      const n = names.find((x) => x.lang === prefer) ?? names[0];
      if (!n) return { literal: '' };
      if (c.type === 'organization' || (!n.first_name && n.last_name))
        return { literal: n.last_name ?? n.name ?? '' };
      return { family: n.last_name, given: n.first_name };
    })
    .filter((n) => n.literal !== '');
}

export function parseJalc(d: any): Partial<CiteRecord> {
  const title = multi(d.title_list, 'title');
  const lang: string | undefined = d.content_language;
  const pd = d.publication_date ?? {};
  const issued = parseDate(
    [pd.publication_year, pd.publication_month, pd.publication_day].filter(Boolean).join('-') || d.date,
  );
  const ncid = d.journal_id_list?.find((j: any) => j.type === 'NCID')?.journal_id;
  const issn = d.journal_id_list?.find((j: any) => /ISSN/.test(j.type))?.journal_id;
  const isbn = d.isbn_list?.[0]?.isbn ?? d.isbn;
  return {
    type: refineType(d),
    ids: {
      doi: d.doi,
      ...(ncid ? { ncid } : {}),
      ...(issn ? { issn } : {}),
      ...(isbn ? { isbn } : {}),
    },
    title,
    container: multi(d.journal_title_name_list, 'journal_title_name') ?? multi(d.book_title_list, 'book_title'),
    authors: creators(d.creator_list, lang === 'en' ? 'en' : 'ja'),
    editors: creators(d.contributor_list?.filter((c: any) => c.contributor_type === 'editor')),
    issued,
    volume: d.volume,
    issue: d.issue,
    pages: joinPages(d.first_page, d.last_page),
    publisher: multi(d.publisher_list, 'publisher_name')?.[lang ?? 'ja'] ?? d.publisher_list?.[0]?.publisher_name,
    language: lang,
    edition: typeof d.edition === 'string' ? d.edition : undefined,
  };
}

export async function fetchJalc(doi: string, ctx: SourceContext): Promise<SourceResult> {
  const raw: any = await ctx.http.json(`https://api.japanlinkcenter.org/dois/${encodeURIComponent(doi)}`);
  if (raw.status !== 'OK' || !raw.data) throw new Error(`JaLC: ${doi} が見つかりません`);
  return { source: 'jalc', record: parseJalc(raw.data), raw };
}

/** DOI の登録機関を調べる */
export async function fetchDoiRa(doi: string, ctx: SourceContext): Promise<string | undefined> {
  const raw: any = await ctx.http.json(`https://doi.org/ra/${encodeURI(doi)}`);
  return raw?.[0]?.RA;
}
