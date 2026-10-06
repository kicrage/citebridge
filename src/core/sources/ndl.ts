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

/** 叢書名に続く巻次（「ちくま学芸文庫 ; ア7-5」）は落とす */
const seriesName = (s: string | undefined) => s?.split(/\s+[;；]\s+/)[0].trim() || undefined;

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
    series: seriesName(descValue(bib['dcndl:seriesTitle'])),
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

export async function fetchNdl(
  type: 'isbn' | 'jpno' | 'ndlbib' | 'ndlarticle',
  value: string,
  ctx: SourceContext,
): Promise<SourceResult> {
  let res: SourceResult | undefined;
  if (type === 'isbn') res = await sru(`isbn="${value}"`, ctx);
  else if (type === 'jpno') res = await sru(`jpno="${value}"`, ctx);
  // 雑誌記事索引（R000000004）。図書の書誌ID（R100000002, 12桁ゼロ埋め）とは別体系で、同じ番号が別資料になる
  else if (type === 'ndlarticle') res = await sru(`itemno="R000000004-I${value.replace(/^0+/, '')}"`, ctx);
  else {
    // NDL の解決規則: 0 埋めなしの短い番号（〜8 桁）は雑誌記事索引、9 桁以上（「000002041889」「028842503」）は図書で、
    // 図書の I 番号は書誌ID の文字列そのまま（12 桁に 0 埋めすると別物になり存在しない）
    res = value.length >= 9 ? await sru(`itemno="R100000002-I${value}"`, ctx) : await sru(`itemno="R000000004-I${value}"`, ctx);
  }
  if (!res) throw new NotFoundError(`NDL: ${type}=${value}`);
  if (type === 'ndlbib') res.record.ids = { ...res.record.ids, ndlbib: value };
  return res;
}

// ---- NDL デジタルコレクション（PID） ----------------------------------------------------------
// OAI-PMH（dcndl_porta）は公開・制限付きを問わず全 PID で引ける。IIIF マニフェストは公開資料のみ、
// item API は一部の PID（国立国会図書館東日本大震災アーカイブ等）で 404 になるため使わない。

const oaiParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  removeNSPrefix: false,
  isArray: (name) =>
    ['dc:creator', 'dc:identifier', 'dc:publisher', 'dcterms:issued', 'dcndl:materialType', 'dcndl:sourceIdentifier'].includes(name),
  parseTagValue: false,
});

const oaiUrl = (pid: string) =>
  `https://dl.ndl.go.jp/api/oaipmh?verb=GetRecord&metadataPrefix=dcndl_porta&identifier=${encodeURIComponent(`oai:dl.ndl.go.jp:info:ndljp/pid/${pid}`)}`;

/** 応答に含まれる画像サイズ（exif:width/height はコマ数だけ並ぶ）は書誌に不要なのでキャッシュ前に落とす */
export const stripExif = (xml: string) => xml.replace(/<exif:(?:width|height)>[^<]*<\/exif:(?:width|height)>/g, '');

const xsiType = (x: any): string => (typeof x === 'object' && x ? String(x['@xsi:type'] ?? '') : '');
const ofType = (xs: any[], type: string) => xs.filter((x) => xsiType(x) === type);
const untyped = (xs: any[]) => xs.filter((x) => !xsiType(x));

/** NDL の連続スペース・前後空白を整える */
const clean = (s: string | undefined) => s?.replace(/[\s　]+/g, ' ').trim() || undefined;

/** dcndl:materialType（"Book"、"写真"、".../ndltype/Photograph" が混在する）→ 資料種別 */
function ndldcType(types: string[]): WorkType {
  const has = (re: RegExp) => types.some((t) => re.test(t));
  if (has(/^(?:Journal|Magazine)$/)) return 'article-journal';
  if (has(/^Newspaper$/)) return 'article-newspaper';
  if (has(/^(?:DoctoralThesis|Thesis)$/)) return 'thesis';
  if (has(/^(?:Book|Manuscript|JapaneseClassicalBook|Map)$/)) return 'book';
  return 'other';
}

