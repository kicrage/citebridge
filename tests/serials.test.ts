import { describe, expect, it } from 'vitest';
import { detectIds } from '../src/core/ids/detect';
import { ChooseEntryError } from '../src/core/sources/choose';
import { findCrid, findSerialsByIssn, parseCinii } from '../src/core/sources/cinii';
import { snapshotFromHtml } from '../src/core/sources/html';
import { dedupeScripts, parsePageSnapshot } from '../src/core/sources/pagemeta';
import { resolveId } from '../src/core/sources/resolve';
import { generate } from '../src/core/templates/generate';
import { fakeContext, fixture, fixtureJson } from './helpers';

// 録画: CiNii Research の opensearch/books?issn=0385-8642・?ncid=AN00029633、crid/1971712334669956506.json（雑誌）、
// 機関リポジトリ（WEKO）の記事ページ https://ocu-omu.repo.nii.ac.jp/records/2014755 の meta 部分
const routes: [RegExp, string][] = [
  [/opensearch\/books\?issn=0385-8642/, 'cir_books_issn_0385-8642.json'],
  [/opensearch\/books\?ncid=AN00029633/, 'cir_books_ncid_AN00029633.json'],
  [/crid\/1971712334669956506\.json/, 'cir_serial_1971712334669956506.json'],
];
const today = '2026-10-06';

describe('機関リポジトリ（WEKO）のページ meta', () => {
  const page = () =>
    parsePageSnapshot({
      ...snapshotFromHtml(fixture('repo_ocu_2014755_head.html'), 'https://ocu-omu.repo.nii.ac.jp/records/2014755'),
      // 本文の表の「識別子タイプ NCID ／ 関連識別子 AN00029633」は取り込み側（collectPage）が meta として渡す
      metas: [...snapshotFromHtml(fixture('repo_ocu_2014755_head.html'), '').metas, ['citebridge:ncid', 'AN00029633']],
    });

  it('1 人につき漢字・カナ・ローマ字の 3 表記が並ぶ著者は、漢字だけを残し、カナを読みにする', () => {
    expect(page().authors).toEqual([
      { family: '白木', given: '小三郎', yomi: 'シラキ コサブロウ' },
      { family: '辻野', given: '増枝', yomi: 'ツジノ マスエ' },
      { family: '青木', given: '洋子', yomi: 'アオキ ヨウコ' },
    ]);
  });

  it('ISSN と本文の NCID を拾い、巻・ページ・日付も取れる', () => {
    expect(page()).toMatchObject({
      type: 'article-journal',
      ids: { issn: '0385-8642', ncid: 'AN00029633' },
      title: { ja: '「平野郷」について' },
      container: { ja: '大阪市立大学生活科学部紀要' },
      volume: '23',
      pages: '119-138',
      issued: { y: 1976, m: 3 },
    });
  });

  it('出典に issn= と ncid= が出る', () => {
    const g = generate({ ...fromPage(page()) }, { family: 'ja', today });
    expect(g.inline).toContain('|issn=0385-8642');
    expect(g.inline).toContain('|ncid=AN00029633');
    expect(g.inline).toContain('|last1=白木 |first1=小三郎 |last2=辻野 |first2=増枝 |last3=青木 |first3=洋子');
  });

  it('dedupeScripts: 漢字の無い（欧文だけ・カナだけ）の著者リストはそのまま', () => {
    expect(dedupeScripts(['Smith, John', 'Doe, Jane'])).toEqual([
      { family: 'Smith', given: 'John' },
      { family: 'Doe', given: 'Jane' },
    ]);
    expect(dedupeScripts(['山田, 太郎', '鈴木, 花子'])).toHaveLength(2);
  });
});

function fromPage(partial: ReturnType<typeof parsePageSnapshot>) {
  return {
    key: 'url:x',
    ids: {},
    type: 'article-journal' as const,
    authors: [],
    editors: [],
    translators: [],
    provenance: {},
    schemaVersion: 1 as const,
    ...partial,
  } as any;
}

describe('雑誌の NCID・ISSN（CiNii Research）', () => {
  it('雑誌のレコードは誌名＋ISSN。題名は空（記事名は利用者が補う）、発行者は著者にしない、刊行期間は日付にしない', () => {
    const r = parseCinii(fixtureJson('cir_serial_1971712334669956506.json'), '1971712334669956506');
    expect(r).toMatchObject({
      type: 'article-journal',
      container: { ja: '大阪市立大学生活科学部紀要' },
      ids: { ncid: 'AN00029633', issn: '03858642' },
      authors: [],
    });
    expect(r.title).toBeUndefined();
    expect(r.issued).toBeUndefined();
  });

  it('雑誌の NCID は図書・雑誌向けの検索で引ける（全文検索では上位に出ない）', async () => {
    const ctx = fakeContext(routes);
    expect(await findCrid('AN00029633', ctx)).toBe('1971712334669956506');
    expect(ctx.calls[0]).toContain('opensearch/books?ncid=AN00029633');
  });

  it('NCID から出典を作る', async () => {
    const { record } = await resolveId(detectIds('AN00029633')[0], fakeContext(routes));
    expect(record.ids).toMatchObject({ ncid: 'AN00029633' });
    expect(record.container).toEqual({ ja: '大阪市立大学生活科学部紀要' });
  });

  it('ISSN で雑誌を探す（親の誌名が先頭）', async () => {
    const found = await findSerialsByIssn('0385-8642', fakeContext(routes));
    expect(found).toHaveLength(7);
    expect(found[0]).toMatchObject({ title: '大阪市立大学生活科学部紀要', ncid: 'AN00029633' });
  });

  it('ISSN に雑誌が複数あれば候補を返し、選んだ候補をそのまま出典にできる', async () => {
    const err = await resolveId(detectIds('0385-8642')[0], fakeContext(routes)).catch((e) => e);
    expect(err).toBeInstanceOf(ChooseEntryError);
    expect(err.candidates).toHaveLength(7);
    expect(err.candidates[0]).toMatchObject({ type: 'crid', value: '1971712334669956506', label: '大阪市立大学生活科学部紀要（AN00029633）' });
    const { record } = await resolveId(err.candidates[0], fakeContext(routes));
    expect(generate(record, { family: 'ja', today }).inline).toContain('|journal=大阪市立大学生活科学部紀要');
    expect(generate(record, { family: 'ja', today }).inline).toContain('|issn=03858642');
  });

  it('雑誌が見つからない ISSN は分かりやすいエラー', async () => {
    const id = detectIds('1234-5679')[0];
    expect(id.type).toBe('issn');
    await expect(resolveId(id, fakeContext([[/opensearch\/books\?issn=1234-5679/, 'cir_books_empty.json']]))).rejects.toThrow(/ISSN 1234-5679 の雑誌が見つかりませんでした/);
  });
});
