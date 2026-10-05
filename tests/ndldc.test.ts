import { describe, expect, it } from 'vitest';
import { detectIds } from '../src/core/ids/detect';
import { fetchNdldc, parseNdldcOai, stripExif } from '../src/core/sources/ndl';
import { resolveId } from '../src/core/sources/resolve';
import { NotFoundError } from '../src/core/sources/http';
import { fakeContext, fixture } from './helpers';

// 録画: https://dl.ndl.go.jp/api/oaipmh?verb=GetRecord&metadataPrefix=dcndl_porta&identifier=oai:dl.ndl.go.jp:info:ndljp/pid/{pid}
// （exif:width/height の繰り返しだけ除去済み）
const parse = (pid: string) => parseNdldcOai(fixture(`ndldc_oai_${pid}.xml`))!;

describe('NDL デジタルコレクション（OAI-PMH dcndl_porta）', () => {
  it('図書: 責任表示の役割語で著者・編者を分け、年は W3CDTF を使う', () => {
    expect(parse('3437686')).toMatchObject({
      type: 'book',
      ids: { ndldc: '3437686' },
      title: { ja: '校異源氏物語', 'ja-Kana': 'コウイ ゲンジ モノガタリ' },
      authors: [{ literal: '紫式部' }],
      editors: [{ literal: '芳賀博士記念会' }],
      volume: '巻一',
      publisher: '中央公論社',
      place: '東京',
      issued: { y: 1942 },
      language: 'ja',
    });
    // 典拠形（NDLNA）の「紫式部, 平安中期」を姓名に割らない
    expect(parse('3437686').authors).toHaveLength(1);
  });

  it('図書: 編者のみ（「覆面冠者 編」）・裁定制度利用の資料', () => {
    expect(parse('1020999')).toMatchObject({
      authors: [],
      editors: [{ literal: '覆面冠者' }],
      publisher: '運送研究社',
      issued: { y: 1926 },
    });
  });

  it('図書: 責任表示が団体名（NDLNA のみ）で、出版地の角括弧と巻次の全角を整える', () => {
    expect(parse('897391')).toMatchObject({
      authors: [{ literal: '東京教育博物館' }],
      place: '東京',
      volume: '明治43年4月',
      issued: { y: 1912 },
    });
  });

  it('雑誌の号: 誌名は container、号は「(53);2003」から取り、号の責任表示は著者にしない', () => {
    const r = parse('11228096');
    expect(r).toMatchObject({
      type: 'article-journal',
      container: { ja: 'Quelle' },
      issue: '53',
      authors: [],
      issued: { y: 2003, m: 12 },
      ids: { issn: '0288-0571', ndldc: '11228096' },
    });
    expect(r.title).toBeUndefined();
    // 欧文題名では読み（題名と同じ綴り）を ja-Kana にしない
    expect(r.container).toEqual({ ja: 'Quelle' });
  });

  it('写本: 「写」は出版者ではない。巻次の角括弧は外す', () => {
    const r = parse('2549497');
    expect(r).toMatchObject({ type: 'book', title: { ja: '天明令典永鑑' }, volume: '12' });
    expect(r.publisher).toBeUndefined();
    expect(r.issued).toBeUndefined();
  });

  it('錦絵（子レベル）: 責任表示に役割語が無ければ著者、シリーズ名は series', () => {
    expect(parse('1311999')).toMatchObject({
      type: 'other',
      authors: [{ literal: '豊国' }],
      series: '俳優似顔東錦絵',
      publisher: '木屋',
      issued: { y: 1857 },
    });
  });

  it('震災アーカイブ（material type が「写真」）: dcterms:issued が無ければ created を使う', () => {
    expect(parse('8941273')).toMatchObject({
      type: 'other',
      authors: [{ literal: '国土地理院' }],
      publisher: '国土地理院',
      issued: { y: 2011, m: 5, d: 26 },
    });
  });

  it('存在しない PID（HTTP 200 で error 要素）は undefined', () => {
    expect(parseNdldcOai(fixture('ndldc_oai_notfound.xml'))).toBeUndefined();
  });

  it('exif の繰り返しを落とす', () => {
    expect(stripExif('<a><exif:width>1</exif:width><exif:height>2</exif:height><b>x</b></a>')).toBe('<a><b>x</b></a>');
  });
});

describe('fetchNdldc / resolveId', () => {
  const routes: [RegExp, string][] = [
    [/dl\.ndl\.go\.jp\/api\/oaipmh.*pid\/3437686$/, 'ndldc_oai_3437686.xml'],
    [/dl\.ndl\.go\.jp\/api\/oaipmh.*pid\/99999999999$/, 'ndldc_oai_notfound.xml'],
  ];

  it('OAI-PMH を 1 回だけ引いて ndl を主ソースにする', async () => {
    const ctx = fakeContext(routes);
    const { record, errors } = await resolveId(detectIds('https://dl.ndl.go.jp/pid/3437686/1/45')[0], ctx);
    expect(ctx.calls).toHaveLength(1);
    expect(ctx.calls[0]).toContain('identifier=oai%3Adl.ndl.go.jp%3Ainfo%3Andljp%2Fpid%2F3437686');
    expect(errors).toEqual([]);
    expect(record.key).toBe('ndldc:3437686');
    expect(record.ids.ndldc).toBe('3437686');
    expect(record.koma).toBe(45);
    expect(record.title?.ja).toBe('校異源氏物語');
    expect(record.provenance.title).toBe('ndl');
  });

  it('存在しない PID は NotFoundError', async () => {
    await expect(fetchNdldc('99999999999', fakeContext(routes))).rejects.toBeInstanceOf(NotFoundError);
  });

  it('OAI-PMH が引けなければ例外（Citoid の汎用題名で成功に見せかけない）', async () => {
    const ctx = fakeContext([]);
    await expect(resolveId(detectIds('pid:99999999999')[0], ctx)).rejects.toThrow(/oaipmh/);
    expect(ctx.calls).toHaveLength(1);
    expect(ctx.calls[0]).toContain('oaipmh');
  });
});
