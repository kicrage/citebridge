import { describe, expect, it } from 'vitest';
import { detectIds } from '../src/core/ids/detect';
import { idKey } from '../src/core/ids/types';
import { ChooseEntryError, entryLabel, parsePublisher, parseWriters, parseKotobankPage } from '../src/core/sources/kotobank';
import { resolveId } from '../src/core/sources/resolve';
import { generate } from '../src/core/templates/generate';
import { fakeContext, fixture } from './helpers';

// 録画: https://kotobank.jp/word/平野郷-864282（全項目）、夏目漱石-17193（各項目の本文を末尾 300 字に削ったもの）
const hirano = () => parseKotobankPage(fixture('kotobank_864282.html'))!;
const soseki = () => parseKotobankPage(fixture('kotobank_17193_trimmed.html'))!;

const URL_HIRANO = 'https://kotobank.jp/word/%E5%B9%B3%E9%87%8E%E9%83%B7-864282';
const routes: [RegExp, string][] = [[/kotobank\.jp\/word\/平野郷-864282$/, 'kotobank_864282.html']];

describe('コトバンクの URL → 識別子', () => {
  it('#w- を項目の識別子（wid）として拾う', () => {
    expect(detectIds(`${URL_HIRANO}#w-1199559`)[0]).toMatchObject({ type: 'kotobank', value: '平野郷-864282', extra: { wid: '1199559' }, confidence: 'exact' });
    expect(detectIds(URL_HIRANO)[0]).toMatchObject({ type: 'kotobank', value: '平野郷-864282' });
    expect(detectIds(URL_HIRANO)[0].extra).toBeUndefined();
  });

  it('レコードのキーは項目ごとに変える', () => {
    expect(idKey(detectIds(`${URL_HIRANO}#w-1199559`)[0])).toBe('kotobank:平野郷-864282#w-1199559');
    expect(idKey(detectIds(`${URL_HIRANO}#w-864282`)[0])).not.toBe(idKey(detectIds(`${URL_HIRANO}#w-1199559`)[0]));
  });
});

describe('コトバンクのページ解析', () => {
  it('辞書ごとの項目と #w- の id を取る。他項目からの引用（旧版）は項目に含めない', () => {
    const p = hirano();
    expect(p.wordPath).toBe('平野郷-864282');
    expect(p.baseUrl).toBe(URL_HIRANO);
    expect(p.entries.map((e) => [e.wid, e.dictionary])).toEqual([
      ['864282', '百科事典マイペディア'],
      ['1199559', '改訂新版 世界大百科事典'],
      ['3354299', '日本歴史地名大系'],
      ['3333380', '日本歴史地名大系'],
      ['3333332', '日本歴史地名大系'],
    ]);
  });

  it('出版社と執筆者（世界大百科事典の末尾）', () => {
    const [mypedia, sekai, chimei] = hirano().entries;
    expect(mypedia).toMatchObject({ publisher: '平凡社', authors: [] });
    expect(sekai).toMatchObject({ publisher: '平凡社', authors: ['脇田 修'] });
    expect(chimei).toMatchObject({ publisher: '平凡社' });
  });

  it('同じ辞書に複数項目があるときは候補の表示で見分ける', () => {
    const p = hirano();
    const labels = p.entries.map((e) => entryLabel(e, p));
    expect(labels[1]).toBe('改訂新版 世界大百科事典（脇田 修）');
    expect(labels[2]).toMatch(/^日本歴史地名大系 — .+/);
    expect(new Set(labels.slice(2)).size).toBe(3);
    expect(labels[3]).toMatch(/「.+…」$/);
  });

  it('出版社の書式はさまざま', () => {
    const p = soseki();
    const pub = (dict: string) => p.entries.find((e) => e.dictionary === dict)?.publisher;
    expect(pub('デジタル大辞泉')).toBe('小学館');
    expect(pub('日本大百科全書(ニッポニカ)')).toBe('小学館');
    expect(pub('共同通信ニュース用語解説')).toBe('共同通信社');
    expect(pub('20世紀日本人名事典')).toBe('日外アソシエーツ');
    expect(pub('山川 日本史小辞典 改訂新版')).toBe('山川出版社');
    expect(pub('デジタル版 日本人名大辞典+Plus')).toBe('講談社');
    // 辞書名しか書かれていないものは出版社なし
    expect(pub('ブリタニカ国際大百科事典 小項目事典')).toBeUndefined();
    expect(pub('精選版 日本国語大辞典')).toBeUndefined();
    expect(p.entries.find((e) => e.dictionary === '改訂新版 世界大百科事典')?.authors).toEqual(['桶谷 秀昭']);
  });

  it('parsePublisher / parseWriters', () => {
    expect(parsePublisher('株式会社平凡社「改訂新版 世界大百科事典」', '改訂新版 世界大百科事典')).toBe('平凡社');
    expect(parsePublisher(undefined, 'x')).toBeUndefined();
    expect(parseWriters('本文。 執筆者： 脇田 修')).toEqual(['脇田 修']);
    expect(parseWriters('執筆者： 甲 野、乙 山')).toEqual(['甲 野', '乙 山']);
    expect(parseWriters('本文だけ')).toEqual([]);
  });

  it('コトバンクのページでなければ undefined', () => {
    expect(parseKotobankPage('<html><body>x</body></html>')).toBeUndefined();
  });
});

describe('resolveId（コトバンク）', () => {
  const today = '2026-10-05';

  it('#w- 付きの URL からそのまま出典を作る（世界大百科事典）', async () => {
    const ctx = fakeContext(routes);
    const { record } = await resolveId(detectIds(`${URL_HIRANO}#w-1199559`)[0], ctx);
    expect(ctx.calls).toHaveLength(1);
    expect(record.key).toBe('kotobank:平野郷-864282#w-1199559');
    expect(generate(record, { family: 'ja', today, settings: { nameStyle: 'author' } }).inline).toBe(
      `<ref>{{Cite encyclopedia ja |author1=脇田 修 |title=平野郷 |encyclopedia=改訂新版 世界大百科事典 |publisher=平凡社 |url=${URL_HIRANO}#w-1199559 |access-date=${today} |via=コトバンク}}</ref>`,
    );
  });

  it('マイペディアの項目（#w-864282）', async () => {
    const { record } = await resolveId(detectIds(`${URL_HIRANO}#w-864282`)[0], fakeContext(routes));
    expect(generate(record, { family: 'ja', today }).inline).toBe(
      `<ref>{{Cite encyclopedia ja |title=平野郷 |encyclopedia=百科事典マイペディア |publisher=平凡社 |url=${URL_HIRANO}#w-864282 |access-date=${today} |via=コトバンク}}</ref>`,
    );
  });

  it('#w- が無く項目が複数あれば、候補（辞書名つき）を返すための例外', async () => {
    const err = await resolveId(detectIds(URL_HIRANO)[0], fakeContext(routes)).catch((e) => e);
    expect(err).toBeInstanceOf(ChooseEntryError);
    expect(err.candidates).toHaveLength(5);
    expect(err.candidates[1]).toMatchObject({ type: 'kotobank', value: '平野郷-864282', extra: { wid: '1199559' }, label: '改訂新版 世界大百科事典（脇田 修）' });
    // 選んだ候補をそのまま resolve できる
    const { record } = await resolveId(err.candidates[0], fakeContext(routes));
    expect(record.container).toEqual({ ja: '百科事典マイペディア' });
  });

  it('存在しない項目（wid）は例外', async () => {
    await expect(resolveId(detectIds(`${URL_HIRANO}#w-1`)[0], fakeContext(routes))).rejects.toThrow(/w-1/);
  });
});
