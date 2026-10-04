import type { Family } from '../templates/profiles';
import type { Param } from '../templates/mapper';
import { escapeValue, type SerializeStyle } from '../templates/serialize';
import { findTemplates, paramKey, type ParsedTemplate } from './template';

export type CiteFamily = Family | 'legacy';

/** 出典テンプレートの系統（Cite ○○ ja / Cite ○○2 / 旧来の Cite ○○） */
export function citeFamily(name: string): CiteFamily | undefined {
  const n = name.replace(/^(?:template|テンプレート)\s*:\s*/i, '').replace(/_/g, ' ').trim();
  if (!/^cite\s/i.test(n) && !/^citation/i.test(n)) return undefined;
  if (/\sja$/i.test(n)) return 'ja';
  if (/\S2$/.test(n)) return '2';
  return 'legacy';
}

export interface RefEntry {
  /** <ref …>…</ref> 全体の位置。リスト定義済み参照（<ref name=x />）は body なし */
  start: number;
  end: number;
  name?: string;
  group?: string;
  body?: string;
  bodyStart?: number;
  /** 本文中の出典テンプレート */
  cites: ParsedTemplate[];
}

const attrRe = (n: string) => new RegExp(`\\b${n}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s/>]+))`, 'i');
const attr = (s: string, n: string) => attrRe(n).exec(s)?.slice(1).find((x) => x !== undefined);

/** 記事中の <ref> を列挙する（コメント内は除く） */
export function findRefs(text: string): RefEntry[] {
  const masked = text.replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length));
  const out: RefEntry[] = [];
  const re = /<ref\b([^>]*?)(\/)?>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked))) {
    const attrs = m[1];
    const entry: RefEntry = { start: m.index, end: m.index + m[0].length, cites: [], name: attr(attrs, 'name'), group: attr(attrs, 'group') };
    if (!m[2]) {
      const close = masked.toLowerCase().indexOf('</ref>', re.lastIndex);
      if (close < 0) continue;
      entry.bodyStart = re.lastIndex;
      entry.body = text.slice(re.lastIndex, close);
      entry.end = close + 6;
      entry.cites = findTemplates(text, (n) => !!citeFamily(n), entry.bodyStart, close);
      re.lastIndex = close + 6;
    }
    out.push(entry);
  }
  return out;
}

/** <ref> の外（参考文献節など）にある出典テンプレートも含めて列挙 */
export function findAllCites(text: string): ParsedTemplate[] {
  const top = findTemplates(text, (n) => !!citeFamily(n));
  const inRefs = findRefs(text).flatMap((r) => r.cites);
  const seen = new Set(top.map((t) => t.start));
  return [...top, ...inRefs.filter((t) => !seen.has(t.start))].sort((a, b) => a.start - b.start);
}

export interface ArticleStyle {
  /** 記事内で多い系統（同数・不在なら undefined） */
  family?: Family;
  counts: Record<CiteFamily, number>;
  serialize: Partial<SerializeStyle>;
}

/** 記事の既存出典から、系統と書式（横並び／縦並び、= の前後の空白）を推定する */
export function detectStyle(text: string): ArticleStyle {
  const cites = findAllCites(text);
  const counts: Record<CiteFamily, number> = { ja: 0, '2': 0, legacy: 0 };
  let block = 0;
  let spaced = 0;
  let pipeSpace = 0;
  let named = 0;
  for (const c of cites) {
    counts[citeFamily(c.name)!]++;
    if (/\n\s*\|/.test(c.text)) block++;
    for (const p of c.params) {
      if (!p.named) continue;
      named++;
      const seg = text.slice(p.start, p.end);
      if (/^\s*[^=]*\S\s+=/.test(seg)) spaced++;
      if (/\s$/.test(text.slice(p.start - 2, p.start - 1))) pipeSpace++;
    }
  }
  const family: Family | undefined = counts.ja > counts['2'] ? 'ja' : counts['2'] > counts.ja ? '2' : undefined;
  const serialize: Partial<SerializeStyle> = {};
  if (cites.length) {
    serialize.layout = block * 2 > cites.length ? 'block' : 'inline';
    serialize.spacedEquals = spaced * 2 > named;
    serialize.spaceBeforePipe = pipeSpace * 2 > named;
  }
  return { family, counts, serialize };
}

/** 既存テンプレートの引数名（比較キー）→ 値 */
export function existingParams(t: ParsedTemplate): Map<string, { name: string; value: string }> {
  const m = new Map<string, { name: string; value: string }>();
  for (const p of t.params) if (p.named) m.set(paramKey(p.name), { name: p.name, value: p.value });
  return m;
}

