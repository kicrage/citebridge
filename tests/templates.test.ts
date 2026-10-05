import { describe, expect, it } from 'vitest';
import { mergeResults } from '../src/core/merge/merge';
import type { Passage, PassageMode } from '../src/core/model/passage';
import { emptyRecord, type CiteRecord, type SourceId } from '../src/core/model/record';
import { parseCinii } from '../src/core/sources/cinii';
import { parseCrossref } from '../src/core/sources/crossref';
import { parseJalc } from '../src/core/sources/jalc';
import { parseNdlSru, parseNdldcOai } from '../src/core/sources/ndl';
import { generate } from '../src/core/templates/generate';
import { mapRecord } from '../src/core/templates/mapper';
import { getTemplate, paramStatus } from '../src/core/templates/profiles';
import { escapeValue, serializeTemplate, wrapRef } from '../src/core/templates/serialize';
import { validateCall } from '../src/core/templates/validate';
import { fixture, fixtureJson } from './helpers';

const one = (key: string, source: SourceId, record: Partial<CiteRecord>) => mergeResults(key, [{ source, record, raw: null }], [source]);
const TODAY = '2026-10-04';

const records: Record<string, CiteRecord> = {
  'journal-jalc': one('doi:10.20645/00000025', 'jalc', parseJalc(fixtureJson('jalc_10.20645_00000025.json').data)),
  'journal-crossref': one('doi:10.1038/nature12373', 'crossref', parseCrossref(fixtureJson('crossref_10.1038_nature12373.json').message)),
  'book-cinii': one('crid:1970586434846023986', 'cinii', parseCinii(fixtureJson('cir_book_1970586434846023986.json'), '1970586434846023986')),
  'ndldc-oai-book': one('ndldc:3437686', 'ndl', parseNdldcOai(fixture('ndldc_oai_3437686.xml'))!),
  'ndldc-oai-journal': one('ndldc:11228096', 'ndl', parseNdldcOai(fixture('ndldc_oai_11228096.xml'))!),
  'book-ndl': one('jpno:90035836', 'ndl', parseNdlSru(fixture('ndl_sru_jpno_90035836.xml'))!),
  web: {
    ...emptyRecord('url:https://www.example.jp/about'),
    type: 'webpage',
    title: { ja: '会社概要' },
    container: { ja: '例株式会社' },
    url: 'https://www.example.jp/about',
    issued: { y: 2024, m: 4, d: 1, raw: '2024-04-01' },
  },
  'news-kobe': {
    ...emptyRecord('kobenp:0100012345'),
    type: 'article-newspaper',
    ids: { kobenp: '0100012345' },
    title: { ja: '綿業の不振' },
    container: { ja: '大阪朝日新聞' },
    issued: { y: 1930, m: 5, d: 3, raw: '昭和5年5月3日' },
  },
  thesis: {
    ...emptyRecord('crid:1'),
    type: 'thesis',
    ids: { crid: '1500000000000000001' },
    title: { ja: '近代日本語の文体' },
    authors: [{ family: '山田', given: '花子' }],
    degree: '博士（文学）',
    publisher: '東京大学',
    issued: { y: 2010, raw: '2010' },
  },
  chapter: {
    ...emptyRecord('isbn:9784003101018'),
    type: 'chapter',
    ids: { isbn: '9784003101018' },
    title: { ja: '第三章' },
    container: { ja: '論集' },
    authors: [{ literal: '国立国会図書館' }],
    editors: [{ family: '佐藤', given: '次郎' }],
    publisher: '例出版',
    issued: { y: 2001, raw: '2001' },
  },
  ndldc: {
    ...emptyRecord('ndldc:1234567'),
    type: 'book',
    ids: { ndldc: '1234567' },
    koma: 45,
    title: { ja: '東京案内' },
    authors: [{ literal: '東京市' }],
    publisher: '裳華房',
    issued: { y: 1907, raw: '明治40' },
  },
};

