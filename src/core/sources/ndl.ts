import { XMLParser } from 'fast-xml-parser';
import type { IdType } from '../ids/types';
import type { CiteRecord, Name, SourceResult, WorkType } from '../model/record';
import { parseDate } from '../transforms/dates';
import { attachYomi, parseName, stripRole, type Role } from '../transforms/names';
import { normalizePages, parseVolumeIssue, splitSubtitle } from '../transforms/numbers';
import { NotFoundError, type SourceContext } from './http';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  removeNSPrefix: false,
  isArray: (name) =>
    ['dcndl:BibResource', 'dcterms:creator', 'dc:creator', 'dcterms:identifier', 'dcndl:materialType', 'record'].includes(
      name,
    ),
  parseTagValue: false,
});

const arr = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
const text = (x: any): string | undefined => {
  if (x === undefined || x === null) return undefined;
  if (typeof x === 'string') return x.trim();
  if (typeof x === 'object' && '#text' in x) return String(x['#text']).trim();
  return undefined;
};
const descValue = (x: any): string | undefined => text(x?.['rdf:Description']?.['rdf:value']) ?? text(x);

const ID_DATATYPES: Record<string, IdType> = {
  ISBN: 'isbn',
  JPNO: 'jpno',
  NDLBibID: 'ndlbib',
  DOI: 'doi',
  ISSN: 'issn',
};

function typeOf(bib: any): WorkType {
  const types = arr(bib['dcndl:materialType']).map((m: any) => String(m['@rdf:resource'] ?? ''));
  if (types.some((t) => /\/Article$/.test(t))) return 'article-journal';
  if (types.some((t) => /\/(?:DoctoralThesis|Thesis)$/.test(t))) return 'thesis';
  if (types.some((t) => /\/(?:Newspaper)$/.test(t))) return 'article-newspaper';
  if (types.some((t) => /\/Book$/.test(t))) return 'book';
  return 'other';
}

/** 「会津若松 : 会津大学短期大学部」形式を出版地と出版者に分ける */
function splitPublisher(s: string | undefined): { place?: string; publisher?: string } {
  if (!s) return {};
  const m = /^(.+?)\s+:\s+(.+)$/.exec(s);
  return m ? { place: m[1], publisher: m[2] } : { publisher: s };
}

