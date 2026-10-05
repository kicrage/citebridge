import { describe, expect, it } from 'vitest';
import { parseCinii } from '../src/core/sources/cinii';
import { parseCrossref } from '../src/core/sources/crossref';
import { snapshotFromHtml } from '../src/core/sources/html';
import { parseJalc } from '../src/core/sources/jalc';
import { parseNdlSru } from '../src/core/sources/ndl';
import { parsePageSnapshot } from '../src/core/sources/pagemeta';
import { resolveId } from '../src/core/sources/resolve';
import { generate } from '../src/core/templates/generate';
import { detectIds } from '../src/core/ids/detect';
import { mergeResults } from '../src/core/merge/merge';
import { pick } from '../src/core/model/record';
import { fakeContext, fixture, fixtureJson } from './helpers';

describe('アダプタ', () => {
  it('JaLC', () => {
    const r = parseJalc(fixtureJson('jalc_10.20645_00000025.json').data);
    expect(r).toMatchObject({
      type: 'article-journal',
      title: { ja: '漱石とハーンの神秘主義' },
      container: { ja: '会津大学短期大学部研究年報' },
      authors: [{ family: '近藤', given: '哲' }],
      issued: { y: 1997 },
      issue: '54',
      pages: '11-27',
      ids: { doi: '10.20645/00000025', ncid: 'AN10448031' },
    });
  });

  it('Crossref', () => {
    const r = parseCrossref(fixtureJson('crossref_10.1038_nature12373.json').message);
    expect(r).toMatchObject({
      type: 'article-journal',
      title: { en: 'Nanometre-scale thermometry in a living cell' },
      container: { en: 'Nature' },
      volume: '500',
      issue: '7460',
      pages: '54-58',
      issued: { y: 2013, m: 7, d: 31 },
    });
    expect(r.authors).toHaveLength(8);
    expect(r.authors![0]).toEqual({ family: 'Kucsko', given: 'G.' });
  });

  it('CiNii Research（論文）', () => {
    const r = parseCinii(fixtureJson('cir_1390853649708396416.json'), '1390853649708396416');
    expect(r).toMatchObject({
      type: 'article-journal',
      ids: { crid: '1390853649708396416', doi: '10.20645/00000025', naid: '120006470875' },
      title: { ja: '漱石とハーンの神秘主義' },
    });
  });

  it('CiNii Research（図書・副題の分離）', () => {
    const r = parseCinii(fixtureJson('cir_book_1970586434846023986.json'), '1970586434846023986');
    expect(r).toMatchObject({
      type: 'book',
      title: { ja: '笑いのユートピア' },
      subtitle: { ja: '『吾輩は猫である』の世界' },
      publisher: '翰林書房',
      ids: { isbn: '4877371591', ncid: 'BA59493660' },
    });
  });

  it('CiNii Research（作品名だけの古い記事は題名に回す）', () => {
    const r = parseCinii(fixtureJson('cir_1570854174588237696.json'), '1570854174588237696');
    expect(pick(r.title)).toBe('草枕');
    expect(r.container).toBeUndefined();
  });

  it('NDL SRU（図書）', () => {
    const r = parseNdlSru(fixture('ndl_sru_jpno_90035836.xml'))!;
    expect(r).toMatchObject({
      type: 'book',
      title: { ja: '吾輩は猫である' },
      authors: [{ family: '夏目', given: '漱石' }],
      publisher: '岩波書店',
      place: '東京',
      series: '岩波文庫',
      edition: '改版',
      issued: { y: 1990, m: 4 },
      ids: { jpno: '90035836' },
    });
  });

  it('NDL SRU（雑誌記事）', () => {
    const r = parseNdlSru(fixture('ndl_sru_article_4196074.xml'))!;
    expect(r).toMatchObject({
      type: 'article-journal',
      container: { ja: '会津大学短期大学部研究年報' },
      issue: '54',
    });
  });

  it('HTML の citation_* meta', () => {
    const html = `<html lang="ja"><head><title>x</title>
      <meta name="citation_title" content="漱石とハーンの神秘主義">
      <meta name="citation_author" content="近藤, 哲">
      <meta name="citation_journal_title" content="会津大学短期大学部研究年報">
      <meta name="citation_publication_date" content="1997/03/01">
      <meta name="citation_firstpage" content="11"><meta name="citation_lastpage" content="27">
      <meta name="citation_doi" content="10.20645/00000025">
    </head></html>`;
    const r = parsePageSnapshot(snapshotFromHtml(html, 'https://example.jp/a'));
    expect(r).toMatchObject({
      type: 'article-journal',
      authors: [{ family: '近藤', given: '哲' }],
      pages: '11-27',
      issued: { y: 1997, m: 3, d: 1 },
      ids: { doi: '10.20645/00000025' },
    });
  });

  it('ニュースサイトの og:* と JSON-LD', () => {
    const html = `<html lang="ja"><head>
      <meta property="og:title" content="見出し &amp; 副見出し">
      <meta property="og:site_name" content="例新聞">
      <script type="application/ld+json">{"@type":"NewsArticle","headline":"見出し","datePublished":"2024-05-01T09:00:00+09:00","author":{"name":"記者 一郎"}}</script>
    </head></html>`;
    const r = parsePageSnapshot(snapshotFromHtml(html, 'https://news.example.jp/1'));
    expect(r).toMatchObject({ type: 'article-newspaper', title: { ja: '見出し' }, container: { ja: '例新聞' }, issued: { y: 2024, m: 5, d: 1 } });
  });
});

