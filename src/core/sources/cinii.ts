import type { IdType } from '../ids/types';
import type { CiteRecord, Multilingual, Name, SourceResult, WorkType } from '../model/record';
import { parseDate } from '../transforms/dates';
import { attachYomi, parseName } from '../transforms/names';
import { joinPages, splitSubtitle } from '../transforms/numbers';
import type { SourceContext } from './http';

type LangVal = { '@language'?: string; '@value': string };

function multi(list: LangVal[] | undefined): Multilingual | undefined {
  if (!list?.length) return undefined;
  const out: Multilingual = {};
  for (const v of list) {
    const l = v['@language'] ?? 'und';
    if (!out[l]) out[l] = v['@value'];
  }
  return out;
}

function typeOf(d: any): WorkType {
  const rt: string = d.resourceType ?? '';
  if (/博士論文|学位論文|thesis/i.test(rt) || d['@type'] === 'Dissertation') return 'thesis';
  if (/会議発表|conference/i.test(rt)) return 'paper-conference';
  if (/報告書|report/i.test(rt) || d['@type'] === 'Report') return 'report';
  if (/図書の一部|book part|chapter/i.test(rt)) return 'chapter';
  if (d['@type'] === 'Book' || /図書|book/i.test(rt)) return 'book';
  if (d['@type'] === 'Data' || /データ|dataset/i.test(rt)) return 'dataset';
  if (d['@type'] === 'Article') return 'article-journal';
  return 'other';
}

const ID_TYPES: Record<string, IdType> = {
  DOI: 'doi',
  NAID: 'naid',
  NCID: 'ncid',
  ISBN: 'isbn',
  NDL_BIB_ID: 'ndlbib',
  JPNO: 'jpno',
};

function creators(list: any[] | undefined): Name[] {
  if (!list) return [];
  return list
    .map((c) => {
      const names: LangVal[] = c['foaf:name'] ?? [];
      const main = names.find((n) => n['@language'] === 'ja') ?? names.find((n) => !n['@language']) ?? names[0];
      if (!main) return undefined;
      const yomi = names.find((n) => n['@language'] === 'ja-Kana')?.['@value'];
      return attachYomi(parseName(main['@value']).name, yomi);
    })
    .filter((n): n is Name => !!n);
}

export function parseCinii(d: any, crid?: string): Partial<CiteRecord> {
  const type = typeOf(d);
  const ids: Partial<Record<IdType, string>> = {};
  if (crid) ids.crid = crid;
  for (const p of d.productIdentifier ?? []) {
    const t = ID_TYPES[p.identifier?.['@type']];
    if (t && !ids[t]) ids[t] = p.identifier['@value'];
  }

  // 書名と副題（ISBD の「 : 」区切り）
  let title = multi(d['dc:title']);
  let subtitle: Multilingual | undefined;
  if (title) {
    const t2: Multilingual = {};
    subtitle = {};
    for (const [l, v] of Object.entries(title)) {
      if (l.endsWith('-Kana')) continue;
      const s = splitSubtitle(v);
      t2[l] = s.title;
      if (s.subtitle) subtitle[l] = s.subtitle;
    }
    title = t2;
    if (!Object.keys(subtitle).length) subtitle = undefined;
  }

  const pub = d.publication ?? {};
  const pubr = d['dcterms:publisher']?.[0];
  const issued = parseDate(pub['prism:publicationDate'] ?? pubr?.['prism:publicationDate'] ?? d['dc:date']);
  const publisher = multi(pub['dc:publisher'])?.ja ?? multi(pub['dc:publisher'])?.und ?? pubr?.['dc:publisher'];

  const rec: Partial<CiteRecord> = {
    type,
    ids,
    title,
    subtitle,
    container: multi(pub['prism:publicationName']),
    authors: creators(d.creator),
    issued,
    volume: pub['prism:volume'],
    issue: pub['prism:number'],
    pages: joinPages(pub['prism:startingPage'], pub['prism:endingPage']),
    publisher,
    place: pubr?.publicationPlace,
    language: typeof d['dc:language'] === 'string' ? d['dc:language'] : undefined,
  };
  if (type === 'thesis') {
    const deg = d.dissertationNumber ? undefined : d.degreeName?.[0]?.['@value'];
    if (deg) rec.degree = deg;
    const grantor = d.degreeGrantor?.[0]?.['foaf:name']?.[0]?.['@value'];
    if (grantor) rec.publisher = grantor;
  }
  // 草枕のように「論文」として登録された古い記事は publicationName が作品名になっていることがあるので、題名が無ければ補う
  if (!rec.title && rec.container) {
    rec.title = rec.container;
    delete rec.container;
  }
  return rec;
}

export async function fetchCinii(crid: string, ctx: SourceContext): Promise<SourceResult> {
  const raw: any = await ctx.http.json(`https://cir.nii.ac.jp/crid/${encodeURIComponent(crid)}.json`);
  return { source: 'cinii', record: parseCinii(raw, crid), raw };
}

/** NAID・NCID 等から CRID を引く（CiNii Research OpenSearch の全文検索） */
export async function findCrid(query: string, ctx: SourceContext): Promise<string | undefined> {
  const raw: any = await ctx.http.json(
    `https://cir.nii.ac.jp/opensearch/all?q=${encodeURIComponent(query)}&format=json&count=5`,
  );
  for (const it of raw.items ?? []) {
    const ids: any[] = it['dc:identifier'] ?? [];
    if (ids.some((x) => x['@value'] === query)) return /crid\/(\d+)/.exec(it['@id'])?.[1];
  }
  return undefined;
}
