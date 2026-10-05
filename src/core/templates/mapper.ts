import type { Passage, PassageMode } from '../model/passage';
import { inferPageKind } from '../model/passage';
import type { CiteRecord, Name, WorkType } from '../model/record';
import { pick } from '../model/record';
import type { Settings } from '../settings';
import { DEFAULT_SETTINGS } from '../settings';
import { formatDate, todayIso } from '../transforms/dates';
import { nameToString } from '../transforms/names';
import { isPageRange, normalizePages } from '../transforms/numbers';
import { KOBE_HANDLE_PREFIX } from '../ids/detect';
import { getTemplate, idParamName, paramStatus, templateFor, type Family, type TemplateProfile } from './profiles';

export interface Param {
  name: string;
  value: string;
  /** 値にテンプレート等のウィキ文法を含む（エスケープしない） */
  raw?: boolean;
}

export interface TemplateCall {
  template: string;
  params: Param[];
}

export interface MapOptions {
  family: Family;
  settings?: Partial<Settings>;
  passage?: Passage;
  /** 一節の使い方（未指定なら設定値） */
  passageMode?: PassageMode;
  /** テンプレートを明示指定する場合 */
  template?: string;
  /** access-date に使う日付（テスト用） */
  today?: string;
}

export interface MapResult {
  call: TemplateCall;
  profile: TemplateProfile;
  /** sfn モードのとき、本文に置く {{Sfn}} */
  sfn?: string;
  /** Whitelist に無いため落とした引数など */
  dropped: Param[];
}

/** 資料種別 → CitationClass */
export function citationClassFor(rec: Pick<CiteRecord, 'type' | 'container' | 'url' | 'ids'>): string {
  const byType: Partial<Record<WorkType, string>> = {
    'article-journal': 'journal',
    'article-magazine': 'magazine',
    'article-newspaper': 'news',
    book: 'book',
    chapter: 'book',
    thesis: 'thesis',
    report: 'report',
    'paper-conference': 'conference',
    'entry-encyclopedia': 'encyclopaedia',
    webpage: 'web',
  };
  const c = byType[rec.type];
  if (c) return c;
  if (rec.container) return 'journal';
  if (rec.ids.isbn) return 'book';
  return rec.url ? 'web' : 'book';
}

export function chooseTemplate(rec: CiteRecord, family: Family): TemplateProfile {
  const cls = citationClassFor(rec);
  return templateFor(family, cls) ?? templateFor(family, rec.url ? 'web' : 'book')!;
}

/** jawiki に専用引数の無い識別子は id= に書くテンプレートを使う */
const ID_WRAPPERS: Partial<Record<keyof CiteRecord['ids'], (v: string) => string>> = {
  ndlbib: (v) => `{{国立国会図書館書誌ID|${v}}}`,
  jpno: (v) => `{{全国書誌番号|${v}}}`,
  ndldc: (v) => `{{NDLDC|${v}}}`,
};

/** 専用引数のある識別子（Whitelist の id_handlers 名） */
const NATIVE_IDS: [keyof CiteRecord['ids'], string][] = [
  ['isbn', 'ISBN'],
  ['doi', 'DOI'],
  ['crid', 'CRID'],
  ['naid', 'NAID'],
  ['ncid', 'NCID'],
  ['pmid', 'PMID'],
  ['pmc', 'PMC'],
  ['arxiv', 'ARXIV'],
  ['hdl', 'HDL'],
];

/** 引数の並び順（人が読みやすい順。ここに無い引数は末尾） */
const ORDER = [
  /^(last|first|author|author-link)\d*$/,
  /^(editor\d*-last|editor\d*-first|editor\d*)$/,
  /^(translator\d*-last|translator\d*-first|translator\d*)$/,
  /^chapter$/,
  /^title$/,
  /^trans-title$/,
  /^volume-title$/,
  /^(journal|magazine|newspaper|website|encyclopedia|conference|book-title)$/,
  /^(series)$/,
  /^(volume|issue)$/,
  /^(page|pages|at)$/,
  /^(edition)$/,
  /^(degree|major)$/,
  /^(location|publisher)$/,
  /^(date|year)$/,
  /^language$/,
  /^(isbn|issn|doi|crid|naid|ncid|pmid|pmc|arxiv|hdl|id)$/,
  /^url$/,
  /^access-date$/,
  /^quote$/,
  /^ref$/,
];

function orderOf(name: string): number {
  const i = ORDER.findIndex((re) => re.test(name));
  return i < 0 ? ORDER.length : i;
}

