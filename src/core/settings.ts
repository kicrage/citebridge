import type { PassageMode } from './model/passage';
import type { Family } from './templates/profiles';
import type { DateStyle } from './transforms/dates';

export interface Settings {
  /** 'auto' = 記事内の多数派に合わせる（判定できなければ defaultFamily） */
  family: 'auto' | Family;
  defaultFamily: Family;
  passageMode: PassageMode;
  /** 'last-first' = last1/first1 に分ける / 'author' = author1 に「姓 名」 */
  nameStyle: 'last-first' | 'author';
  dateStyle: DateStyle;
  /** 'auto' = 記事内の既存テンプレートに合わせる */
  layout: 'auto' | 'inline' | 'block';
  /** DOI・CRID 等があっても url= を出すか */
  urlWithId: boolean;
  accessDate: boolean;
  /**
   * {{Sfn}} で参照されやすい種類（図書・論文・学位論文など）の ref={{SfnRef|…}}。
   * 'needed' = CITEREF が自動で作られない／一致しないときだけ（既定。同じ値の明示はメンテナンスカテゴリになる）、
   * 'always' = 常に付ける、'never' = Sfn モード以外では付けない
   */
  sfnRef: 'needed' | 'always' | 'never';
  /** 和文の本題と副題のつなぎ */
  subtitleJoinJa: string;
  /** Crossref の polite pool 用連絡先 */
  mailto: string;
}

export const DEFAULT_SETTINGS: Settings = {
  family: 'auto',
  defaultFamily: 'ja',
  passageMode: 'pages',
  nameStyle: 'last-first',
  dateStyle: 'iso',
  layout: 'auto',
  urlWithId: false,
  accessDate: true,
  sfnRef: 'needed',
  subtitleJoinJa: ' : ',
  mailto: '',
};
