import type { Param, TemplateCall } from './mapper';

export interface SerializeStyle {
  /** 'inline' = 1行 / 'block' = 引数ごとに改行 */
  layout: 'inline' | 'block';
  /** `| name = value` のように = の前後に空白を入れる */
  spacedEquals: boolean;
  /** inline でも `{{Cite book ja |title=…}}` のように | の前に空白を入れる */
  spaceBeforePipe: boolean;
}

export const DEFAULT_STYLE: SerializeStyle = { layout: 'inline', spacedEquals: false, spaceBeforePipe: true };

/**
 * 引数の値をテンプレート内で安全な形にする。
 * - `{{…}}` と `[[…]]` の内側は触らない（id={{NDLDC|…}} など）
 * - それ以外の `|` は {{!}}、改行は空白
 * - 題名中の角括弧は CS1 が外部リンクと誤認するので文字参照にする
 */
export function escapeValue(v: string, opts: { raw?: boolean; brackets?: boolean } = {}): string {
  const one = v.replace(/\s*\n\s*/g, ' ');
  if (opts.raw) return one;
  let out = '';
  let depth = 0;
  for (let i = 0; i < one.length; i++) {
    const two = one.slice(i, i + 2);
    if (two === '{{' || two === '[[') {
      depth++;
      out += two;
      i++;
    } else if ((two === '}}' || two === ']]') && depth > 0) {
      depth--;
      out += two;
      i++;
    } else if (depth === 0 && one[i] === '|') out += '{{!}}';
    else if (depth === 0 && opts.brackets && one[i] === '[') out += '&#91;';
    else if (depth === 0 && opts.brackets && one[i] === ']') out += '&#93;';
    else out += one[i];
  }
  return out;
}

const TITLE_LIKE = /^(title|chapter|trans-title|volume-title|quote)$/;

function paramText(p: Param, style: SerializeStyle): string {
  const v = escapeValue(p.value, { raw: p.raw, brackets: TITLE_LIKE.test(p.name) });
  return style.spacedEquals ? `${p.name} = ${v}` : `${p.name}=${v}`;
}

export function serializeTemplate(call: TemplateCall, style: Partial<SerializeStyle> = {}): string {
  const st = { ...DEFAULT_STYLE, ...style };
  if (st.layout === 'block') {
    return `{{${call.template}\n${call.params.map((p) => `| ${paramText(p, st)}`).join('\n')}\n}}`;
  }
  const sep = st.spaceBeforePipe ? ' |' : '|';
  return `{{${call.template}${call.params.map((p) => sep + paramText(p, st)).join('')}}}`;
}

/** <ref> で包む。name の値に空白や記号があれば引用符を付ける */
export function wrapRef(body: string, name?: string): string {
  if (!name) return `<ref>${body}</ref>`;
  const n = /^[^\s"'<>/=]+$/.test(name) ? name : `"${name.replace(/"/g, '&quot;')}"`;
  return `<ref name=${n}>${body}</ref>`;
}