describe('照合', () => {
  it('JaLC（ja）と Crossref 相当（en）の題名を言語ごとに併せ持つ', () => {
    const rec = mergeResults(
      'doi:x',
      [
        { source: 'jalc', record: { type: 'article-journal', title: { ja: '日本語題' }, issued: { y: 2000, raw: '2000' } }, raw: null },
        { source: 'crossref', record: { type: 'article-journal', title: { en: 'English title' }, issued: { y: 2000, m: 4, raw: '2000-4' } }, raw: null },
      ],
      ['jalc', 'crossref'],
    );
    expect(rec.title).toEqual({ ja: '日本語題', en: 'English title' });
    expect(rec.issued).toMatchObject({ y: 2000, m: 4 });
    expect(rec.provenance.title).toBe('jalc');
    expect(rec.conflicts).toBeUndefined();
  });

  it('食い違いを conflicts に記録する', () => {
    const rec = mergeResults(
      'k',
      [
        { source: 'ndl', record: { publisher: '岩波書店' }, raw: null },
        { source: 'cinii', record: { publisher: '筑摩書房' }, raw: null },
      ],
      ['ndl', 'cinii'],
    );
    expect(rec.publisher).toBe('岩波書店');
    expect(rec.conflicts?.[0]).toMatchObject({ field: 'publisher' });
  });
});

describe('resolveId（録画レスポンス）', () => {
  const routes: [RegExp, string][] = [
    [/doi\.org\/ra\/10\.20645/, 'ra_jalc.json'],
    [/api\.japanlinkcenter\.org\/dois\/10\.20645\/00000025/, 'jalc_10.20645_00000025.json'],
    [/cir\.nii\.ac\.jp\/crid\/1390853649708396416\.json/, 'cir_1390853649708396416.json'],
    [/ndlsearch\.ndl\.go\.jp\/api\/sru.*isbn="9784003101018"/, 'ndl_sru_jpno_90035836.xml'],
  ];

  it('JaLC の DOI は JaLC を主ソースにする', async () => {
    const ctx = fakeContext(routes);
    const { record, errors } = await resolveId(detectIds('10.20645/00000025')[0], ctx);
    expect(record.provenance.title).toBe('jalc');
    expect(record.title?.ja).toBe('漱石とハーンの神秘主義');
    // CiNii の検索は録画が無いので失敗するが、全体は成功する
    expect(errors.some((e) => e.source === 'cinii')).toBe(true);
    expect(ctx.calls[0]).toContain('doi.org/ra/');
  });

  it('CRID から DOI をたどって JaLC で補う', async () => {
    const ctx = fakeContext(routes);
    const { record, results } = await resolveId(detectIds('https://cir.nii.ac.jp/crid/1390853649708396416')[0], ctx);
    expect(results.map((r) => r.source).sort()).toEqual(['cinii', 'jalc']);
    expect(record.ids).toMatchObject({ crid: '1390853649708396416', doi: '10.20645/00000025', ncid: 'AN10448031' });
    expect(record.pages).toBe('11-27');
  });

  it('ISBN は NDL サーチを引く', async () => {
    const ctx = fakeContext(routes);
    const { record } = await resolveId(detectIds('978-4-00-310101-8')[0], ctx);
    expect(record.key).toBe('isbn:9784003101018');
    expect(record.title?.ja).toBe('吾輩は猫である');
    expect(record.provenance.title).toBe('ndl');
  });

  it('どのソースからも取れなければ例外', async () => {
    await expect(resolveId(detectIds('10.9999/none')[0], fakeContext([]))).rejects.toThrow();
  });
});

describe('NDL 雑誌記事索引と図書の書誌ID', () => {
  // 同じ番号 4196074 が、図書（R100000002-I000004196074）と雑誌記事索引（R000000004-I4196074）で別の資料になる
  const routes: [RegExp, string][] = [
    [/R000000004-I4196074/, 'ndl_sru_article_4196074.xml'],
    [/R100000002-I000002041889/, 'ndl_sru_jpno_90035836.xml'],
  ];

  it('雑誌記事索引の URL は ndlarticle として扱い、記事のほうを引く（図書を引かない）', async () => {
    const id = detectIds('https://ndlsearch.ndl.go.jp/books/R000000004-I4196074')[0];
    expect(id).toMatchObject({ type: 'ndlarticle', value: '4196074' });
    const ctx = fakeContext(routes);
    const { record } = await resolveId(id, ctx);
    expect(ctx.calls).toHaveLength(1);
    expect(ctx.calls[0]).toContain('R000000004-I4196074');
    expect(record.type).toBe('article-journal');
    // NDL が記事に付ける NDLBibID は図書の書誌IDと番号が衝突するので、出典には書かない
    expect(generate(record, { family: 'ja', today: '2026-10-06' }).inline).not.toContain('国立国会図書館書誌ID');
    expect(record.ids.ndlarticle).toBe('4196074');
  });

  it('書誌ID（図書）は記事索引にフォールバックしない', async () => {
    const ctx = fakeContext(routes);
    await expect(resolveId(detectIds('https://ndlsearch.ndl.go.jp/books/R100000002-I000004196074')[0], ctx)).rejects.toThrow();
    expect(ctx.calls.every((u) => !u.includes('R000000004'))).toBe(true);
    const { record } = await resolveId(detectIds('https://ndlsearch.ndl.go.jp/books/R100000002-I000002041889')[0], fakeContext(routes));
    expect(record.ids.ndlbib).toBe('000002041889');
  });
});
