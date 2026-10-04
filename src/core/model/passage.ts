/** ページ指定の種類: p=単一ページ / pp=範囲 / loc=その他の位置（章・節など） / koma=NDLDC のコマ */
export type PageKind = 'p' | 'pp' | 'loc' | 'koma';

/** 出典に紐づく「一節」 */
export interface Passage {
  id: string;
  /** 紐づく CiteRecord.key */
  recordKey: string;
  text: string;
  page?: string;
  pageKind: PageKind;
  note?: string;
  sourceUrl?: string;
  capturedAt: string;
}

/** 出典クリップボードの項目 */
export interface Clip {
  recordKey: string;
  tags: string[];
  /** 使う予定の記事名など */
  memo?: string;
  addedAt: string;
}

/** 挿入時の一節の使い方 */
export type PassageMode = 'pages' | 'quote' | 'sfn';

export function inferPageKind(page: string): PageKind {
  const p = page.trim();
  if (/^\d+\s*[-–～~]\s*\d+$/.test(p)) return 'pp';
  if (/^\d+$/.test(p) || /^[ivxlcdm]+$/i.test(p)) return 'p';
  return 'loc';
}
