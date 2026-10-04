const toHalf = (s: string) =>
  s.replace(/[０-９ａ-ｚＡ-Ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

/** 「12(3)」「第12巻第3号」「12巻3号」「Vol.12 No.3」「通号123」を巻・号に分解 */
export function parseVolumeIssue(input: string | undefined): { volume?: string; issue?: string } {
  if (!input) return {};
  const s = toHalf(input).trim();
  let m: RegExpExecArray | null;
  if ((m = /^(\d+)\s*[(（]\s*([^)）]+)\s*[)）]$/.exec(s))) return { volume: m[1], issue: m[2] };
  if ((m = /^第?\s*(\d+)\s*巻\s*(?:第?\s*(\d+)\s*号)?/.exec(s)))
    return { volume: m[1], ...(m[2] ? { issue: m[2] } : {}) };
  if ((m = /^第?\s*(\d+)\s*号$/.exec(s))) return { issue: m[1] };
  if ((m = /^vol\.?\s*(\d+)\s*[,，]?\s*(?:no\.?|issue)\s*(\d+)/i.exec(s))) return { volume: m[1], issue: m[2] };
  if ((m = /^vol\.?\s*(\d+)$/i.exec(s))) return { volume: m[1] };
  if ((m = /^no\.?\s*(\d+)$/i.exec(s))) return { issue: m[1] };
  return { volume: s };
}

export type DashStyle = 'hyphen' | 'endash';

/** 開始・終了ページから pages 文字列を作る */
export function joinPages(first?: string, last?: string, dash: DashStyle = 'hyphen'): string | undefined {
  const f = first?.trim();
  const l = last?.trim();
  if (!f) return undefined;
  if (!l || l === f) return f;
  return `${f}${dash === 'endash' ? '–' : '-'}${l}`;
}

/** ページ範囲表記のダッシュを統一 */
export function normalizePages(p: string | undefined, dash: DashStyle = 'hyphen'): string | undefined {
  if (!p) return undefined;
  const s = toHalf(p).trim().replace(/^(?:pp?\.|頁)\s*/i, '').replace(/\s*(?:頁|ページ|p\.?)$/i, '');
  return s.replace(/\s*[-–—‐－~～〜]\s*/g, dash === 'endash' ? '–' : '-');
}

/** 範囲か（pages= を使うべきか） */
export function isPageRange(p: string): boolean {
  return /[-–,，、]/.test(p);
}

/** ISBD 形式の「本題 : 副題」を分ける */
export function splitSubtitle(title: string): { title: string; subtitle?: string } {
  const m = /^(.+?)\s+[:：]\s+(.+)$/.exec(title.trim());
  if (!m) return { title: title.trim() };
  return { title: m[1], subtitle: m[2] };
}

/** 「563p」「xii, 320p」→ 何もしない（総ページ数は出典に使わない）。版表記の整形 */
export function normalizeEdition(e: string | undefined): string | undefined {
  if (!e) return undefined;
  return toHalf(e).trim() || undefined;
}