export interface FillSuggestion {
  param: Param;
  /** 'missing' = 引数が無い / 'empty' = 引数はあるが空欄 */
  kind: 'missing' | 'empty';
}

/** 生成した引数のうち、既存テンプレートで空欄・未記入のものだけを補完候補にする（既存値は上書きしない） */
export function fillSuggestions(t: ParsedTemplate, generated: Param[]): FillSuggestion[] {
  const ex = existingParams(t);
  const out: FillSuggestion[] = [];
  // 著者が1人でも書かれていれば著者欄は触らない（書き方の違う名前を重ねないため）
  const hasPeople = (role: RegExp) => [...ex.entries()].some(([k, v]) => role.test(k) && v.value);
  for (const p of generated) {
    const k = paramKey(p.name);
    if (/^(last|first)\d*$/.test(k) && hasPeople(/^(last|first|vauthors|authors)\d*$/)) continue;
    if (/^editor/.test(k) && hasPeople(/^editor/)) continue;
    if (/^translator/.test(k) && hasPeople(/^translator/)) continue;
    if (k === 'date' && ex.get('year')?.value) continue;
    if (/^(page|pages|at)$/.test(k) && ['page', 'pages', 'at'].some((x) => ex.get(x)?.value)) continue;
    const cur = ex.get(k);
    if (!cur) out.push({ param: p, kind: 'missing' });
    else if (!cur.value) out.push({ param: p, kind: 'empty' });
  }
  return out;
}

/**
 * 補完候補をテンプレートに書き込んだ新しいテキストを返す。
 * 空欄の引数はその場所に値を入れ、無い引数は末尾（}} の前）に既存の書式に合わせて足す。
 */
export function applyFills(text: string, t: ParsedTemplate, fills: FillSuggestion[]): string {
  const block = /\n\s*\|/.test(t.text);
  const named = t.params.filter((p) => p.named);
  const spaced = named.length > 0 && named.filter((p) => /^\s*[^=]*\S\s+=/.test(text.slice(p.start, p.end))).length * 2 > named.length;
  const fmt = (p: Param) => {
    const v = escapeValue(p.value, { raw: p.raw, brackets: /^(title|chapter)$/.test(p.name) });
    return spaced ? `${p.name} = ${v}` : `${p.name}=${v}`;
  };
  const edits: { at: number; end: number; insert: string }[] = [];
  for (const f of fills.filter((f) => f.kind === 'empty')) {
    const p = t.params.find((x) => x.named && paramKey(x.name) === paramKey(f.param.name))!;
    const seg = text.slice(p.start, p.end);
    const eq = seg.indexOf('=');
    const trail = /\s*$/.exec(seg)![0];
    edits.push({ at: p.start + eq + 1, end: p.end - trail.length, insert: (spaced ? ' ' : '') + escapeValue(f.param.value, { raw: f.param.raw }) });
  }
  const missing = fills.filter((f) => f.kind === 'missing').map((f) => f.param);
  if (missing.length) {
    const closeAt = t.end - 2;
    if (block) {
      const before = text.slice(t.start, closeAt);
      const nl = /\n\s*$/.test(before);
      const ins = missing.map((p) => `| ${fmt(p)}`).join('\n');
      const trimmed = before.replace(/\s*$/, '');
      edits.push({ at: t.start + trimmed.length, end: closeAt, insert: `\n${ins}${nl ? '\n' : ''}` });
    } else {
      const sep = / \|/.test(t.text) ? ' |' : '|';
      const before = text.slice(t.start, closeAt);
      const trimmed = before.replace(/\s*$/, '');
      edits.push({ at: t.start + trimmed.length, end: closeAt, insert: missing.map((p) => sep + fmt(p)).join('') });
    }
  }
  edits.sort((a, b) => b.at - a.at);
  let out = text;
  for (const e of edits) out = out.slice(0, e.at) + e.insert + out.slice(e.end);
  return out;
}

/** 同じ識別子・同じ題名の出典を持つ <ref> の組（<ref name> での共通化候補） */
export function duplicateRefs(refs: RefEntry[]): RefEntry[][] {
  const groups = new Map<string, RefEntry[]>();
  for (const r of refs) {
    const c = r.cites[0];
    if (!c) continue;
    const ex = existingParams(c);
    const key =
      ['doi', 'isbn', 'crid', 'naid', 'url'].map((k) => ex.get(k)?.value).find(Boolean)?.toLowerCase() ??
      ex.get('title')?.value.normalize('NFKC').replace(/\s/g, '');
    if (!key) continue;
    const page = ['page', 'pages', 'at'].map((k) => ex.get(k)?.value).find(Boolean) ?? '';
    const k = `${key}#${page}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}
