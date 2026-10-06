import type { DateParts } from '../model/record';

/** 元号 → 元年の西暦 */
const ERAS: Record<string, number> = {
  明治: 1868,
  大正: 1912,
  昭和: 1926,
  平成: 1989,
  令和: 2019,
  M: 1868,
  T: 1912,
  S: 1926,
  H: 1989,
  R: 2019,
};

const toHalf = (s: string) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

const valid = (y?: number, m?: number, d?: number) =>
  (y === undefined || (y > 0 && y < 3000)) &&
  (m === undefined || (m >= 1 && m <= 12)) &&
  (d === undefined || (d >= 1 && d <= 31));

function build(raw: string, y?: number, m?: number, d?: number): DateParts {
  if (!valid(y, m, d)) return { raw };
  const out: DateParts = { raw };
  if (y) out.y = y;
  if (y && m) out.m = m;
  if (y && m && d) out.d = d;
  return out;
}

/**
 * 日付文字列を解析する。対応形式:
 * ISO（1990 / 1990-03 / 1990-03-12）、NDL 形式（1990.3 / 1990.3.12）、
 * 「1990年3月12日」、和暦（昭和12年5月 / 昭和12 / 昭和元年 / S12.5）、[1937] や c1990 などの角括弧・推定表記。
 */
export function parseDate(input: string | undefined | null): DateParts | undefined {
  if (!input) return undefined;
  const raw = input.trim();
  const s = toHalf(raw).replace(/^[[(（]|[\])）]$/g, '').replace(/^c(?=\d)/i, '').trim();
  let m: RegExpExecArray | null;

  if ((m = /^(\d{4})(?:[-/.](\d{1,2})(?:[-/.](\d{1,2}))?)?(?:T.*)?$/.exec(s)))
    return build(raw, +m[1], m[2] ? +m[2] : undefined, m[3] ? +m[3] : undefined);
  if ((m = /^(\d{4})年(?:(\d{1,2})月(?:(\d{1,2})日)?)?/.exec(s)))
    return build(raw, +m[1], m[2] ? +m[2] : undefined, m[3] ? +m[3] : undefined);
  if ((m = /^(明治|大正|昭和|平成|令和|[MTSHR])\s*(元|\d{1,2})(?:年|\.)?\s*(?:(\d{1,2})(?:月|\.)?\s*(?:(\d{1,2})日?)?)?$/.exec(s))) {
    const n = m[2] === '元' ? 1 : +m[2];
    return build(raw, ERAS[m[1]] + n - 1, m[3] ? +m[3] : undefined, m[4] ? +m[4] : undefined);
  }
  // 年月が一緒に入った数値（199003）
  if ((m = /^(\d{4})(\d{2})(\d{2})?$/.exec(s)))
    return build(raw, +m[1], +m[2], m[3] ? +m[3] : undefined);
  return { raw };
}

/** Crossref の date-parts を DateParts に */
export function fromDateParts(parts: number[] | undefined): DateParts | undefined {
  if (!parts || !parts[0]) return undefined;
  const [y, m, d] = parts;
  return build(parts.join('-'), y, m, d);
}

export type DateStyle = 'iso' | 'ja';

const pad = (n: number) => String(n).padStart(2, '0');

/** テンプレート引数用に整形。解析できなかった場合は元表記を返す */
export function formatDate(d: DateParts | undefined, style: DateStyle = 'iso'): string | undefined {
  if (!d) return undefined;
  if (!d.y) return d.raw || undefined;
  if (style === 'ja') return `${d.y}年` + (d.m ? `${d.m}月` : '') + (d.m && d.d ? `${d.d}日` : '');
  // YYYY-MM は、MM が年の下 2 桁より大きいと年の範囲（2003-12 → 2003〜2012）と紛らわしく「曖昧な日付のフォーマット」になる
  if (d.m && !d.d && d.m > d.y % 100) return `${d.y}年${d.m}月`;
  return String(d.y) + (d.m ? `-${pad(d.m)}` : '') + (d.m && d.d ? `-${pad(d.d)}` : '');
}

export function todayIso(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
