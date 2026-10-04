import type { CiteRecord, Conflict, SourceId, SourceResult } from '../model/record';
import { emptyRecord } from '../model/record';
import { nameToString } from '../transforms/names';

type Field = keyof CiteRecord;

/** 照合で扱うフィールド */
const FIELDS: Field[] = [
  'type',
  'title',
  'subtitle',
  'container',
  'volumeTitle',
  'authors',
  'editors',
  'translators',
  'issued',
  'volume',
  'issue',
  'pages',
  'articleNumber',
  'edition',
  'series',
  'publisher',
  'place',
  'url',
  'language',
  'degree',
  'major',
];

const isEmpty = (v: unknown) =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0);

/** 比較用の正規化（全角半角・空白・ダッシュの差を無視） */
function norm(v: unknown): string {
  let s: string;
  if (Array.isArray(v)) s = v.map((n) => nameToString(n)).join('|');
  else if (v && typeof v === 'object' && 'raw' in (v as object)) {
    const d = v as CiteRecord['issued'];
    s = d?.y ? `${d.y}-${d.m ?? ''}-${d.d ?? ''}` : (d?.raw ?? '');
  } else if (v && typeof v === 'object') s = Object.values(v as object).join('|');
  else s = String(v ?? '');
  return s.normalize('NFKC').replace(/[\s　・,.:：\-–—‐]/g, '').toLowerCase();
}

/**
 * 複数ソースの結果を、与えられた優先順で統合する。
 * - 各フィールドは優先順で最初に値を持つソースから採る（＝主ソースの値を壊さない）
 * - 多言語値（title など）は言語ごとに補完する（JaLC の ja と Crossref の en を両方持てる）
 * - 値が食い違えば conflicts に記録して UI で提示する
 */
export function mergeResults(key: string, results: SourceResult[], order: SourceId[]): CiteRecord {
  const sorted = [...results].sort((a, b) => rank(a.source, order) - rank(b.source, order));
  const out = emptyRecord(key);
  const conflicts: Conflict[] = [];

  for (const r of sorted) Object.assign(out.ids, Object.fromEntries(Object.entries(r.record.ids ?? {}).filter(([k, v]) => v && !(k in out.ids))));

  for (const f of FIELDS) {
    const candidates = sorted.filter((r) => !isEmpty(r.record[f]) && !(f === 'type' && r.record.type === 'other'));
    if (!candidates.length) continue;
    const first = candidates[0];
    let value: any = structuredClone(first.record[f]);
    if (f === 'title' || f === 'subtitle' || f === 'container') {
      for (const c of candidates.slice(1)) {
        for (const [l, v] of Object.entries(c.record[f] as object)) if (!(l in value)) value[l] = v;
      }
    }
    // 日付は精度の高いもの（年月日がそろっている方）で補う。ただし年が一致する場合に限る
    if (f === 'issued') {
      for (const c of candidates.slice(1)) {
        const d = c.record.issued!;
        if (d.y && d.y === value.y && ((d.m && !value.m) || (d.d && !value.d))) value = { ...d };
      }
    }
    (out as any)[f] = value;
    out.provenance[f] = first.source;

    const differing = candidates.filter((c) => f !== 'title' && f !== 'subtitle' && f !== 'container' && f !== 'issued'
      ? norm(c.record[f]) !== norm(first.record[f])
      : f === 'issued' && c.record.issued?.y && first.record.issued?.y && c.record.issued.y !== first.record.issued.y);
    if (differing.length && f !== 'type' && f !== 'url') {
      conflicts.push({ field: f, values: [first, ...differing].map((c) => ({ source: c.source, value: c.record[f] })) });
    }
  }
  if (conflicts.length) out.conflicts = conflicts;
  return out;
}

function rank(s: SourceId, order: SourceId[]): number {
  const i = order.indexOf(s);
  return i === -1 ? order.length : i;
}

/** ユーザーの修正を重ねる（userOverrides は別層として保持し、表示・生成時に適用） */
export function applyOverrides(rec: CiteRecord, ov: Partial<CiteRecord> | undefined): CiteRecord {
  if (!ov) return rec;
  const out = { ...rec, ...ov, ids: { ...rec.ids, ...ov.ids }, provenance: { ...rec.provenance } };
  for (const k of Object.keys(ov) as Field[]) if (k !== 'ids') out.provenance[k] = 'user';
  return out;
}