const passage = (rec: CiteRecord, page = '12'): Passage => ({
  id: 'p1',
  recordKey: rec.key,
  text: '引用する一節。\n二行目',
  page,
  pageKind: page.includes('-') ? 'pp' : 'p',
  capturedAt: TODAY,
});

describe('ゴールデン: CiteRecord → wikitext', () => {
  for (const [name, rec] of Object.entries(records)) {
    it(name, async () => {
      const lines: string[] = [];
      for (const family of ['ja', '2'] as const) {
        const plain = generate(rec, { family, today: TODAY });
        lines.push(`## ${family} / 一節なし`, plain.inline, ...plain.issues.map((i) => `! ${i.level}: ${i.message}`));
        for (const mode of ['pages', 'quote', 'sfn'] as PassageMode[]) {
          const g = generate(rec, { family, passage: passage(rec), passageMode: mode, today: TODAY });
          lines.push(`## ${family} / ${mode}`, g.inline);
          if (g.bibliography) lines.push(g.bibliography);
          lines.push(...g.issues.map((i) => `! ${i.level}: ${i.message}`));
        }
      }
      await expect(lines.join('\n') + '\n').toMatchFileSnapshot(`golden/${name}.txt`);
    });
  }
});

describe('mapper', () => {
  it('ja 系は CS-ja、2 系は CS1 のテンプレートを選ぶ', () => {
    expect(mapRecord(records['journal-jalc'], { family: 'ja' }).call.template).toBe('Cite journal ja');
    expect(mapRecord(records['journal-jalc'], { family: '2' }).call.template).toBe('Cite journal2');
    expect(mapRecord(records['book-ndl'], { family: '2' }).call.template).toBe('Cite book2');
    expect(mapRecord(records.thesis, { family: 'ja' }).call.template).toBe('Cite thesis ja');
  });

  it('専用引数の無い識別子は id= にテンプレートで書く', () => {
    const p = mapRecord(records['book-ndl'], { family: 'ja' }).call.params;
    expect(p.find((x) => x.name === 'id')).toMatchObject({ value: '{{国立国会図書館書誌ID|000002041889}} {{全国書誌番号|90035836}}', raw: true });
  });

  it('volume-title は ja 系だけ', () => {
    const rec = { ...records['book-ndl'], volumeTitle: '上巻' };
    expect(mapRecord(rec, { family: 'ja' }).call.params.some((p) => p.name === 'volume-title')).toBe(true);
    expect(mapRecord(rec, { family: '2' }).call.params.some((p) => p.name === 'volume-title')).toBe(false);
  });

  it('author スタイル', () => {
    const p = mapRecord(records['journal-jalc'], { family: 'ja', settings: { nameStyle: 'author' } }).call.params;
    expect(p[0]).toEqual({ name: 'author1', value: '近藤 哲' });
  });

  it('DOI があれば url= を出さない（設定で出せる）', () => {
    const rec = { ...records['journal-crossref'], url: 'https://www.nature.com/articles/nature12373' };
    expect(mapRecord(rec, { family: '2' }).call.params.some((p) => p.name === 'url')).toBe(false);
    expect(mapRecord(rec, { family: '2', settings: { urlWithId: true } }).call.params.some((p) => p.name === 'url')).toBe(true);
  });

  it('Crossref の出版社は雑誌論文に書かない', () => {
    expect(mapRecord(records['journal-crossref'], { family: '2' }).call.params.some((p) => p.name === 'publisher')).toBe(false);
  });

  it('ページ範囲の一節は pages=、コマは at=', () => {
    const r = records['journal-jalc'];
    expect(mapRecord(r, { family: 'ja', passage: passage(r, '12-13') }).call.params.find((p) => /^(page|pages)$/.test(p.name))).toEqual({ name: 'pages', value: '12-13' });
    expect(mapRecord(r, { family: 'ja', passage: { ...passage(r, '45'), pageKind: 'koma' } }).call.params.find((p) => p.name === 'at')?.value).toBe('45コマ');
  });
});

