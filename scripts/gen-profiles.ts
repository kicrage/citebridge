/**
 * jawiki の引用モジュール（CS-ja / CS1）の Whitelist・Configuration と、各テンプレートの CitationClass・TemplateData を取得し、
 * src/core/templates/profiles.generated.json を生成する。
 *
 *   npm run gen:profiles
 *
 * MV3 拡張は外部コードを実行できないため、引数の定義はビルド時にデータとして同梱する。
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const API = 'https://ja.wikipedia.org/w/api.php';
const UA = 'Citebridge-gen-profiles/0.1 (Wikipedia citation helper extension; build script)';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api(params: Record<string, string>): Promise<any> {
  const u = new URL(API);
  for (const [k, v] of Object.entries({ format: 'json', formatversion: '2', maxlag: '5', ...params })) u.searchParams.set(k, v);
  for (let attempt = 0; ; attempt++) {
    await sleep(500);
    const r = await fetch(u, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA } });
    if (r.status === 429 && attempt < 4) {
      await sleep((Number(r.headers.get('retry-after')) || 5) * 1000 * (attempt + 1));
      continue;
    }
    if (!r.ok) throw new Error(`${r.status} ${u}`);
    return r.json();
  }
}

async function raw(title: string): Promise<{ text: string; revid: number }> {
  const d = await api({ action: 'query', prop: 'revisions', rvprop: 'content|ids', rvslots: 'main', titles: title });
  const p = d.query.pages[0];
  if (p.missing) throw new Error(`missing: ${title}`);
  return { text: p.revisions[0].slots.main.content, revid: p.revisions[0].revid };
}

type ParamState = 'true' | 'false' | 'tracked';

/** Lua の `local NAME = { ... }` ブロックを取り出す（入れ子の波括弧に対応） */
function luaBlock(src: string, name: string): string {
  const start = src.indexOf(`local ${name} = {`);
  if (start < 0) throw new Error(`block not found: ${name}`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(src.indexOf('{', start) + 1, i);
  }
  throw new Error(`unterminated: ${name}`);
}

const stripComments = (s: string) => s.replace(/--\[\[[\s\S]*?\]\]/g, '').replace(/--[^\n]*/g, '');

