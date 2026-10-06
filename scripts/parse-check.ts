/**
 * 生成した wikitext を jawiki の action=parse（読み取りのみ）に通して、CS1 / CS-ja のエラー表示・
 * メンテナンスカテゴリ・Sfn の参照切れが出ないか確認する。ネットワークが要るのでテストには含めない。
 *   npm run check:parse
 * 対象: tests/golden の全行、tests/fixtures の録画から作ったコトバンク・新聞記事文庫・NDL PID・CiNii の出典。
 * 記事題名の無い雑誌の号（ndldc 11228096）は title 必須エラーになる（利用者が補う前提）ので期待どおり。
 * 保存はしない。Wikimedia API は連続アクセスで 429 になるので 1.5 秒間隔。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { mergeResults } from '../src/core/merge/merge';
import type { CiteRecord, SourceId } from '../src/core/model/record';
import { parseCinii } from '../src/core/sources/cinii';
import { parseKobeNp } from '../src/core/sources/kobe';
import { entryToRecord, parseKotobankPage } from '../src/core/sources/kotobank';
import { parseNdldcOai } from '../src/core/sources/ndl';
import { generate } from '../src/core/templates/generate';

const API = 'https://ja.wikipedia.org/w/api.php';
const UA = 'Citebridge/0.1 (https://github.com/kicrage/citebridge; parse check)';
let last = 0;

async function parse(text: string): Promise<{ html: string; categories: string[] }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = last + 1500 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    try {
      const body = new URLSearchParams({
        action: 'parse', format: 'json', formatversion: '2', contentmodel: 'wikitext', title: 'Citebridge検証',
        prop: 'text|categories', disablelimitreport: '1', disableeditsection: '1', text,
      });
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Api-User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (res.status === 429 || res.status === 503) {
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
        continue;
      }
      const j: any = await res.json();
      if (j.error) throw new Error(JSON.stringify(j.error));
      return { html: j.parse.text, categories: j.parse.categories.map((c: any) => c.category) };
    } catch (e) {
      if (attempt === 4) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error('unreachable');
}

const fx = (n: string) => readFileSync(`tests/fixtures/${n}`, 'utf8');
const one = (key: string, source: SourceId, record: Partial<CiteRecord>): CiteRecord =>
  mergeResults(key, [{ source, record, raw: null }], [source]);

interface Item {
  label: string;
  wikitext: string;
  sfn?: string;
}
const items: Item[] = [];

// 1) ゴールデンの全行（重複除去）。Sfn 形式は本文の {{Sfn}} と参考文献の組で確認する
const seen = new Set<string>();
for (const f of readdirSync('tests/golden').filter((x) => x.endsWith('.txt'))) {
  let head = '';
  let pendingSfn: string | undefined;
  for (const l of readFileSync(`tests/golden/${f}`, 'utf8').replace(/\r/g, '').split('\n')) {
    if (l.startsWith('## ')) {
      head = l.slice(3);
      pendingSfn = undefined;
      continue;
    }
    if (!l || l.startsWith('!')) continue;
    if (l.startsWith('{{Sfn|')) {
      pendingSfn = l;
      continue;
    }
    const m = /^(?:<ref>|\* )(\{\{[\s\S]*\}\})(?:<\/ref>)?$/.exec(l);
    if (!m || seen.has(m[1] + (pendingSfn ?? ''))) continue;
    seen.add(m[1] + (pendingSfn ?? ''));
    items.push({ label: `${f} [${head}]`, wikitext: m[1], sfn: pendingSfn });
  }
}

// 2) 録画から作る実データの出典
const extra: [string, CiteRecord][] = [];
const kb = parseKotobankPage(fx('kotobank_864282.html'))!;
for (const e of kb.entries.slice(0, 3)) extra.push([`kotobank ${e.dictionary}`, one('k', 'kotobank', entryToRecord(e, kb))]);
const ks = parseKotobankPage(fx('kotobank_17193_trimmed.html'))!;
for (const e of ks.entries.filter((x) => /ブリタニカ|大辞泉|日本大百科/.test(x.dictionary))) extra.push([`kotobank ${e.dictionary}`, one('k', 'kotobank', entryToRecord(e, ks))]);
for (const id of ['0100165761', '0100165762']) extra.push([`kobe ${id}`, one(`kobenp:${id}`, 'kobe', parseKobeNp(fx(`kobe_np_${id}.html`), id)!)]);
for (const p of ['3437686', '1020999', '897391', '11228096', '2549497', '1311999', '8941273'])
  extra.push([`ndldc ${p}`, one(`ndldc:${p}`, 'ndl', parseNdldcOai(fx(`ndldc_oai_${p}.xml`))!)]);
extra.push(['cinii 1390853649708396416', one('c', 'cinii', parseCinii(JSON.parse(fx('cir_1390853649708396416.json')), '1390853649708396416'))]);
for (const [label, rec] of extra)
  for (const family of ['ja', '2'] as const)
    items.push({ label: `${label} (${family})`, wikitext: generate(rec, { family, today: '2026-10-06' }).inline.replace(/^<ref>|<\/ref>$/g, '') });

// 3) action=parse の結果を見る
function problems(r: { html: string; categories: string[] }) {
  const errs = [...r.html.matchAll(/class="[^"]*\b(?:cs1-visible-error|cs1-hidden-error|error)\b[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div|strong)>/g)].map((m) =>
    m[1].replace(/<[^>]+>/g, '').trim().slice(0, 100),
  );
  const cats = r.categories.filter((c) => /^(CS1|引用|Cite)/.test(c) || /エラー|メンテナンス|警告|ハーバード|Harv|sfn/i.test(c));
  return { errs, cats };
}

const out: { bad: boolean; expected: boolean; text: string }[] = [];
for (const it of items) {
  const r = await parse(it.sfn ? `本文${it.sfn}\n\n== 参考文献 ==\n* ${it.wikitext}` : it.wikitext);
  const { errs, cats } = problems(r);
  const bad = errs.length > 0 || cats.length > 0;
  // 記事題名の無い雑誌の号は title 必須エラーになる（利用者が補う前提）
  const expected = bad && /title/.test(cats.join()) && cats.length === 1 && /ndldc[- ].*(?:11228096|journal)/.test(it.label);
  out.push({
    bad,
    expected,
    text:
      `${bad ? (expected ? '△' : '✗') : '✓'} ${it.label}${it.sfn ? ' +sfn' : ''}` +
      (bad ? `\n    errors: ${JSON.stringify(errs)}\n    cats: ${cats.join(',')}\n    ${it.wikitext.slice(0, 260)}` : ''),
  });
}
console.log(out.map((o) => o.text).join('\n'));
const ng = out.filter((o) => o.bad && !o.expected).length;
console.log(`\n${out.length} 件、問題あり ${ng} 件（期待どおりの title 不足 ${out.filter((o) => o.expected).length} 件）`);
process.exit(ng ? 1 : 0);
