import type { CiteRecord, Name, SourceResult, WorkType } from '../model/record';
import { parseDate } from '../transforms/dates';
import { normalizePages } from '../transforms/numbers';
import type { SourceContext } from './http';

/** Zotero の itemType → 資料種別 */
const TYPE_MAP: Record<string, WorkType> = {
  journalArticle: 'article-journal',
  magazineArticle: 'article-magazine',
  newspaperArticle: 'article-newspaper',
  book: 'book',
  bookSection: 'chapter',
  thesis: 'thesis',
  report: 'report',
  conferencePaper: 'paper-conference',
  encyclopediaArticle: 'entry-encyclopedia',
  dictionaryEntry: 'entry-encyclopedia',
  webpage: 'webpage',
  blogPost: 'webpage',
  dataset: 'dataset',
};

const toName = (c: any): Name =>
  c.lastName && c.firstName ? { family: c.lastName, given: c.firstName } : { literal: c.lastName ?? c.firstName ?? c.name };

export function parseCitoid(it: any): Partial<CiteRecord> {
  const lang = it.language;
  const l = lang?.startsWith('ja') ? 'ja' : lang?.startsWith('en') ? 'en' : 'und';
  const creators: any[] = it.author ? it.author.map((a: string[]) => ({ firstName: a[0], lastName: a[1], creatorType: 'author' })) : (it.creators ?? []);
  const by = (t: string) => creators.filter((c) => (c.creatorType ?? 'author') === t).map(toName);
  const container = it.publicationTitle ?? it.bookTitle ?? it.websiteTitle ?? it.encyclopediaTitle ?? it.proceedingsTitle;
  return {
    type: TYPE_MAP[it.itemType] ?? 'other',
    ids: {
      ...(it.DOI ? { doi: it.DOI } : {}),
      ...(it.ISBN ? { isbn: String(it.ISBN).split(/\s+/)[0] } : {}),
      ...(it.ISSN ? { issn: String(it.ISSN).split(/[\s,]+/)[0] } : {}),
      ...(it.PMID ? { pmid: it.PMID } : {}),
      ...(it.PMCID ? { pmc: String(it.PMCID).replace(/^PMC/, '') } : {}),
    },
    title: it.title ? { [l]: it.title } : undefined,
    container: container ? { [l]: container } : undefined,
    authors: by('author'),
    editors: by('editor'),
    translators: by('translator'),
    issued: parseDate(it.date),
    volume: it.volume,
    issue: it.issue,
    pages: normalizePages(it.pages),
    edition: it.edition,
    series: it.series,
    publisher: it.publisher ?? it.university ?? it.institution,
    place: it.place,
    url: it.url,
    language: lang,
  };
}

/** Wikimedia の Citoid（Zotero トランスレータ）で取得。URL・PMID・arXiv 等の汎用フォールバック */
export async function fetchCitoid(query: string, ctx: SourceContext, wiki = 'ja.wikipedia.org'): Promise<SourceResult> {
  const raw: any = await ctx.http.json(
    `https://${wiki}/api/rest_v1/data/citation/mediawiki/${encodeURIComponent(query)}`,
  );
  const it = Array.isArray(raw) ? raw[0] : raw;
  if (!it || it.itemType === undefined) throw new Error(`Citoid: ${query} を解決できませんでした`);
  return { source: 'citoid', record: parseCitoid(it), raw };
}
