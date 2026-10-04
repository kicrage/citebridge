import type { IdType } from '../ids/types';

export type SourceId =
  | 'crossref'
  | 'jalc'
  | 'datacite'
  | 'cinii'
  | 'ndl'
  | 'citoid'
  | 'page' // 閲覧中ページの meta タグ等
  | 'user';

export type WorkType =
  | 'article-journal'
  | 'article-magazine'
  | 'article-newspaper'
  | 'book'
  | 'chapter'
  | 'thesis'
  | 'report'
  | 'paper-conference'
  | 'entry-encyclopedia'
  | 'webpage'
  | 'dataset'
  | 'other';

/** 言語タグ → 値（'ja' / 'en' / 'ja-Kana' など） */
export type Multilingual = Record<string, string>;

export interface Name {
  family?: string;
  given?: string;
  /** 分割できない・すべきでない名前（団体名、空白なしの日本人名など） */
  literal?: string;
  /** 読み（カタカナ） */
  yomi?: string;
}

export interface DateParts {
  y?: number;
  m?: number;
  d?: number;
  /** 元の表記（和暦など） */
  raw: string;
}

/** ソースに依存しない正規化済み書誌レコード（CSL-JSON を日本語文献向けに拡張） */
export interface CiteRecord {
  key: string;
  ids: Partial<Record<IdType, string>>;
  type: WorkType;
  title?: Multilingual;
  subtitle?: Multilingual;
  /** 雑誌名・新聞名・叢書の収録書名など */
  container?: Multilingual;
  /** 収録巻の書名（CS-ja の volume-title） */
  volumeTitle?: string;
  authors: Name[];
  editors: Name[];
  translators: Name[];
  issued?: DateParts;
  volume?: string;
  issue?: string;
  pages?: string;
  articleNumber?: string;
  edition?: string;
  series?: string;
  publisher?: string;
  place?: string;
  url?: string;
  language?: string;
  /** 学位論文の学位・専攻 */
  degree?: string;
  major?: string;
  /** NDL デジタルコレクションのコマ番号 */
  koma?: number;
  /** 各項目がどのソース由来か（キーは CiteRecord のフィールド名） */
  provenance: Partial<Record<keyof CiteRecord, SourceId>>;
  /** 照合で値が食い違った項目 */
  conflicts?: Conflict[];
  schemaVersion: 1;
}

export interface Conflict {
  field: keyof CiteRecord;
  values: { source: SourceId; value: unknown }[];
}

/** ソースアダプタの出力 */
export interface SourceResult {
  source: SourceId;
  record: Partial<CiteRecord>;
  /** 生レスポンス（キャッシュ用） */
  raw: unknown;
}

export function emptyRecord(key: string): CiteRecord {
  return {
    key,
    ids: {},
    type: 'other',
    authors: [],
    editors: [],
    translators: [],
    provenance: {},
    schemaVersion: 1,
  };
}

/** 優先言語順に多言語値を選ぶ */
export function pick(m: Multilingual | undefined, prefer: string[] = ['ja', 'und', 'en']): string | undefined {
  if (!m) return undefined;
  for (const l of prefer) if (m[l]) return m[l];
  const k = Object.keys(m).find((k) => !k.endsWith('-Kana') && !k.endsWith('-Latn'));
  return k ? m[k] : undefined;
}