function flatParams(block: string): Record<string, ParamState> {
  const out: Record<string, ParamState> = {};
  for (const m of stripComments(block).matchAll(/\[\s*'([^']+)'\s*\]\s*=\s*(true|false|'tracked')/g))
    out[m[1]] = m[2].replace(/'/g, '') as ParamState;
  return out;
}

/** `conference = { ['x'] = true, ... }, thesis = {...}` 形式 */
function groupedParams(block: string): Record<string, Record<string, ParamState>> {
  const out: Record<string, Record<string, ParamState>> = {};
  const src = stripComments(block);
  for (const m of src.matchAll(/(\w+)\s*=\s*\{([^{}]*)\}/g)) out[m[1]] = flatParams(m[2]);
  return out;
}

/** Configuration の id_handlers から、識別子名 → 引数名一覧 */
function idHandlers(conf: string): Record<string, string[]> {
  const block = luaBlock(conf, 'id_handlers');
  const out: Record<string, string[]> = {};
  for (const m of block.matchAll(/\[\s*'([A-Z0-9]+)'\s*\]\s*=\s*\{[\s\S]*?parameters\s*=\s*\{([^}]*)\}/g)) {
    out[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  }
  return out;
}

interface FamilyProfile {
  module: string;
  revisions: Record<string, number>;
  basic: Record<string, ParamState>;
  /** '#' を番号に置き換えて使う引数（author#, last# 等） */
  numbered: Record<string, ParamState>;
  /** 特定の CitationClass だけで使える引数 */
  unique: Record<string, Record<string, ParamState>>;
  idParams: Record<string, string[]>;
}

async function family(module: string): Promise<FamilyProfile> {
  const wl = await raw(`Module:${module}/Whitelist`);
  const conf = await raw(`Module:${module}/Configuration`);
  return {
    module,
    revisions: { Whitelist: wl.revid, Configuration: conf.revid },
    basic: flatParams(luaBlock(wl.text, 'basic_arguments_t')),
    numbered: flatParams(luaBlock(wl.text, 'numbered_arguments_t')),
    unique: groupedParams(luaBlock(wl.text, 'unique_arguments_t')),
    idParams: idHandlers(conf.text),
  };
}

interface TemplateInfo {
  family: 'ja' | '2';
  citationClass: string;
  revid: number;
  /** TemplateData があれば: 引数 → { label, aliases, required, suggested, deprecated } */
  td?: Record<string, { label?: string; aliases?: string[]; required?: boolean; suggested?: boolean; deprecated?: boolean }>;
  paramOrder?: string[];
  citoidMap?: Record<string, unknown>;
}

async function listTemplates(): Promise<string[]> {
  const titles = new Set<string>();
  for (const q of ['intitle:/^Cite .+ ja$/', 'intitle:/^Cite .+2$/']) {
    const d = await api({ action: 'query', list: 'search', srsearch: q, srnamespace: '10', srlimit: '100' });
    for (const s of d.query.search) titles.add(s.title.replace(/^Template:/, ''));
  }
  return [...titles].filter((t) => /^Cite [^/]+(?: ja|2)$/.test(t)).sort();
}

async function templateInfo(names: string[]): Promise<Record<string, TemplateInfo>> {
  const out: Record<string, TemplateInfo> = {};
  for (let i = 0; i < names.length; i += 20) {
    const chunk = names.slice(i, i + 20);
    const d = await api({
      action: 'query',
      prop: 'revisions',
      rvprop: 'content|ids',
      rvslots: 'main',
      titles: chunk.map((n) => `Template:${n}`).join('|'),
    });
    const td = await api({ action: 'templatedata', titles: chunk.map((n) => `Template:${n}`).join('|'), lang: 'ja' });
    const tdByTitle: Record<string, any> = {};
    for (const p of Object.values<any>(td.pages ?? {})) tdByTitle[p.title] = p;

    for (const p of d.query.pages) {
      if (p.missing) continue;
      const text: string = p.revisions[0].slots.main.content;
      const mod = /#invoke:\s*[Cc]itation\/(CS-ja|CS1)\s*\|\s*citation[\s\S]*?CitationClass\s*=\s*([\w-]+)/.exec(text);
      if (!mod) continue; // ラッパーやリダイレクトは除外
      const name = p.title.replace(/^Template:/, '');
      const info: TemplateInfo = { family: mod[1] === 'CS-ja' ? 'ja' : '2', citationClass: mod[2].trim(), revid: p.revisions[0].revid };
      const t = tdByTitle[p.title];
      if (t?.params) {
        info.td = {};
        for (const [k, v] of Object.entries<any>(t.params)) {
          info.td[k] = {
            label: typeof v.label === 'string' ? v.label : v.label?.ja ?? v.label?.en,
            ...(v.aliases?.length ? { aliases: v.aliases } : {}),
            ...(v.required ? { required: true } : {}),
            ...(v.suggested ? { suggested: true } : {}),
            ...(v.deprecated ? { deprecated: true } : {}),
          };
        }
        if (t.paramOrder) info.paramOrder = t.paramOrder;
        if (t.maps?.citoid) info.citoidMap = t.maps.citoid;
      }
      out[name] = info;
    }
  }
  return out;
}

async function main() {
  const [ja, two] = [await family('Citation/CS-ja'), await family('Citation/CS1')];
  const names = await listTemplates();
  const templates = await templateInfo(names);
  // Cite ○○ ja に TemplateData が無い場合、同じ CitationClass の Cite ○○2 のラベル・順序を流用する
  for (const t of Object.values(templates)) {
    if (t.family === 'ja' && !t.td) {
      const twin = Object.values(templates).find((x) => x.family === '2' && x.citationClass === t.citationClass && x.td);
      if (twin) {
        t.td = twin.td;
        t.paramOrder = twin.paramOrder;
      }
    }
  }
  const out = {
    generatedAt: new Date().toISOString(),
    wiki: 'ja.wikipedia.org',
    families: { ja, '2': two },
    templates,
  };
  const path = resolve(import.meta.dirname, '../src/core/templates/profiles.generated.json');
  writeFileSync(path, JSON.stringify(out, null, 1) + '\n');
  console.log(
    `wrote ${path}\n  ja: ${Object.keys(ja.basic).length} basic / ${Object.keys(ja.numbered).length} numbered\n  2 : ${Object.keys(two.basic).length} basic\n  templates: ${Object.keys(templates).length} (${Object.entries(templates).map(([k, v]) => `${k}[${v.citationClass}${v.td ? ',TD' : ''}]`).join(', ')})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
