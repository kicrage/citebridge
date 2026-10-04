export const BIBLIOGRAPHY_HEADINGS = ['参考文献', '文献', '参考資料', '主要参考文献', '引用文献'];

export interface BibInsertResult {
  text: string;
  /** 'inserted' = 追記した / 'exists' = 同じ出典が既にある / 'no-section' = 節が見つからない */
  status: 'inserted' | 'exists' | 'no-section';
  /** 追記した位置（text 上） */
  at?: number;
}

/**
 * 参考文献節の末尾（最後の箇条書きの後）に1行足す。
 * dedupe に含まれる文字列（SfnRef のキーや DOI など）が節内に既にあれば足さない。
 */
export function insertBibliography(
  text: string,
  line: string,
  opts: { headings?: string[]; dedupe?: string[] } = {},
): BibInsertResult {
  const names = (opts.headings ?? BIBLIOGRAPHY_HEADINGS).map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`^(={2,6})\\s*(?:${names})\\s*\\1\\s*$`, 'm');
  const m = re.exec(text);
  if (!m) return { text, status: 'no-section' };
  const level = m[1].length;
  const bodyStart = m.index + m[0].length;
  // 同じかより上位の見出し、またはカテゴリ・ナビボックスの手前までを節とする
  const rest = text.slice(bodyStart);
  const next = new RegExp(`^={1,${level}}[^=].*?={1,${level}}\\s*$`, 'm').exec(rest);
  const sectionEnd = next ? bodyStart + next.index : text.length;
  const section = text.slice(bodyStart, sectionEnd);

  if (opts.dedupe?.some((d) => d && section.includes(d))) return { text, status: 'exists' };

  const bullets = [...section.matchAll(/^\*.*$/gm)];
  let at: number;
  if (bullets.length) {
    const last = bullets[bullets.length - 1];
    at = bodyStart + last.index! + last[0].length;
  } else {
    at = bodyStart;
  }
  const insert = `\n${line}`;
  return { text: text.slice(0, at) + insert + text.slice(at), status: 'inserted', at: at + 1 };
}
