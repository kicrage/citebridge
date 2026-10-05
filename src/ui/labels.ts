import type { PassageMode } from '@/core/model/passage';
import type { SourceId, WorkType } from '@/core/model/record';

export const TYPE_LABELS: Record<WorkType, string> = {
  'article-journal': '雑誌論文',
  'article-magazine': '雑誌記事',
  'article-newspaper': '新聞記事',
  book: '図書',
  chapter: '図書の章',
  thesis: '学位論文',
  report: '報告書',
  'paper-conference': '会議発表',
  'entry-encyclopedia': '事典項目',
  webpage: 'ウェブページ',
  dataset: 'データセット',
  other: 'その他',
};

export const SOURCE_LABELS: Record<SourceId, string> = {
  crossref: 'Crossref',
  jalc: 'JaLC',
  datacite: 'DataCite',
  cinii: 'CiNii Research',
  ndl: 'NDLサーチ',
  kobe: '新聞記事文庫',
  kotobank: 'コトバンク',
  citoid: 'Citoid',
  page: 'ページ情報',
  user: '手入力',
};

export const MODE_LABELS: Record<PassageMode, string> = {
  pages: 'ページのみ',
  quote: 'ページ＋引用文',
  sfn: 'Sfn 形式',
};

export const modeItems = (Object.keys(MODE_LABELS) as PassageMode[]).map((value) => ({ value, label: MODE_LABELS[value] }));
