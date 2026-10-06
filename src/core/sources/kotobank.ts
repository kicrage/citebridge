import type { DetectedId } from '../ids/types';
import type { CiteRecord, Name, SourceResult } from '../model/record';
import { parseName } from '../transforms/names';
import { ChooseEntryError } from './choose';
import { decode } from './html';
import type { SourceContext } from './http';
import { NotFoundError } from './http';

/**
 * コトバンク（https://kotobank.jp/word/{見出し語}-{数字}）。
 * 1 つの語のページに複数の辞書の項目が並び、各項目の直前に <div class="page_link_marker" id="w-{数字}"> がある。
 * 出典に書く URL の「#w-…」はこの id なので、ページの HTML から取れる。
 */
export interface KotobankEntry {
  /** #w-… の数字。他項目の抜粋（「…内の平野郷の言及」）は ref1, ref2…（目印が無いのでページ内の順番） */
  wid: string;
  /** 「…内の〇〇の言及」に並ぶ他項目の抜粋（【油】より）。title がその項目名 */
  mention?: boolean;
  /** 出典の題名（通常はページの見出し語。抜粋では抜粋元の項目名） */
  title?: string;
  /** 辞書名（「改訂新版 世界大百科事典」） */
  dictionary: string;
  /** 項目の見出し表示（読み付き。候補の見分けに使う） */
  heading: string;
  /** 同じ辞書に複数項目があるときの見分け（日本歴史地名大系の「山口県：周防国」など） */
  topic?: string;
  /** 本文の冒頭 120 字（見出しも分類も同じ項目の見分け用） */
  snippet: string;
  publisher?: string;
  authors: string[];
}

export interface KotobankPage {
  /** 識別子の値（「平野郷-864282」。デコード済み） */
  wordPath: string;
  /** #fragment なしの正規 URL */
  baseUrl: string;
  entries: KotobankEntry[];
}

