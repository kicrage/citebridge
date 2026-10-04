import { detectIds, normalizeIsbn } from '../ids/detect';
import type { IdType } from '../ids/types';
import type { CiteRecord, Name, SourceResult, WorkType } from '../model/record';
import { parseDate } from '../transforms/dates';
import { parseName } from '../transforms/names';
import { joinPages } from '../transforms/numbers';

/** ページから抜き出した meta 要素（name/property → content の組。重複可） */
export type MetaPairs = [string, string][];

/** 閲覧中ページの情報（コンテンツスクリプトが集める） */
export interface PageSnapshot {
  url: string;
  title: string;
  metas: MetaPairs;
  /** application/ld+json の中身 */
  jsonLd: unknown[];
  lang?: string;
}

const all = (m: MetaPairs, ...names: string[]) =>
  m.filter(([k]) => names.includes(k.toLowerCase())).map(([, v]) => v.trim()).filter(Boolean);
const one = (m: MetaPairs, ...names: string[]) => all(m, ...names)[0];

/**
 * Highwire（citation_*）/ Dublin Core / Open Graph / JSON-LD から書誌を組み立てる。
 * J-STAGE・機関リポジトリ（WEKO）・CiNii・多くの新聞サイトが citation_* か og:* を出している。
 */
export function parsePageSnapshot(p: PageSnapshot): Partial<CiteRecord> {
  const m = p.metas;
  const lang = one(m, 'citation_language', 'dc.language') ?? p.lang;
  const titleLang = lang?.startsWith('ja') ? 'ja' : lang?.startsWith('en') ? 'en' : 'und';

  const ld = findLdArticle(p.jsonLd);
  const title =
    one(m, 'citation_title', 'dc.title') ?? ld?.headline ?? ld?.name ?? one(m, 'og:title') ?? p.title.trim();

  const authorStrs = all(m, 'citation_author');
  const ldAuthors = arr(ld?.author)
    .map((a: any) => (typeof a === 'string' ? a : a?.name))
    .filter(Boolean);
  const authors: Name[] = (authorStrs.length ? authorStrs : all(m, 'dc.creator').length ? all(m, 'dc.creator') : ldAuthors)
    .map((s) => parseName(s).name);

  const journal = one(m, 'citation_journal_title', 'prism.publicationname');
  const book = one(m, 'citation_inbook_title', 'citation_book_title');
  const site = one(m, 'og:site_name') ?? ld?.publisher?.name;
  const date =
    one(m, 'citation_publication_date', 'citation_date', 'citation_online_date', 'dc.date', 'article:published_time') ??
    ld?.datePublished;

  const ids: Partial<Record<IdType, string>> = {};
  const doi = one(m, 'citation_doi', 'dc.identifier.doi', 'prism.doi');
  if (doi) ids.doi = doi.replace(/^(?:doi:|https?:\/\/(?:dx\.)?doi\.org\/)/i, '');
  const isbn = one(m, 'citation_isbn');
  if (isbn) {
    const n = normalizeIsbn(isbn);
    if (n) ids.isbn = n;
  }
  const issn = one(m, 'citation_issn');
  if (issn) ids.issn = issn;
  for (const d of detectIds(p.url)) if (d.type !== 'url' && !ids[d.type]) ids[d.type] = d.value;

  let type: WorkType = 'webpage';
  if (journal) type = 'article-journal';
  else if (one(m, 'citation_dissertation_institution')) type = 'thesis';
  else if (one(m, 'citation_conference_title')) type = 'paper-conference';
  else if (book) type = 'chapter';
  else if (one(m, 'citation_technical_report_institution')) type = 'report';
  else if (isbn) type = 'book';
  else if (/NewsArticle/.test(String(ld?.['@type'])) || one(m, 'og:type') === 'article') type = 'article-newspaper';

  return {
    type,
    ids,
    title: title ? { [titleLang]: title } : undefined,
    container: journal || book || (type === 'article-newspaper' || type === 'webpage' ? site : undefined)
      ? { [titleLang]: (journal ?? book ?? site)! }
      : undefined,
    authors,
    issued: parseDate(date),
    volume: one(m, 'citation_volume', 'prism.volume'),
    issue: one(m, 'citation_issue', 'prism.number'),
    pages: joinPages(one(m, 'citation_firstpage', 'prism.startingpage'), one(m, 'citation_lastpage', 'prism.endingpage')),
    publisher:
      one(m, 'citation_publisher', 'dc.publisher', 'citation_dissertation_institution', 'citation_technical_report_institution') ??
      (type !== 'webpage' && type !== 'article-newspaper' ? site : undefined),
    url: one(m, 'citation_abstract_html_url') ?? canonical(p),
    language: lang?.slice(0, 2),
  };
}

const arr = (x: any): any[] => (x === undefined || x === null ? [] : Array.isArray(x) ? x : [x]);

function findLdArticle(list: unknown[]): any {
  const flat: any[] = [];
  for (const x of list) for (const y of arr(x)) flat.push(...arr((y as any)?.['@graph'] ?? y));
  return flat.find((o) => /Article|NewsArticle|ScholarlyArticle|Book|BlogPosting|WebPage/.test(String(o?.['@type'])));
}

function canonical(p: PageSnapshot): string {
  return p.metas.find(([k]) => k === 'og:url')?.[1] ?? p.url;
}

export function pageResult(p: PageSnapshot): SourceResult {
  return { source: 'page', record: parsePageSnapshot(p), raw: p };
}
