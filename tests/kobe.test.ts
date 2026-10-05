import { describe, expect, it } from 'vitest';
import { detectIds } from '../src/core/ids/detect';
import { kobeIdFromHandle, parseKobeNp, parseKobeTable } from '../src/core/sources/kobe';
import { resolveId } from '../src/core/sources/resolve';
import { generate } from '../src/core/templates/generate';
import { fakeContext, fixture } from './helpers';

// 録画: https://da.lib.kobe-u.ac.jp/da/np/{メタデータID}/（記事ページの HTML をそのまま）
const parse = (id: string) => parseKobeNp(fixture(`kobe_np_${id}.html`), id)!;

describe('新聞記事文庫', () => {
  it('表を項目名 → 値の配列にする（同名項目の続き行も拾う）', () => {
    const t = parseKobeTable(fixture('kobe_np_0100165761.html'));
    expect(t.get('新聞名')).toEqual(['大阪朝日新聞']);
    expect(t.get('切抜帳')).toEqual(['23.都市', '01.都市']);
    expect(t.get('出版日')).toEqual(['1922-12-21/1922-12-28']);
  });

  it('連載記事: 著者の肩書を落とし、日付範囲は初回日を使う', () => {
    expect(parse('0100165761')).toMatchObject({
      type: 'article-newspaper',
      ids: { kobenp: '0100165761' },
      title: { ja: '都市の分裂繁殖論 （一〜五）' },
      container: { ja: '大阪朝日新聞' },
      authors: [{ literal: '大屋霊城' }],
      issued: { y: 1922, m: 12, d: 21 },
      language: 'ja',
    });
  });

  it('「主見出し : 副見出し」は題名と副題に分ける。著者名の項目が無い記事もある', () => {
    expect(parse('0100165762')).toMatchObject({
      title: { ja: '新輸出税率' },
      subtitle: { ja: '五月十五日実施' },
      container: { ja: '大阪朝日新聞' },
      authors: [],
      issued: { y: 1931, m: 4, d: 18 },
    });
  });

  it('別の新聞（中外商業新報）', () => {
    expect(parse('0100200000').container).toEqual({ ja: '中外商業新報' });
  });

  it('記事ページでなければ undefined', () => {
    expect(parseKobeNp('<html><title>Not Found</title></html>', '1')).toBeUndefined();
  });

  it('ハンドルから ID を取る（神戸大学のプレフィックスのみ）', () => {
    expect(kobeIdFromHandle('20.500.14094/0100165761')).toBe('0100165761');
    expect(kobeIdFromHandle('20.500.14094/abc')).toBeUndefined();
    expect(kobeIdFromHandle('2433/123456789')).toBeUndefined();
  });

  const routes: [RegExp, string][] = [[/da\.lib\.kobe-u\.ac\.jp\/da\/np\/0100165761\/$/, 'kobe_np_0100165761.html']];

  it('Handle URL でも記事ページを 1 回だけ引き、hdl= を重ねずに出典を作る', async () => {
    const ctx = fakeContext(routes);
    const { record, errors } = await resolveId(detectIds('https://hdl.handle.net/20.500.14094/0100165761')[0], ctx);
    expect(errors).toEqual([]);
    expect(ctx.calls).toEqual(['https://da.lib.kobe-u.ac.jp/da/np/0100165761/']);
    expect(record.provenance.container).toBe('kobe');
    expect(generate(record, { family: 'ja', today: '2026-10-05' }).inline).toBe(
      '<ref>{{Cite news ja |author1=大屋霊城 |title=都市の分裂繁殖論 （一〜五） |newspaper=大阪朝日新聞 |date=1922-12-21 |url=https://hdl.handle.net/20.500.14094/0100165761 |access-date=2026-10-05}}</ref>',
    );
  });

  it('存在しない記事は例外', async () => {
    await expect(resolveId(detectIds('0100999999')[0], fakeContext([]))).rejects.toThrow();
  });
});