function namesToParams(list: Name[], role: 'author' | 'editor' | 'translator', style: Settings['nameStyle']): Param[] {
  const out: Param[] = [];
  list.forEach((n, i) => {
    const k = i + 1;
    const full = nameToString(n);
    if (!full) return;
    const split = !n.literal && n.family && n.given && style === 'last-first';
    if (role === 'author') {
      if (split) out.push({ name: `last${k}`, value: n.family! }, { name: `first${k}`, value: n.given! });
      else out.push({ name: `author${k}`, value: full });
    } else if (split) {
      out.push({ name: `${role}${k}-last`, value: n.family! }, { name: `${role}${k}-first`, value: n.given! });
    } else {
      out.push({ name: `${role}${k}`, value: full });
    }
  });
  return out;
}

/** 記事の言語（ja）以外で書かれた資料かどうか */
function langParam(rec: CiteRecord): string | undefined {
  const l = rec.language?.toLowerCase().slice(0, 2);
  if (!l || l === 'ja' || l === 'un') return undefined;
  if (l === 'jp') return undefined;
  return l;
}

function joinTitle(t: string | undefined, sub: string | undefined, cjk: boolean, joinJa: string): string | undefined {
  if (!t) return undefined;
  if (!sub) return t;
  return cjk ? `${t}${joinJa}${sub}` : `${t}: ${sub}`;
}

const CJK = /[぀-ヿ㐀-鿿]/;

/** 一節のページ指定 → page/pages/at */
function pageParam(page: string, kind: Passage['pageKind']): Param {
  if (kind === 'koma') return { name: 'at', value: `${page}コマ` };
  if (kind === 'loc') return { name: 'at', value: page };
  const p = normalizePages(page)!;
  return { name: isPageRange(p) ? 'pages' : 'page', value: p };
}

/** {{Sfn}} 用の著者名（姓）と年 */
function sfnKeys(rec: CiteRecord, title?: string): string[] {
  const people = rec.authors.length ? rec.authors : rec.editors;
  const keys = people.slice(0, 4).map((n) => n.literal ?? n.family ?? n.given ?? '').filter(Boolean);
  if (!keys.length && title) keys.push(title);
  if (rec.issued?.y) keys.push(String(rec.issued.y));
  return keys;
}

function urlFor(rec: CiteRecord): string | undefined {
  if (rec.ids.ndldc) {
    const koma = rec.koma ? `/1/${rec.koma}` : '';
    return `https://dl.ndl.go.jp/pid/${rec.ids.ndldc}${koma}`;
  }
  if (rec.ids.kobenp) return `https://hdl.handle.net/${KOBE_HANDLE_PREFIX}/${rec.ids.kobenp}`;
  return rec.url;
}

