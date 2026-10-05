import type { DetectedId } from '../ids/types';
import { idKey } from '../ids/types';
import type { CiteRecord, SourceId, SourceResult } from '../model/record';
import { mergeResults } from '../merge/merge';
import { fetchCinii, findCrid } from './cinii';
import { fetchCitoid } from './citoid';
import { fetchCrossref } from './crossref';
import { fetchHtmlMeta } from './html';
import type { SourceContext } from './http';
import { fetchKobeNp, kobeIdFromHandle } from './kobe';
import { fetchKotobank } from './kotobank';
import { fetchDoiRa, fetchJalc } from './jalc';
import { fetchNdl, fetchNdldc } from './ndl';

export interface ResolveResult {
  record: CiteRecord;
  results: SourceResult[];
  errors: { source: string; message: string }[];
}

/** 主ソースの次に、補完のため試すソース（失敗しても全体は失敗にしない） */
type Step = { source: SourceId; run: () => Promise<SourceResult | undefined> };

async function settle(steps: Step[], errors: ResolveResult['errors']): Promise<SourceResult[]> {
  const out = await Promise.allSettled(steps.map((s) => s.run()));
  const ok: SourceResult[] = [];
  out.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) ok.push(r.value);
    else if (r.status === 'rejected') errors.push({ source: steps[i].source, message: String(r.reason?.message ?? r.reason) });
  });
  return ok;
}

async function viaDoi(doi: string, ctx: SourceContext, errors: ResolveResult['errors'], opts: { skipCinii?: boolean } = {}) {
  let ra: string | undefined;
  try {
    ra = await fetchDoiRa(doi, ctx);
  } catch (e: any) {
    errors.push({ source: 'doi.org/ra', message: e.message });
  }
  if (ra === 'JaLC') {
    const res = await settle(
      [
        { source: 'jalc', run: () => fetchJalc(doi, ctx) },
        ...(opts.skipCinii
          ? []
          : [{ source: 'cinii' as const, run: async () => { const c = await findCrid(doi, ctx); return c ? fetchCinii(c, ctx) : undefined; } }]),
      ],
      errors,
    );
    return { results: res, order: ['user', 'jalc', 'cinii', 'crossref', 'ndl', 'citoid', 'page'] as SourceId[] };
  }
  if (ra === 'Crossref') {
    const res = await settle([{ source: 'crossref', run: () => fetchCrossref(doi, ctx) }], errors);
    return { results: res, order: ['user', 'crossref', 'jalc', 'cinii', 'citoid', 'page'] as SourceId[] };
  }
  // DataCite・mEDRA 等や RA 不明は Citoid に任せる
  const res = await settle([{ source: 'citoid', run: () => fetchCitoid(doi, ctx) }], errors);
  return { results: res, order: ['user', 'citoid', 'crossref', 'jalc', 'page'] as SourceId[] };
}

const NDL_DOI = /^10\.11501\/(\d+)$/;

