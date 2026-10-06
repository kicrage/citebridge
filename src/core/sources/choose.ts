import type { DetectedId } from '../ids/types';

/**
 * 入力から資料が 1 つに決まらないとき（コトバンクの辞書の項目、ISSN を持つ複数の雑誌など）に、
 * 候補（DetectedId.label が表示名）を示すために投げる。background が候補ボタンとして利用者に返す。
 */
export class ChooseEntryError extends Error {
  constructor(
    public candidates: DetectedId[],
    message = 'どれを出典にするか選んでください',
  ) {
    super(message);
  }
}