describe('serialize', () => {
  it('値の | を {{!}} にし、テンプレートの中は保つ', () => {
    expect(escapeValue('A | B')).toBe('A {{!}} B');
    expect(escapeValue('{{NDLDC|123}} | x')).toBe('{{NDLDC|123}} {{!}} x');
    expect(escapeValue('[[リンク|表示]]')).toBe('[[リンク|表示]]');
    expect(escapeValue('題 [注] あり', { brackets: true })).toBe('題 &#91;注&#93; あり');
  });

  it('縦並び・= の前後空白', () => {
    const call = { template: 'Cite web ja', params: [{ name: 'title', value: 'T' }, { name: 'url', value: 'https://x.jp/' }] };
    expect(serializeTemplate(call, { layout: 'block', spacedEquals: true })).toBe('{{Cite web ja\n| title = T\n| url = https://x.jp/\n}}');
    expect(serializeTemplate(call, { spaceBeforePipe: false })).toBe('{{Cite web ja|title=T|url=https://x.jp/}}');
  });

  it('ref name', () => {
    expect(wrapRef('x', 'abc')).toBe('<ref name=abc>x</ref>');
    expect(wrapRef('x', '山田 2001')).toBe('<ref name="山田 2001">x</ref>');
  });
});

describe('validate', () => {
  const v = (template: string, params: [string, string][]) => validateCall({ template, params: params.map(([name, value]) => ({ name, value })) });

  it('Whitelist に無い引数・重複・必須欠落', () => {
    const issues = v('Cite journal ja', [['title', 'T'], ['foo', '1'], ['date', '2000'], ['date', '2001']]);
    expect(issues.map((i) => i.message)).toEqual(
      expect.arrayContaining([expect.stringContaining('foo'), expect.stringContaining('重複'), expect.stringContaining('journal')]),
    );
  });

  it('first= だけで last= が無い', () => {
    expect(v('Cite book ja', [['title', 'T'], ['first1', '太郎']]).some((i) => i.param === 'first1')).toBe(true);
  });

  it('page に範囲・ISBN の誤り', () => {
    const issues = v('Cite book2', [['title', 'T'], ['page', '1-3'], ['isbn', '9784003101019']]);
    expect(issues.map((i) => i.param)).toEqual(expect.arrayContaining(['page', 'isbn']));
  });

  it('access-date だけでは url の無い警告', () => {
    expect(v('Cite book ja', [['title', 'T'], ['access-date', '2026-10-04']]).some((i) => i.param === 'access-date')).toBe(true);
  });

  it('Cite web は url と access-date が必須', () => {
    expect(v('Cite web2', [['title', 'T']]).map((i) => i.param)).toContain('url');
  });

  it('正しいものは問題なし', () => {
    expect(v('Cite journal ja', [['last1', '山田'], ['first1', '太郎'], ['title', 'T'], ['journal', 'J'], ['date', '2000-01'], ['pages', '1-3'], ['doi', '10.1234/abc']])).toEqual([]);
  });
});

describe('profiles', () => {
  it('Whitelist に基づく判定', () => {
    const j = getTemplate('Cite journal ja')!;
    expect(paramStatus(j, 'title')).toBe('ok');
    expect(paramStatus(j, 'last12')).toBe('ok');
    expect(paramStatus(j, 'coauthors')).toBe('deprecated');
    expect(paramStatus(j, 'degree')).toBe('unknown');
    expect(paramStatus(getTemplate('Cite thesis ja')!, 'degree')).toBe('ok');
  });
});

describe('mapper: 出版者の重複', () => {
  it('新聞名と同じ出版者は書かない', () => {
    const rec = { ...records['news-kobe'], publisher: '大阪朝日新聞' };
    expect(mapRecord(rec, { family: 'ja' }).call.params.some((p) => p.name === 'publisher')).toBe(false);
    expect(mapRecord({ ...rec, publisher: '大阪朝日新聞社' }, { family: 'ja' }).call.params.some((p) => p.name === 'publisher')).toBe(false);
  });
});
