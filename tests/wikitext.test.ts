import { describe, expect, it } from 'vitest';
import { applyFills, citeFamily, detectStyle, duplicateRefs, fillSuggestions, findAllCites, findRefs } from '../src/core/wikitext/refs';
import { findTemplates, paramKey, parseTemplateAt } from '../src/core/wikitext/template';

const ARTICLE = `'''例'''は例である<ref name="a">{{Cite book ja |last1=夏目 |first1=漱石 |title=吾輩は猫である |publisher= |date=1990}}</ref>。
次の文<ref>{{Cite journal ja |author=近藤哲 |title=漱石とハーン [[神秘主義|神秘]] |journal=研究年報 |id={{NAID|120006470875}} }}</ref>。
<!-- <ref>{{Cite web2|title=コメント内}}</ref> -->
再掲<ref name="a" />。重複<ref>{{Cite book ja |title=吾輩は猫である |isbn=4-00-310101-4}}</ref><ref>{{Cite book ja|title=吾輩は猫である|isbn=4-00-310101-4}}</ref>
== 参考文献 ==
* {{Cite book2
| last = 山田
| title = 本
}}
`;

describe('テンプレート解析', () => {
  it('入れ子のテンプレートとリンクの | で区切らない', () => {
    const t = parseTemplateAt('{{Cite journal ja |title=A [[B|C]] |id={{NAID|1}} |x = y}}', 0)!;
    expect(t.name).toBe('Cite journal ja');
    expect(t.params.map((p) => [p.name, p.value])).toEqual([
      ['title', 'A [[B|C]]'],
      ['id', '{{NAID|1}}'],
      ['x', 'y'],
    ]);
  });

  it('位置引数', () => {
    const t = parseTemplateAt('{{Sfn|夏目|1990|p=12}}', 0)!;
    expect(t.params.map((p) => [p.name, p.value, p.named])).toEqual([
      ['1', '夏目', false],
      ['2', '1990', false],
      ['p', '12', true],
    ]);
  });

  it('閉じていないものは undefined', () => {
    expect(parseTemplateAt('{{Cite book ja |title=x', 0)).toBeUndefined();
  });

  it('コメント内は無視', () => {
    expect(findTemplates('<!-- {{a}} -->{{b}}').map((t) => t.name)).toEqual(['b']);
  });

  it('引数名の同一視', () => {
    expect(paramKey('access-date')).toBe(paramKey('accessdate'));
    expect(paramKey('last1')).toBe(paramKey('last'));
    expect(paramKey('author')).toBe(paramKey('last1'));
    expect(paramKey('editor1-last')).toBe(paramKey('editor-last'));
  });
});

describe('出典の列挙', () => {
  it('系統', () => {
    expect(citeFamily('Cite book ja')).toBe('ja');
    expect(citeFamily('cite_web2')).toBe('2');
    expect(citeFamily('Cite book')).toBe('legacy');
    expect(citeFamily('Sfn')).toBeUndefined();
  });

  it('<ref> と参考文献節', () => {
    const refs = findRefs(ARTICLE);
    expect(refs).toHaveLength(5);
    expect(refs[0]).toMatchObject({ name: 'a' });
    expect(refs[2].name).toBe('a');
    expect(refs[2].body).toBeUndefined();
    expect(findAllCites(ARTICLE).map((c) => c.name)).toEqual(['Cite book ja', 'Cite journal ja', 'Cite book ja', 'Cite book ja', 'Cite book2']);
  });

  it('記事のスタイル推定', () => {
    const s = detectStyle(ARTICLE);
    expect(s.family).toBe('ja');
    expect(s.counts).toEqual({ ja: 4, '2': 1, legacy: 0 });
    expect(s.serialize.layout).toBe('inline');
  });

  it('重複', () => {
    const d = duplicateRefs(findRefs(ARTICLE));
    expect(d).toHaveLength(1);
    expect(d[0]).toHaveLength(2);
  });
});