/** dcndl の BibResource を正規化 */
export function parseNdlBib(bib: any): Partial<CiteRecord> {
  const ids: Partial<Record<IdType, string>> = {};
  for (const idn of arr(bib['dcterms:identifier'])) {
    const dt = String((idn as any)['@rdf:datatype'] ?? '').split('/').pop() ?? '';
    const t = ID_DATATYPES[dt];
    const v = text(idn);
    if (t && v && !ids[t]) ids[t] = v;
  }

  const rawTitle = descValue(bib['dc:title']) ?? text(bib['dcterms:title']) ?? '';
  const { title, subtitle } = splitSubtitle(rawTitle);
  const titleYomi = text(bib['dc:title']?.['rdf:Description']?.['dcndl:transcription']);

  // 責任表示（dc:creator）から役割語を拾い、典拠形（dcterms:creator）の名前に当てる
  const statements = arr(bib['dc:creator']).map((s) => stripRole(text(s) ?? ''));
  const roleOf = (n: Name): Role => {
    const flat = (n.literal ?? `${n.family ?? ''}${n.given ?? ''}`).replace(/[\s　,]/g, '');
    const st = statements.find((s) => s.text.replace(/[\s　,]/g, '').includes(flat));
    return st?.role ?? 'author';
  };
  const authors: Name[] = [];
  const editors: Name[] = [];
  const translators: Name[] = [];
  const agents = arr(bib['dcterms:creator']).map((c: any) => c['foaf:Agent'] ?? c);
  const sourceNames: Name[] = agents.length
    ? agents.map((a: any) => attachYomi(parseName(text(a['foaf:name']) ?? '').name, text(a['dcndl:transcription'])))
    : statements.map((s) => parseName(s.text).name);
  for (const n of sourceNames) {
    if (!(n.literal ?? n.family)) continue;
    const r = roleOf(n);
    (r === 'editor' ? editors : r === 'translator' ? translators : authors).push(n);
  }

  const pubAgent = bib['dcterms:publisher']?.['foaf:Agent'] ?? bib['dcterms:publisher'];
  const pubSplit = splitPublisher(text(pubAgent?.['foaf:name']));
  const place = text(pubAgent?.['dcndl:location']) ?? pubSplit.place;

  const type = typeOf(bib);
  const vi = parseVolumeIssue(descValue(bib['dcndl:volume']));
  const dateRaw = text(bib['dcterms:date'])?.replace(/^\(.*?\)\s*/, '');
  const issued = parseDate(dateRaw) ?? parseDate(text(bib['dcterms:issued']));
  const lang = text(bib['dcterms:language']);

  const rec: Partial<CiteRecord> = {
    type,
    ids,
    title: title ? { ja: title, ...(titleYomi ? { 'ja-Kana': titleYomi } : {}) } : undefined,
    subtitle: subtitle ? { ja: subtitle } : undefined,
    authors,
    editors,
    translators,
    issued: issued?.y ? issued : (parseDate(text(bib['dcterms:issued'])) ?? issued),
    edition: text(bib['dcndl:edition']),
    series: descValue(bib['dcndl:seriesTitle']),
    publisher: pubSplit.publisher,
    place,
    language: lang === 'jpn' ? 'ja' : lang === 'eng' ? 'en' : lang,
  };
  if (type === 'article-journal') {
    rec.container = text(bib['dcndl:publicationName']) ? { ja: text(bib['dcndl:publicationName'])! } : undefined;
    rec.volume = text(bib['dcndl:publicationVolume']);
    rec.issue = text(bib['dcndl:number']) ?? text(bib['dcndl:issue']);
    rec.pages = normalizePages(text(bib['dcndl:pageRange']));
  } else {
    if (vi.volume) rec.volume = vi.volume;
    if (vi.issue) rec.issue = vi.issue;
  }
  return rec;
}

/** SRU の応答から最初の書誌（#material を持ち title のある BibResource）を取り出す */
export function parseNdlSru(xml: string): Partial<CiteRecord> | undefined {
  const doc = parser.parse(xml);
  const recs = arr(doc?.searchRetrieveResponse?.records?.record);
  for (const r of recs) {
    const rdf = r?.recordData?.['rdf:RDF'];
    const bibs = arr(rdf?.['dcndl:BibResource']);
    const bib = bibs.find((b: any) => b['dcterms:title'] || b['dc:title']);
    if (bib) return parseNdlBib(bib);
  }
  return undefined;
}

const SRU = 'https://ndlsearch.ndl.go.jp/api/sru?operation=searchRetrieve&recordSchema=dcndl&recordPacking=xml&maximumRecords=1&query=';

async function sru(cql: string, ctx: SourceContext): Promise<SourceResult | undefined> {
  const raw = await ctx.http.text(SRU + encodeURIComponent(cql));
  const record = parseNdlSru(raw);
  return record ? { source: 'ndl', record, raw } : undefined;
}

export async function fetchNdl(type: 'isbn' | 'jpno' | 'ndlbib', value: string, ctx: SourceContext): Promise<SourceResult> {
  let res: SourceResult | undefined;
  if (type === 'isbn') res = await sru(`isbn="${value}"`, ctx);
  else if (type === 'jpno') res = await sru(`jpno="${value}"`, ctx);
  else {
    // 図書（R100000002, 12桁ゼロ埋め）→ 雑誌記事索引（R000000004）の順に試す
    res =
      (await sru(`itemno="R100000002-I${value.padStart(12, '0')}"`, ctx)) ??
      (await sru(`itemno="R000000004-I${value.replace(/^0+/, '')}"`, ctx));
  }
  if (!res) throw new NotFoundError(`NDL: ${type}=${value}`);
  if (type === 'ndlbib') res.record.ids = { ...res.record.ids, ndlbib: value };
  return res;
}