const text = (html: string) => decode(html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ')).replace(/[\s　]+/g, ' ').trim();
/** 全角スペースを半角にそろえる（「改訂新版　世界大百科事典」→「改訂新版 世界大百科事典」） */
const norm = (s: string) => s.replace(/　/g, ' ').replace(/\s+/g, ' ').trim();

/** 出典欄の 1 つ目の <small> から出版社を取る。形は辞書ごとにまちまち:
 *  「株式会社平凡社「改訂新版 世界大百科事典」」「小学館 日本大百科全書(ニッポニカ)」「講談社」「ブリタニカ国際大百科事典 小項目事典」 */
export function parsePublisher(source: string | undefined, dictionary: string): string | undefined {
  if (!source) return undefined;
  let s = norm(source);
  const quoted = /^(.*?)[「『]/.exec(s);
  if (quoted) s = quoted[1];
  else s = norm(s.split(norm(dictionary)).join(' ')); // 出版社名＋辞書名の形から辞書名を除く
  s = s.replace(/^(?:株式会社|（株）|\(株\))\s*/, '').replace(/\s*(?:株式会社|（株）|\(株\))$/, '').trim();
  return s || undefined;
}

/** 世界大百科事典などの末尾「執筆者： 脇田 修」 */
export function parseWriters(description: string): string[] {
  const m = /執筆者[：:]\s*([\s\S]*?)\s*$/.exec(description.slice(-200));
  return m ? m[1].split(/\s*[、，,／/]\s*/).map((x) => x.trim()).filter(Boolean) : [];
}

/**
 * 「世界大百科事典（旧版）内の〇〇の言及」: 他の項目（【油】より…）の抜粋を並べたブロック。
 * 目印（w-…）もリンクも無いが、利用者が「この抜粋を出典にしたい」ことがあるので項目として扱う。
 * 題名は抜粋元の項目名、URL は抜粋が載っているこのページの #sekai_refs。
 */
function parseMentions(body: string): KotobankEntry[] {
  // 出典欄は「株式会社平凡社「世界大百科事典（旧版）」」の形。辞書名は「」の中
  const source = /<p class="source">[\s\S]*?<small>([\s\S]*?)<\/small>/.exec(body)?.[1];
  const sourceText = source ? text(source) : '';
  const dictionary = norm(/[「『]([^」』]+)[」』]/.exec(sourceText)?.[1] ?? '世界大百科事典（旧版）');
  const publisher = parsePublisher(sourceText, dictionary);
  const out: KotobankEntry[] = [];
  for (const m of body.matchAll(/<div class="ex cf">([\s\S]*?)<\/section>/g)) {
    const heading = norm(text(/<h3>([\s\S]*?)<\/h3>/.exec(m[1])?.[1] ?? ''));
    const title = /^【(.+?)】/.exec(heading)?.[1];
    if (!title) continue;
    const desc = /<section class="description">([\s\S]*)$/.exec(m[1])?.[1] ?? '';
    out.push({
      wid: `ref${out.length + 1}`,
      mention: true,
      title,
      dictionary,
      heading,
      ...(publisher ? { publisher } : {}),
      snippet: [...text(desc)].slice(0, 120).join(''),
      authors: parseWriters(text(desc)),
    });
  }
  return out;
}

export function parseKotobankPage(html: string): KotobankPage | undefined {
  const canonical =
    /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1] ?? /<meta property="og:url" content="([^"]+)"/.exec(html)?.[1];
  const m = canonical && /^https?:\/\/kotobank\.jp\/word\/([^#?]+)/.exec(canonical);
  if (!canonical || !m) return undefined;
  const baseUrl = canonical.split('#')[0];
  let wordPath: string;
  try {
    wordPath = decodeURIComponent(m[1]);
  } catch {
    wordPath = m[1];
  }

  const entries: KotobankEntry[] = [];
  for (const art of html.matchAll(/<article\b[^>]*class="dictype[^"]*"[^>]*>([\s\S]*?)<\/article>/g)) {
    const body = art[1];
    if (/<article\b[^>]*\bid="sekai_refs"/.test(art[0])) {
      entries.push(...parseMentions(body));
      continue;
    }
    const dictionary = norm(text(/<h2>\s*<a [^>]*>([\s\S]*?)<\/a>/.exec(body)?.[1] ?? ''));
    const markers = [...body.matchAll(/<div class="page_link_marker" id="w-(\d+)"><\/div>/g)];
    if (!dictionary || !markers.length) continue;
    const source = /<p class="source">[\s\S]*?<small>([\s\S]*?)<\/small>/.exec(body)?.[1];
    const publisher = parsePublisher(source ? text(source) : undefined, dictionary);
    markers.forEach((mk, i) => {
      const block = body.slice(mk.index! + mk[0].length, markers[i + 1]?.index ?? body.length);
      const heading = norm(text(/<h3>([\s\S]*?)<\/h3>/.exec(block)?.[1] ?? ''));
      const topic = /<div class="topic_path">\s*<ul>\s*<li>([\s\S]*?)<\/li>/.exec(block)?.[1];
      const desc = /<section class="description">([\s\S]*?)<\/section>/.exec(block)?.[1] ?? '';
      entries.push({
        wid: mk[1],
        dictionary,
        heading,
        ...(topic ? { topic: norm(text(topic)) } : {}),
        ...(publisher ? { publisher } : {}),
        // 見分け用の抜粋。ルビ（<rt>読み</rt>と括弧 <rp>）は本文として読めなくなるので除く
        snippet: [...text(desc.replace(/<div class="topic_path">[\s\S]*?<\/ul>\s*<\/div>/, '').replace(/<r[pt]>[\s\S]*?<\/r[pt]>/g, ''))].slice(0, 120).join(''),
        authors: parseWriters(text(desc)),
      });
    });
  }
  return entries.length ? { wordPath, baseUrl, entries } : undefined;
}

/** 候補ボタン用の表示名 */
export function entryLabel(e: KotobankEntry, page: KotobankPage): string {
  const base = (x: KotobankEntry) => {
    const siblings = page.entries.filter((y) => y.dictionary === x.dictionary).length > 1;
    const detail = x.mention ? x.heading : siblings ? x.topic ?? x.heading : undefined;
    const by = x.authors.length ? `（${x.authors.join('・')}）` : '';
    return `${x.dictionary}${x.mention ? '・言及' : ''}${detail ? ` — ${detail}` : ''}${by}`;
  };
  const label = base(e);
  // それでも他の項目と同じ表示になるときは、同じ表示の項目どうしで本文が食い違い始める所を添える
  const same = page.entries.filter((x) => base(x) === label);
  if (same.length < 2) return label;
  let common = 0;
  while (same.every((x) => x.snippet[common] !== undefined && x.snippet[common] === same[0].snippet[common])) common++;
  const from = Math.max(0, common - 4);
  return `${label}「…${[...e.snippet.slice(from)].slice(0, 20).join('')}…」`;
}

export function entryToRecord(e: KotobankEntry, page: KotobankPage): Partial<CiteRecord> {
  const slug = page.wordPath.replace(/-\d+$/, '');
  const authors: Name[] = e.authors.map((a) => parseName(a).name);
  return {
    type: 'entry-encyclopedia',
    ids: { kotobank: page.wordPath },
    // 題名は語のページの見出し語（項目の見出しは「なつめ‐そうせき【夏目漱石】」のように辞書ごとに表記が違う）
    title: { ja: e.title ?? slug },
    container: { ja: e.dictionary },
    authors,
    publisher: e.publisher,
    // 抜粋は、載っているブロック（article#sekai_refs）への URL
    url: `${page.baseUrl}#${e.mention ? 'sekai_refs' : `w-${e.wid}`}`,
    language: 'ja',
  };
}

export { ChooseEntryError };

export async function fetchKotobank(id: DetectedId, ctx: SourceContext): Promise<SourceResult> {
  const raw = await ctx.http.text(`https://kotobank.jp/word/${encodeURIComponent(id.value)}`, { headers: { Accept: 'text/html' } });
  const page = parseKotobankPage(raw);
  if (!page) throw new NotFoundError(`コトバンク: ${id.value}`);

  let entry = id.extra?.wid ? page.entries.find((e) => e.wid === id.extra!.wid) : undefined;
  if (!entry && id.extra?.wid) throw new NotFoundError(`コトバンク: ${id.value} に #w-${id.extra.wid} の項目がありません`);
  if (!entry) {
    if (page.entries.length > 1)
      throw new ChooseEntryError(
        page.entries.map((e) => ({ type: 'kotobank', value: id.value, extra: { wid: e.wid }, confidence: 'exact', label: entryLabel(e, page) })),
        'コトバンクのどの辞書の項目を出典にするか選んでください',
      );
    entry = page.entries[0];
  }
  // raw にはページ全体ではなく採用した項目だけを持たせる（キャッシュ側で全文を持つので十分）
  const record = entryToRecord(entry, page);
  return { source: 'kotobank', record, raw: { wid: entry.wid, dictionary: entry.dictionary } };
}