/** OAI-PMH（dcndl_porta）の GetRecord 応答から書誌を取り出す。存在しない PID は undefined */
export function parseNdldcOai(xml: string): Partial<CiteRecord> | undefined {
  const dc = oaiParser.parse(xml)?.['OAI-PMH']?.GetRecord?.record?.metadata?.['dcndl_porta:dc'];
  const rawTitle = text(dc?.['dcterms:title']);
  if (!dc || !rawTitle) return undefined;

  const types = arr(dc['dcndl:materialType']).map((m) => text(m) ?? '');
  const type = ndldcType(types);
  const manuscript = types.includes('Manuscript');

  // 責任表示（無印の dc:creator。「紫式部 著」のように役割語が付く）を優先し、無ければ典拠形（NDLNA）を使う
  const creators = arr(dc['dc:creator']);
  const statements = untyped(creators).map((c) => text(c)).filter((s): s is string => !!s);
  const authors: Name[] = [];
  const editors: Name[] = [];
  const translators: Name[] = [];
  const source = statements.length ? statements : ofType(creators, 'dcndl:NDLNA').map((c) => text(c)).filter((s): s is string => !!s);
  for (const s of source) {
    const { name, role } = parseName(clean(s)!);
    (role === 'editor' ? editors : role === 'translator' ? translators : role === 'other' ? [] : authors).push(name);
  }

  // 雑誌・新聞の 1 号分は、題名ではなく掲載誌名として扱う（記事題名は利用者が補う）
  const issue = type === 'article-journal' || type === 'article-newspaper';
  const { title, subtitle } = splitSubtitle(rawTitle);
  const yomi = text(dc['dcndl:titleTranscription']);
  // 欧文題名では読みが題名そのものになる
  const titleYomi = yomi && yomi !== title ? yomi : undefined;
  const titleMl = { ja: title, ...(titleYomi ? { 'ja-Kana': titleYomi } : {}) };

  // 巻次。雑誌は「(53);2003」（(号);年）の形
  const volume = text(dc['dcndl:volume'])?.replace(/^\[(.+)\]$/, '$1');
  let vol: { volume?: string; issue?: string } = {};
  const mi = /^[(（]([^)）]+)[)）]\s*;/.exec(volume ?? '');
  if (issue && mi) vol = { issue: mi[1] };
  else if (volume) vol = parseVolumeIssue(volume);

  const ids: Partial<Record<IdType, string>> = {};
  const idEntries = arr(dc['dc:identifier']).concat(arr(dc['dcndl:sourceIdentifier']));
  const issn = ofType(idEntries, 'dcndl:ISSN')[0];
  if (issn) ids.issn = text(issn);
  const pid = ofType(idEntries, 'dcndl:NDLJP')[0];
  const pidValue = text(pid)?.replace(/^info:ndljp\/pid\//, '');
  if (pidValue) ids.ndldc = pidValue;

  // 出版年月。無印は和暦等の原表記なので W3CDTF を優先する
  const issuedAll = arr(dc['dcterms:issued']);
  const issued =
    parseDate(text(ofType(issuedAll, 'dcterms:W3CDTF')[0])) ??
    parseDate(text(untyped(issuedAll)[0])) ??
    parseDate(text(dc['dcterms:created']));

  const lang = text(arr(dc['dc:language'])[0]);
  const place = clean(text(dc['dcndl:publicationPlace']));
  // 写本・写（「写」だけが入る）は出版者ではない
  const publisher = manuscript ? undefined : clean(text(arr(dc['dc:publisher'])[0]));

  const rec: Partial<CiteRecord> = {
    type,
    ids,
    // 雑誌・新聞の号の責任表示は発行者（団体）で、記事の著者ではない
    authors: issue ? [] : authors,
    editors: issue ? [] : editors,
    translators: issue ? [] : translators,
    issued,
    ...(issue ? { container: titleMl } : { title: titleMl, ...(subtitle ? { subtitle: { ja: subtitle } } : {}) }),
    ...vol,
    publisher: publisher && publisher !== '[出版者不明]' ? publisher : undefined,
    place: place && place !== '[出版地不明]' ? place.replace(/^\[(.+)\]$/, '$1') : undefined,
    series: seriesName(clean(text(dc['dcndl:seriesTitle']) ?? text(dc['dcndl:publicationName']))),
    edition: text(dc['dcndl:edition']),
    language: lang === 'jpn' ? 'ja' : lang === 'eng' ? 'en' : lang,
  };
  return rec;
}

/** NDL デジタルコレクションの PID から書誌を取得（OAI-PMH dcndl_porta） */
export async function fetchNdldc(pid: string, ctx: SourceContext): Promise<SourceResult> {
  const raw = stripExif(await ctx.http.text(oaiUrl(pid)));
  const record = parseNdldcOai(raw);
  if (!record) throw new NotFoundError(`NDLDC: pid=${pid}`);
  record.ids = { ...record.ids, ndldc: pid };
  return { source: 'ndl', record, raw };
}
