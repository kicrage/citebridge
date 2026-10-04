import type { CiteRecord, Name, SourceResult, WorkType } from '../model/record';
import { fromDateParts } from '../transforms/dates';
import { normalizePages } from '../transforms/numbers';
import type { SourceContext } from './http';

const TYPE_MAP: Record<string, WorkType> = {
  'journal-article': 'article-journal',
  'book-chapter': 'chapter',
  'book-section': 'chapter',
  'book-part': 'chapter',
  'reference-entry': 'entry-encyclopedia',
  book: 'book',
  monograph: 'book',
  'edited-book': 'book',
  'reference-book': 'book',
  'proceedings-article': 'paper-conference',
  dissertation: 'thesis',
  report: 'report',
  dataset: 'dataset',
};

interface CrAuthor {
  given?: string;
  family?: string;
  name?: string;
}

const toName = (a: CrAuthor): Name => (a.family ? { family: a.family, given: a.given } : { literal: a.name ?? a.given ?? '' });

const first = (a?: string[]) => (a && a.length ? a[0].trim() : undefined);

/** Crossref の works レスポンス（message 部）を正規化 */
export function parseCrossref(msg: any): Partial<CiteRecord> {
  const lang = typeof msg.language === 'string' ? msg.language : undefined;
  const titleLang = lang ?? 'und';
  const title = first(msg.title);
  const subtitle = first(msg.subtitle);
  const container = first(msg['container-title']);
  const type = TYPE_MAP[msg.type] ?? 'other';
  const date = fromDateParts(
    msg.issued?.['date-parts']?.[0] ?? msg['published-print']?.['date-parts']?.[0] ?? msg.published?.['date-parts']?.[0],
  );
  const rec: Partial<CiteRecord> = {
    type,
    ids: {
      doi: msg.DOI,
      ...(msg.ISSN?.[0] ? { issn: msg.ISSN[0] } : {}),
      ...(msg.ISBN?.[0] ? { isbn: msg.ISBN[0] } : {}),
    },
    title: title ? { [titleLang]: title } : undefined,
    subtitle: subtitle ? { [titleLang]: subtitle } : undefined,
    container: container ? { [titleLang]: container } : undefined,
    authors: (msg.author ?? []).map(toName),
    editors: (msg.editor ?? []).map(toName),
    translators: (msg.translator ?? []).map(toName),
    issued: date,
    volume: msg.volume,
    issue: msg.issue,
    pages: normalizePages(msg.page),
    articleNumber: msg['article-number'],
    publisher: msg.publisher,
    place: msg['publisher-location'],
    language: lang,
    edition: msg['edition-number'],
  };
  // 書籍の章では container-title が書名
  if (type === 'chapter' && container) rec.container = { [titleLang]: container };
  return rec;
}

export async function fetchCrossref(doi: string, ctx: SourceContext): Promise<SourceResult> {
  const q = ctx.mailto ? `?mailto=${encodeURIComponent(ctx.mailto)}` : '';
  const raw: any = await ctx.http.json(`https://api.crossref.org/works/${encodeURIComponent(doi)}${q}`);
  return { source: 'crossref', record: parseCrossref(raw.message), raw };
}
