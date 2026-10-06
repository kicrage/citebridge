import data from './profiles.generated.json';

export type Family = 'ja' | '2';

type ParamState = 'true' | 'false' | 'tracked';

interface FamilyProfile {
  module: string;
  basic: Record<string, ParamState>;
  numbered: Record<string, ParamState>;
  unique: Record<string, Record<string, ParamState>>;
  idParams: Record<string, string[]>;
}

export interface TdParam {
  label?: string;
  aliases?: string[];
  required?: boolean;
  suggested?: boolean;
  deprecated?: boolean;
}

export interface TemplateProfile {
  name: string;
  family: Family;
  citationClass: string;
  td?: Record<string, TdParam>;
  paramOrder?: string[];
}

const families = data.families as unknown as Record<Family, FamilyProfile>;
const templates = data.templates as unknown as Record<string, Omit<TemplateProfile, 'name'>>;

/** CitationClass → CS1 Whitelist の unique_arguments_t のキー */
const UNIQUE_KEY: Record<string, string> = {
  conference: 'conference',
  episode: 'episode',
  mailinglist: 'mailinglist',
  map: 'map',
  newsgroup: 'newsgroup',
  report: 'report',
  techreport: 'report',
  serial: 'serial',
  speech: 'speech',
  thesis: 'thesis',
};

export const PROFILE_INFO = { generatedAt: data.generatedAt, wiki: data.wiki };

export function getTemplate(name: string): TemplateProfile | undefined {
  const t = templates[name];
  return t ? { name, ...t } : undefined;
}

export function listTemplates(family?: Family): TemplateProfile[] {
  return Object.entries(templates)
    .filter(([, t]) => !family || t.family === family)
    .map(([name, t]) => ({ name, ...t }));
}

/** 系統と CitationClass からテンプレート名を引く（Cite journal ja / Cite journal2 など） */
export function templateFor(family: Family, citationClass: string): TemplateProfile | undefined {
  return listTemplates(family).find((t) => t.citationClass === citationClass);
}

export type ParamStatus = 'ok' | 'deprecated' | 'unknown';

/**
 * 引数がモジュールの Whitelist で受け付けられるか。
 * TemplateData ではなく Whitelist を正とする（ja 系には TemplateData の無いテンプレートが多いため）。
 */
export function paramStatus(tpl: TemplateProfile, param: string): ParamStatus {
  const fam = families[tpl.family];
  const check = (s: ParamState | undefined): ParamStatus | undefined =>
    s === undefined ? undefined : s === 'true' ? 'ok' : 'deprecated';
  const uk = UNIQUE_KEY[tpl.citationClass];
  return (
    check(fam.basic[param]) ??
    check(fam.numbered[param.replace(/\d+/, '#')]) ??
    (uk ? check(fam.unique[uk]?.[param]) : undefined) ??
    'unknown'
  );
}

/** 識別子名（DOI, NAID など）の専用引数名。無ければ undefined */
export function idParamName(family: Family, id: string): string | undefined {
  return families[family].idParams[id.toUpperCase()]?.[0];
}

/** TemplateData で必須とされている引数（別名を含む） */
export function requiredParams(tpl: TemplateProfile): { name: string; aliases: string[] }[] {
  if (!tpl.td) return [];
  return Object.entries(tpl.td)
    .filter(([, p]) => p.required)
    .map(([name, p]) => ({ name, aliases: p.aliases ?? [] }));
}

/** 引数の表示名（TemplateData のラベル） */
export function paramLabel(tpl: TemplateProfile, param: string): string | undefined {
  return tpl.td?.[param]?.label ?? tpl.td?.[param.replace(/\d+/, '')]?.label;
}
