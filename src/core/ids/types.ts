/** 本ツールが扱う識別子の種類 */
export type IdType =
  | 'doi'
  | 'crid'
  | 'naid'
  | 'ncid'
  | 'ndlbib' // 国立国会図書館書誌ID
  | 'jpno' // 全国書誌番号
  | 'ndldc' // 国立国会図書館デジタルコレクション PID
  | 'isbn'
  | 'issn'
  | 'hdl'
  | 'kobenp' // 神戸大学 新聞記事文庫 メタデータID
  | 'pmid'
  | 'pmc'
  | 'arxiv'
  | 'url';

export interface DetectedId {
  type: IdType;
  /** 正規化済みの値（DOI は小文字化しない。比較時に key を使う） */
  value: string;
  /** 補助情報（NDLDC のコマ番号など） */
  extra?: { koma?: number };
  /** 'exact' = URL や接頭辞などから確定 / 'guess' = 形式からの推測（曖昧さあり） */
  confidence: 'exact' | 'guess';
}

export const ID_LABELS: Record<IdType, string> = {
  doi: 'DOI',
  crid: 'CRID',
  naid: 'NAID',
  ncid: 'NCID',
  ndlbib: '国立国会図書館書誌ID',
  jpno: '全国書誌番号',
  ndldc: 'NDLデジタルコレクション',
  isbn: 'ISBN',
  issn: 'ISSN',
  hdl: 'Handle',
  kobenp: '新聞記事文庫',
  pmid: 'PMID',
  pmc: 'PMC',
  arxiv: 'arXiv',
  url: 'URL',
};

/** レコード主キー（キャッシュ・照合用）。DOI は大文字小文字を区別しないので小文字化する */
export function idKey(id: Pick<DetectedId, 'type' | 'value'>): string {
  const v = id.type === 'doi' || id.type === 'hdl' ? id.value.toLowerCase() : id.value;
  return `${id.type}:${v}`;
}
