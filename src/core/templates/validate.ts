import { normalizeIsbn } from '../ids/detect';
import { isValidIssn } from '../ids/checksum';
import { parseDate } from '../transforms/dates';
import { isPageRange } from '../transforms/numbers';
import { paramKey } from '../wikitext/template';
import type { TemplateCall } from './mapper';
import { getTemplate, paramStatus, requiredParams } from './profiles';

export interface Issue {
  level: 'error' | 'warning';
  param?: string;
  message: string;
}

/**
 * 生成・編集後の引数列について、CS1 / CS-ja が表示するエラー・保守カテゴリを事前に予測する。
 * モジュールの検査をすべて再現するものではなく、よく起きるものに絞っている。
 */
export function validateCall(call: TemplateCall): Issue[] {
  const issues: Issue[] = [];
  const tpl = getTemplate(call.template);
  if (!tpl) return [{ level: 'error', message: `テンプレート「${call.template}」の定義がありません` }];

  const byKey = new Map<string, string>();
  for (const p of call.params) {
    const k = paramKey(p.name);
    if (byKey.has(k)) issues.push({ level: 'error', param: p.name, message: `引数「${p.name}」が重複しています` });
    byKey.set(k, p.value.trim());
    const st = paramStatus(tpl, p.name);
    if (st === 'unknown') issues.push({ level: 'error', param: p.name, message: `「${p.name}」は ${tpl.name} では使えない引数です` });
    if (st === 'deprecated') issues.push({ level: 'warning', param: p.name, message: `「${p.name}」は非推奨の引数です` });
  }
  const has = (...names: string[]) => names.some((n) => byKey.get(paramKey(n)));

  for (const r of requiredParams(tpl)) {
    if (!has(r.name, ...r.aliases)) {
      // 必須とされていても、ほかの引数で代替できるもの
      if (r.name === 'date' && has('year')) continue;
      if (r.name === 'access-date' && !has('url')) continue;
      issues.push({ level: 'error', param: r.name, message: `必須の引数「${r.name}」がありません` });
    }
  }
  if (!has('title') && !has('chapter')) {
    if (!issues.some((i) => i.param === 'title')) issues.push({ level: 'error', param: 'title', message: '題名（title）がありません' });
  }

  if (has('access-date') && !has('url')) issues.push({ level: 'warning', param: 'access-date', message: 'url= が無いと access-date= は表示されません' });
  if (has('url')) {
    const u = byKey.get('url')!;
    if (!/^(https?:)?\/\//i.test(u) && !/^\{\{/.test(u)) issues.push({ level: 'error', param: 'url', message: 'URL の形式が正しくありません' });
  }
  if (has('chapter') && tpl.citationClass !== 'book' && tpl.citationClass !== 'conference')
    issues.push({ level: 'warning', param: 'chapter', message: `${tpl.name} では chapter= は表示されないことがあります` });

  for (const k of ['date', 'access-date', 'archive-date']) {
    const v = byKey.get(paramKey(k));
    if (v && !parseDate(v)?.y) issues.push({ level: 'warning', param: k, message: `${k}= の日付を解釈できません（${v}）` });
  }
  const page = byKey.get('page');
  if (page && isPageRange(page)) issues.push({ level: 'warning', param: 'page', message: 'ページ範囲は pages= に書きます' });
  const pages = byKey.get('pages');
  if (pages && /^\d+$/.test(pages)) issues.push({ level: 'warning', param: 'pages', message: '単一ページは page= に書きます' });
  if ([page, pages, byKey.get('at')].filter(Boolean).length > 1)
    issues.push({ level: 'error', param: 'page', message: 'page= / pages= / at= は1つだけにしてください' });

  const isbn = byKey.get('isbn');
  if (isbn && !normalizeIsbn(isbn)) issues.push({ level: 'error', param: 'isbn', message: `ISBN のチェックディジットが合いません（${isbn}）` });
  const issn = byKey.get('issn');
  if (issn && !isValidIssn(issn)) issues.push({ level: 'error', param: 'issn', message: `ISSN が正しくありません（${issn}）` });
  const doi = byKey.get('doi');
  if (doi && !/^10\.\d{4,9}\/\S+$/.test(doi)) issues.push({ level: 'error', param: 'doi', message: `DOI の形式が正しくありません（${doi}）` });

  for (const p of call.params) {
    if (/^(first|editor\d*-first|translator\d*-first)\d*$/.test(p.name)) {
      const last = p.name.replace('first', 'last');
      if (!byKey.get(paramKey(last))) issues.push({ level: 'error', param: p.name, message: `${p.name}= に対応する ${last}= がありません` });
    }
  }
  return issues;
}