describe('空欄補完', () => {
  const gen = [
    { name: 'last1', value: '夏目' },
    { name: 'first1', value: '漱石' },
    { name: 'title', value: '吾輩は猫である' },
    { name: 'publisher', value: '岩波書店' },
    { name: 'date', value: '1990-04' },
    { name: 'isbn', value: '4-00-310101-4' },
    { name: 'id', value: '{{全国書誌番号|90035836}}', raw: true },
  ];

  it('既存値は上書きせず、空欄と未記入だけを候補にする', () => {
    const t = findRefs(ARTICLE)[0].cites[0];
    const f = fillSuggestions(t, gen);
    expect(f.map((x) => [x.param.name, x.kind])).toEqual([
      ['publisher', 'empty'],
      ['isbn', 'missing'],
      ['id', 'missing'],
    ]);
    const out = applyFills(ARTICLE, t, f);
    expect(out.slice(t.start, out.indexOf('</ref>'))).toBe(
      '{{Cite book ja |last1=夏目 |first1=漱石 |title=吾輩は猫である |publisher=岩波書店 |date=1990 |isbn=4-00-310101-4 |id={{全国書誌番号|90035836}}}}',
    );
    // 他の部分は変わらない
    expect(out.slice(out.indexOf('</ref>'))).toBe(ARTICLE.slice(ARTICLE.indexOf('</ref>')));
  });

  it('author= があれば著者は補わない', () => {
    const t = findRefs(ARTICLE)[1].cites[0];
    expect(fillSuggestions(t, gen).some((f) => /^(last|first)/.test(f.param.name))).toBe(false);
  });

  it('縦並びのテンプレートは縦並びで足す', () => {
    const t = findAllCites(ARTICLE).at(-1)!;
    const out = applyFills(ARTICLE, t, [{ param: { name: 'publisher', value: '例出版' }, kind: 'missing' }]);
    expect(out.slice(t.start)).toBe('{{Cite book2\n| last = 山田\n| title = 本\n| publisher = 例出版\n}}\n');
  });
});

describe('参考文献節への追記', () => {
  const text = `本文{{Sfn|山田|2000|p=1}}。\n== 脚注 ==\n{{Reflist}}\n== 参考文献 ==\n=== 書籍 ===\n* {{Cite book ja |last1=山田 |title=本 |ref={{SfnRef|山田|2000}}}}\n\n== 外部リンク ==\n* x\n[[Category:例]]`;

  it('最後の箇条書きの後に足す', async () => {
    const { insertBibliography } = await import('../src/core/wikitext/sections');
    const r = insertBibliography(text, '* {{Cite book ja |title=新}}');
    expect(r.status).toBe('inserted');
    expect(r.text).toContain('{{SfnRef|山田|2000}}}}\n* {{Cite book ja |title=新}}\n\n== 外部リンク ==');
  });

  it('既にあれば足さない・節が無ければ知らせる', async () => {
    const { insertBibliography } = await import('../src/core/wikitext/sections');
    expect(insertBibliography(text, 'x', { dedupe: ['{{SfnRef|山田|2000}}'] }).status).toBe('exists');
    expect(insertBibliography('本文のみ', 'x').status).toBe('no-section');
  });
});

describe('既存出典の識別子', () => {
  it('doi・ISBN・id= のテンプレート・URL', async () => {
    const { lookupIdOf } = await import('../src/core/wikitext/refs');
    const t = (s: string) => parseTemplateAt(s, 0)!;
    expect(lookupIdOf(t('{{Cite journal ja |title=x |doi=10.20645/00000025}}'))).toMatchObject({ type: 'doi', value: '10.20645/00000025' });
    expect(lookupIdOf(t('{{Cite book ja |title=x |isbn=4-00-310101-4}}'))).toMatchObject({ type: 'isbn', value: '9784003101018' });
    expect(lookupIdOf(t('{{Cite book ja |title=x |id={{NDLDC|1234567}}}}'))).toMatchObject({ type: 'ndldc', value: '1234567' });
    expect(lookupIdOf(t('{{Cite web ja |title=x |url=https://cir.nii.ac.jp/crid/1390853649708396416}}'))).toMatchObject({ type: 'crid' });
    expect(lookupIdOf(t('{{Cite book ja |title=x}}'))).toBeUndefined();
  });

  it('本文が変わっても位置を探し直す', async () => {
    const { relocate } = await import('../src/core/wikitext/refs');
    const t = findAllCites(ARTICLE)[1];
    const edited = '追記した文。' + ARTICLE;
    expect(relocate(edited, t)?.start).toBe(t.start + '追記した文。'.length);
    expect(relocate('別の記事', t)).toBeUndefined();
  });
});