/** URL が識別子から機械的に作れるもの（DOI リンク・CiNii の書誌ページ等）か */
function urlRedundant(url: string, rec: CiteRecord): boolean {
  if (/^https?:\/\/(dx\.)?doi\.org\//i.test(url)) return true;
  if (rec.ids.doi && url.toLowerCase().includes(rec.ids.doi.toLowerCase())) return true;
  if (rec.ids.crid && url.includes(`/crid/${rec.ids.crid}`)) return true;
  if (rec.ids.naid && url.includes(`/naid/${rec.ids.naid}`)) return true;
  if (rec.ids.ndlbib && /ndlsearch\.ndl\.go\.jp\/books\//.test(url)) return true;
  return false;
}

/**
 * CiteRecord（＋一節）を ja 系 / 2 系テンプレートの引数列に変換する。
 * 両系統の引数セットはほぼ同一（CS-ja は volume-title が追加）なので、組み立ては共通で、
 * 最後にテンプレートの Whitelist で受け付けられない引数を落とす。
 */
export function mapRecord(rec: CiteRecord, opts: MapOptions): MapResult {
  const s: Settings = { ...DEFAULT_SETTINGS, ...opts.settings };
  const profile = (opts.template && getTemplate(opts.template)) || chooseTemplate(rec, opts.family);
  const family = profile.family;
  const cls = profile.citationClass;
  const mode = opts.passageMode ?? s.passageMode;
  const P: Param[] = [];
  const add = (name: string, value: string | undefined, raw = false) => {
    const v = value?.toString().trim();
    if (v) P.push({ name, value: v, ...(raw ? { raw } : {}) });
  };

  const titleMain = pick(rec.title);
  const cjk = CJK.test(titleMain ?? '') || rec.language === 'ja';
  const lang = cjk ? ['ja', 'und', 'en'] : ['und', 'en', 'ja'];
  const title = joinTitle(pick(rec.title, lang), pick(rec.subtitle, lang), CJK.test(pick(rec.title, lang) ?? ''), s.subtitleJoinJa);
  const container = pick(rec.container, lang);

  P.push(...namesToParams(rec.authors, 'author', s.nameStyle));
  P.push(...namesToParams(rec.editors, 'editor', s.nameStyle));
  P.push(...namesToParams(rec.translators, 'translator', s.nameStyle));

  // 題名と収録誌名
  if (rec.type === 'chapter' && cls === 'book') {
    add('chapter', title);
    add('title', container ?? title);
  } else {
    add('title', title);
    const containerParam: Record<string, string> = {
      journal: 'journal',
      magazine: 'magazine',
      news: 'newspaper',
      web: 'website',
      encyclopaedia: 'encyclopedia',
      conference: 'conference',
    };
    const cp = containerParam[cls];
    if (cp) add(cp, container);
    else if (container && cls !== 'book') add('journal', container);
  }
  if (family === 'ja') add('volume-title', rec.volumeTitle);
  add('series', rec.series);
  add('volume', rec.volume);
  add('issue', rec.issue);
  add('edition', rec.edition);
  if (cls === 'thesis') {
    add('degree', rec.degree);
    add('major', rec.major);
  }
  add('location', rec.place);
  // Crossref の publisher は学術出版社名（Elsevier 等）で、雑誌論文の出典には普通書かない
  const periodical = cls === 'journal' || cls === 'magazine' || cls === 'news';
  // 新聞社名と新聞名が同じ（朝日新聞 / 朝日新聞社 など）なら書かない
  const samePublisher = !!container && !!rec.publisher && rec.publisher.replace(/社$/, '') === container.replace(/社$/, '');
  if (!(periodical && rec.provenance.publisher === 'crossref') && !samePublisher) add('publisher', rec.publisher);
  add('date', formatDate(rec.issued, s.dateStyle));
  add('language', langParam(rec));

  // ページ: 一節が指定されていればそれを、無ければ論文の掲載ページ
  const passage = opts.passage;
  // sfn モードの一節ページは本文側の {{Sfn}} に書き、本体（参考文献節）には論文の掲載ページを書く
  if (passage?.page && mode !== 'sfn') {
    P.push(pageParam(passage.page, passage.pageKind ?? inferPageKind(passage.page)));
  } else if (rec.koma && rec.ids.ndldc) {
    add('at', `${rec.koma}コマ`);
  } else if (rec.pages && cls !== 'book') {
    const p = normalizePages(rec.pages)!;
    add(isPageRange(p) ? 'pages' : 'page', p);
  } else if (rec.articleNumber) {
    add('at', rec.articleNumber);
  }

  // 識別子
  for (const [k, handler] of NATIVE_IDS) {
    const v = rec.ids[k];
    if (!v) continue;
    // 新聞記事文庫は url= が Handle URL そのものなので hdl= は重ねない
    if (k === 'hdl' && rec.ids.kobenp) continue;
    const pn = idParamName(family, handler);
    if (pn) add(pn, v);
  }
  const wrapped = (Object.keys(ID_WRAPPERS) as (keyof typeof ID_WRAPPERS)[])
    .filter((k) => rec.ids[k])
    .map((k) => ID_WRAPPERS[k]!(rec.ids[k]!));
  if (wrapped.length) add('id', wrapped.join(' '), true);

  // URL と閲覧日
  const url = urlFor(rec);
  const hasId = NATIVE_IDS.some(([k]) => rec.ids[k]) || wrapped.length > 0;
  const keepUrl = url && (cls === 'web' || rec.ids.ndldc || rec.ids.kobenp || s.urlWithId || !hasId) && !(urlRedundant(url, rec) && !s.urlWithId);
  if (keepUrl) {
    add('url', url);
    if (s.accessDate && !rec.ids.ndldc) add('access-date', opts.today ?? todayIso());
  }

  if (passage?.text && mode === 'quote') add('quote', passage.text.replace(/\s*\n\s*/g, ' '));

  let sfn: string | undefined;
  if (mode === 'sfn') {
    const keys = sfnKeys(rec, title);
    // CS1 は著者と年から CITEREF を作るが、CS-ja では自動生成を確認できないため ja 系は常に明示する
    if (family === 'ja' || !rec.authors.length) add('ref', `{{SfnRef|${keys.join('|')}}}`, true);
    const pp = passage?.page ? pageParam(passage.page, passage.pageKind ?? inferPageKind(passage.page)) : undefined;
    const loc = pp ? `|${pp.name === 'pages' ? 'pp' : pp.name === 'page' ? 'p' : 'loc'}=${pp.value}` : '';
    sfn = `{{Sfn|${keys.join('|')}${loc}}}`;
  }

  const kept: Param[] = [];
  const dropped: Param[] = [];
  for (const p of P) (paramStatus(profile, p.name) === 'unknown' ? dropped : kept).push(p);
  kept.sort((a, b) => orderOf(a.name) - orderOf(b.name));

  return { call: { template: profile.name, params: kept }, profile, sfn, dropped };
}
