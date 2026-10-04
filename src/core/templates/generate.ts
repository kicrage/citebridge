import type { Passage, PassageMode } from '../model/passage';
import type { CiteRecord } from '../model/record';
import { DEFAULT_SETTINGS, type Settings } from '../settings';
import type { ArticleStyle } from '../wikitext/refs';
import { mapRecord, type MapResult, type TemplateCall } from './mapper';
import type { Family } from './profiles';
import { serializeTemplate, wrapRef, type SerializeStyle } from './serialize';
import { validateCall, type Issue } from './validate';

export interface GenerateOptions {
  settings?: Partial<Settings>;
  passage?: Passage;
  passageMode?: PassageMode;
  /** 挿入先記事の書式（detectStyle の結果） */
  article?: ArticleStyle;
  /** 系統・テンプレートの手動指定 */
  family?: Family;
  template?: string;
  refName?: string;
  today?: string;
}

export interface Generated extends MapResult {
  family: Family;
  style: Partial<SerializeStyle>;
  /** テンプレート単体 */
  wikitext: string;
  /** カーソル位置に入れるもの（<ref>…</ref> または {{Sfn}}） */
  inline: string;
  /** sfn モードで参考文献節に置くもの */
  bibliography?: string;
  issues: Issue[];
}

export function resolveFamily(s: Settings, article?: ArticleStyle): Family {
  if (s.family !== 'auto') return s.family;
  return article?.family ?? s.defaultFamily;
}

export function resolveStyle(s: Settings, article?: ArticleStyle): Partial<SerializeStyle> {
  const st = { ...article?.serialize };
  if (s.layout !== 'auto') st.layout = s.layout;
  return st;
}

/** 生成済み（あるいは手で直した）引数列から出力を作る */
export function render(call: TemplateCall, style: Partial<SerializeStyle>, sfn?: string, refName?: string) {
  const wikitext = serializeTemplate(call, style);
  return {
    wikitext,
    inline: sfn ?? wrapRef(wikitext, refName),
    bibliography: sfn ? `* ${wikitext}` : undefined,
    issues: validateCall(call),
  };
}

export function generate(rec: CiteRecord, opts: GenerateOptions = {}): Generated {
  const s: Settings = { ...DEFAULT_SETTINGS, ...opts.settings };
  const family = opts.family ?? resolveFamily(s, opts.article);
  const m = mapRecord(rec, {
    family,
    settings: s,
    passage: opts.passage,
    passageMode: opts.passageMode,
    template: opts.template,
    today: opts.today,
  });
  const style = resolveStyle(s, opts.article);
  return { ...m, family: m.profile.family, style, ...render(m.call, style, m.sfn, opts.refName) };
}
