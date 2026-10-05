import { describe, expect, it } from 'vitest';
import { detectIds, normalizeIsbn } from '../src/core/ids/detect';
import { isValidIssn } from '../src/core/ids/checksum';
import { idKey } from '../src/core/ids/types';

const first = (s: string) => detectIds(s)[0];

describe('detectIds: URL', () => {
  it.each([
    ['https://doi.org/10.20645/00000025', 'doi', '10.20645/00000025'],
    ['https://dx.doi.org/10.1038/nature12373.', 'doi', '10.1038/nature12373'],
    ['https://cir.nii.ac.jp/crid/1390853649708396416', 'crid', '1390853649708396416'],
    ['https://ci.nii.ac.jp/naid/120006470875', 'naid', '120006470875'],
    ['https://ci.nii.ac.jp/ncid/BA59493660', 'ncid', 'BA59493660'],
    ['https://ndlsearch.ndl.go.jp/books/R100000002-I000002041889', 'ndlbib', '000002041889'],
    ['https://id.ndl.go.jp/jpno/90035836', 'jpno', '90035836'],
    ['https://hdl.handle.net/20.500.14094/0100012345', 'kobenp', '0100012345'],
    ['https://pubmed.ncbi.nlm.nih.gov/23903748/', 'pmid', '23903748'],
    ['https://arxiv.org/abs/2101.00001v2', 'arxiv', '2101.00001'],
  ])('%s → %s', (url, type, value) => {
    expect(first(url)).toMatchObject({ type, value, confidence: 'exact' });
  });

  it('NDL デジタルコレクションのコマ番号を拾う', () => {
    expect(first('https://dl.ndl.go.jp/pid/1234567/1/45')).toMatchObject({ type: 'ndldc', value: '1234567', extra: { koma: 45 } });
    expect(first('https://dl.ndl.go.jp/ja/pid/1234567')).toMatchObject({ type: 'ndldc', value: '1234567' });
    expect(first('info:ndljp/pid/1234567/12')).toMatchObject({ type: 'ndldc', value: '1234567', extra: { koma: 12 } });
    expect(first('https://dl.ndl.go.jp/info:ndljp/pid/1234567/12')).toMatchObject({ type: 'ndldc', value: '1234567', extra: { koma: 12 } });
    expect(first('https://id.ndl.go.jp/digimeta/1234567')).toMatchObject({ type: 'ndldc', value: '1234567' });
    expect(first('pid:1234567')).toMatchObject({ type: 'ndldc', value: '1234567', confidence: 'exact' });
    expect(first('PID 1234567')).toMatchObject({ type: 'ndldc', value: '1234567', confidence: 'exact' });
  });

  it('NDLサーチのデジタル化資料の URL を NDL書誌ID と取り違えない', () => {
    expect(first('https://ndlsearch.ndl.go.jp/books/R100000039-I000000123456')).toMatchObject({ type: 'url' });
  });

  it('J-STAGE の記事 URL から DOI と URL の両方を返す', () => {
    const r = detectIds('https://www.jstage.jst.go.jp/article/jjsai/36/1/36_36-1_A/_article/-char/ja/');
    expect(r.map((d) => d.type)).toEqual(['url']);
    const r2 = detectIds('https://www.jstage.jst.go.jp/article/10.1527/tjsai.36-1_A/_article/-char/ja/');
    expect(r2[0]).toMatchObject({ type: 'doi', value: '10.1527/tjsai.36-1_A' });
  });

  it('それ以外の URL は url', () => {
    expect(first('https://www.example.com/news/1')).toMatchObject({ type: 'url' });
  });
});

describe('detectIds: 接頭辞・形式', () => {
  it.each([
    ['doi:10.1038/nature12373', 'doi', '10.1038/nature12373'],
    ['10.20645/00000025', 'doi', '10.20645/00000025'],
    ['CRID：1390853649708396416', 'crid', '1390853649708396416'],
    ['ISBN 978-4-00-310101-8', 'isbn', '9784003101018'],
    ['isbn:4003101014', 'isbn', '9784003101018'],
    ['ISBN-13: 978-4-00-310101-8', 'isbn', '9784003101018'],
    ['DOI 10.1038/nature12373', 'doi', '10.1038/nature12373'],
    ['978-4-00-310101-8', 'isbn', '9784003101018'],
    ['BA59493660', 'ncid', 'BA59493660'],
    ['0028-0836', 'issn', '0028-0836'],
    ['新聞記事文庫:0100012345', 'kobenp', '0100012345'],
    ['PMC3955296', 'pmc', '3955296'],
  ])('%s → %s', (input, type, value) => {
    expect(first(input)).toMatchObject({ type, value });
  });

  it('不正な ISBN は ISBN と判定しない', () => {
    expect(detectIds('isbn:9784003101019')).toEqual([]);
  });

  it('19桁の数字は CRID を第一候補に推測する', () => {
    const r = detectIds('1390853649708396416');
    expect(r[0]).toMatchObject({ type: 'crid', confidence: 'guess' });
  });

  it('8桁の数字は全国書誌番号の候補を含む', () => {
    expect(detectIds('90035836').map((d) => d.type)).toContain('jpno');
  });

  it('空文字は空配列', () => {
    expect(detectIds('  ')).toEqual([]);
  });
});

describe('チェックディジット', () => {
  it('ISBN-10 を ISBN-13 にする', () => {
    expect(normalizeIsbn('4-00-310101-4')).toBe('9784003101018');
    expect(normalizeIsbn('4-00-310101-5')).toBeNull();
  });
  it('ISSN', () => {
    expect(isValidIssn('0028-0836')).toBe(true);
    expect(isValidIssn('0028-0837')).toBe(false);
  });
  it('idKey は DOI を小文字化する', () => {
    expect(idKey({ type: 'doi', value: '10.1038/NATURE12373' })).toBe('doi:10.1038/nature12373');
  });
});
