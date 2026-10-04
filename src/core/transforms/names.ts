import type { Name } from '../model/record';

export type Role = 'author' | 'editor' | 'translator' | 'other';

/** 責任表示の役割語 → 役割 */
const ROLE_WORDS: [RegExp, Role][] = [
  [/(?:編著|編・著|共編著)$/, 'author'],
  [/(?:著|作|文|述|著作|共著|原著|原作|執筆|撰)$/, 'author'],
  [/(?:監訳|共訳|訳|翻訳|訳注|訳・注)$/, 'translator'],
  [/(?:編|編集|共編|編纂|監修|編集代表|責任編集)$/, 'editor'],
  [/(?:画|絵|イラスト|写真|解説|校注|校訂|注)$/, 'other'],
];

const CJK = /[぀-ヿ㐀-鿿豈-﫿]/;

export interface ParsedName {
  name: Name;
  role: Role;
}

/** 責任表示の末尾の役割語を取り除く（例: 「夏目漱石 作」→ 役割 author） */
export function stripRole(s: string): { text: string; role?: Role } {
  const t = s.trim();
  for (const [re, role] of ROLE_WORDS) {
    const m = new RegExp(`^(.+?)[\\s　]*${re.source}`).exec(t);
    if (m && m[1].length > 0) return { text: m[1].trim(), role };
  }
  return { text: t };
}

/**
 * 名前文字列を解析する。
 * - 「山田, 太郎, 1950-」「山田 太郎」「山田　太郎」→ 姓・名
 * - 空白のない日本語の名前（「夏目漱石」）→ literal（推測で分割しない）
 * - 「Yamada, Taro」→ 姓・名、「Taro Yamada」→ 欧文の語順で分割
 */
export function parseName(input: string): ParsedName {
  let { text, role } = stripRole(input);
  // NDL の生没年「, 1867-1916」や「(1867-1916)」を除去
  text = text
    .replace(/[,，]\s*\d{3,4}\??-(?:\d{3,4})?\??\s*$/, '')
    .replace(/\s*[(（]\d{3,4}-(?:\d{3,4})?[)）]\s*$/, '')
    .trim();

  const comma = text.split(/\s*[,，]\s*/);
  if (comma.length === 2 && comma[0] && comma[1]) {
    return { name: { family: comma[0], given: comma[1] }, role: role ?? 'author' };
  }
  const parts = text.split(/[\s　]+/).filter(Boolean);
  if (parts.length === 2) {
    if (CJK.test(text)) return { name: { family: parts[0], given: parts[1] }, role: role ?? 'author' };
    return { name: { family: parts[1], given: parts[0] }, role: role ?? 'author' };
  }
  return { name: { literal: text }, role: role ?? 'author' };
}

/** 読み（「ナツメ, ソウセキ, 1867-1916」）を名前に付ける */
export function attachYomi(name: Name, yomi: string | undefined): Name {
  if (!yomi) return name;
  const y = yomi.replace(/[,，]\s*\d{3,4}-(?:\d{3,4})?\s*$/, '').replace(/[,，]\s*/g, ' ').trim();
  return y ? { ...name, yomi: y } : name;
}

/** 表示用の1文字列（author= 用）。日本語名は「姓 名」、欧文は「名 姓」 */
export function nameToString(n: Name): string {
  if (n.literal) return n.literal;
  const f = n.family ?? '';
  const g = n.given ?? '';
  if (!g) return f;
  if (!f) return g;
  return CJK.test(f + g) ? `${f} ${g}` : `${g} ${f}`;
}

export function isCjkName(n: Name): boolean {
  return CJK.test(n.literal ?? `${n.family ?? ''}${n.given ?? ''}`);
}

/** 同一人物かの簡易判定（照合用） */
export function sameName(a: Name, b: Name): boolean {
  const norm = (n: Name) => nameToString(n).normalize('NFKC').replace(/[\s,.]/g, '').toLowerCase();
  return norm(a) === norm(b);
}