/** 識別子からメタデータを取得し、統合済みレコードを返す */
export async function resolveId(id: DetectedId, ctx: SourceContext): Promise<ResolveResult> {
  // 10.11501/{PID} は NDL デジタルコレクションの DOI。JaLC 経由だと著者を姓名に割る・巻次が題名に混ざるなど質が落ちるので OAI-PMH で引く
  const ndlDoi = id.type === 'doi' ? NDL_DOI.exec(id.value) : null;
  if (ndlDoi) return resolveId({ type: 'ndldc', value: ndlDoi[1], confidence: 'exact' }, ctx);
  const errors: ResolveResult['errors'] = [];
  let results: SourceResult[] = [];
  let order: SourceId[] = ['user', 'cinii', 'jalc', 'crossref', 'ndl', 'citoid', 'page'];

  switch (id.type) {
    case 'doi': {
      ({ results, order } = await viaDoi(id.value, ctx, errors));
      break;
    }
    case 'crid':
    case 'naid':
    case 'ncid': {
      const crid = id.type === 'crid' ? id.value : await findCrid(id.value, ctx);
      if (!crid) throw new Error(`CiNii Research で ${id.value} が見つかりませんでした`);
      results = await settle([{ source: 'cinii', run: () => fetchCinii(crid, ctx) }], errors);
      const doi = results[0]?.record.ids?.doi;
      const isbn = results[0]?.record.ids?.isbn;
      // CiNii は取得済みなので DOI からの再検索はしない
      if (doi) results.push(...(await viaDoi(doi, ctx, errors, { skipCinii: true })).results);
      else if (isbn) results.push(...(await settle([{ source: 'ndl', run: () => fetchNdl('isbn', isbn, ctx) }], errors)));
      if (id.type !== 'crid') for (const r of results) if (r.source === 'cinii') r.record.ids = { ...r.record.ids, [id.type]: id.value };
      break;
    }
    case 'isbn':
    case 'jpno':
    case 'ndlbib':
    case 'ndlarticle': {
      results = await settle([{ source: 'ndl', run: () => fetchNdl(id.type as 'isbn', id.value, ctx) }], errors);
      if (!results.length && id.type === 'isbn')
        results = await settle([{ source: 'citoid', run: () => fetchCitoid(id.value, ctx) }], errors);
      order = ['user', 'ndl', 'cinii', 'citoid', 'page'];
      break;
    }
    case 'ndldc': {
      // OAI-PMH のみ。Citoid は SPA の汎用題名（「国立国会図書館デジタルコレクション」）しか返さず、
      // 取得失敗を成功に見せかけるので、失敗時はエラーにする（閲覧中ページの meta は background 側で重ねる）
      results = await settle([{ source: 'ndl', run: () => fetchNdldc(id.value, ctx) }], errors);
      order = ['user', 'ndl', 'page'];
      break;
    }
    case 'kobenp':
    case 'hdl': {
      // 新聞記事文庫は記事ページの表を専用に読む（meta が無く、<title> は「題名 | 新聞記事文庫」になるため）
      const kobe = id.type === 'kobenp' ? id.value : kobeIdFromHandle(id.value);
      if (kobe) {
        results = await settle([{ source: 'kobe', run: () => fetchKobeNp(kobe, ctx) }], errors);
        order = ['user', 'kobe'];
        break;
      }
      results = await settle([{ source: 'page', run: () => fetchHtmlMeta(`https://hdl.handle.net/${id.value}`, ctx) }], errors);
      for (const r of results) r.record.ids = { ...r.record.ids, hdl: id.value };
      order = ['user', 'page', 'citoid'];
      break;
    }
    case 'kotobank': {
      // 辞書ごとの項目（#w-…）はページ HTML から取る。項目が決まらず複数あれば ChooseEntryError で候補を返す
      results = [await fetchKotobank(id, ctx)]; // settle を通さない（ChooseEntryError や 404 をそのまま呼び出し側に返す）
      order = ['user', 'kotobank', 'page'];
      break;
    }
    case 'url': {
      results = await settle(
        [
          { source: 'citoid', run: () => fetchCitoid(id.value, ctx) },
          { source: 'page', run: () => fetchHtmlMeta(id.value, ctx) },
        ],
        errors,
      );
      order = ['user', 'page', 'citoid'];
      break;
    }
    default: {
      results = await settle([{ source: 'citoid', run: () => fetchCitoid(`${id.type === 'pmc' ? 'PMC' : ''}${id.value}`, ctx) }], errors);
    }
  }

  if (!results.length) {
    throw new Error(errors.map((e) => `${e.source}: ${e.message}`).join(' / ') || 'メタデータを取得できませんでした');
  }
  const record = mergeResults(idKey(id), results, order);
  record.ids[id.type] ??= id.value;
  if (id.extra?.koma) record.koma = id.extra.koma;
  return { record, results, errors };
}
