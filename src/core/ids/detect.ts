import { isValidIsbn10, isValidIsbn13, isbn10to13, isValidIssn } from './checksum';
import type { DetectedId, IdType } from './types';

const PREFIXES: Record<string, IdType> = {
  doi: 'doi',
  crid: 'crid',
  naid: 'naid',
  ncid: 'ncid',
  ndl: 'ndlbib',
  ndlbib: 'ndlbib',
  ndlbibid: 'ndlbib',
  jpno: 'jpno',
  ndldc: 'ndldc',
  ndljp: 'ndldc',
  isbn: 'isbn',
  issn: 'issn',
  hdl: 'hdl',
  pmid: 'pmid',
  pmc: 'pmc',
  arxiv: 'arxiv',
  kobenp: 'kobenp',
  新聞記事文庫: 'kobenp',
};

/** 新聞記事文庫のメタデータIDが属する Handle 接頭辞 */
export const KOBE_HANDLE_PREFIX = '20.500.14094';

const exact = (type: IdType, value: string, extra?: DetectedId['extra']): DetectedId => ({
  type,
  value,
  confidence: 'exact',
  ...(extra ? { extra } : {}),
});

function cleanDoi(s: string): string {
  return decodeURIComponentSafe(s).replace(/[.,;)\]]+$/, '');
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** ISBN を ISBN-13（ハイフンなし）に正規化。不正なら null */
export function normalizeIsbn(raw: string): string | null {
  const s = raw.replace(/[\s‐-]/g, '').toUpperCase();
  if (s.length === 10 && isValidIsbn10(s)) return isbn10to13(s);
  if (s.length === 13 && isValidIsbn13(s)) return s;
  return null;
}

/** 接頭辞付き（`crid:…`）として明示された値の検証・正規化 */
function fromPrefixed(type: IdType, v: string): DetectedId | null {
  v = v.trim();
  switch (type) {
    case 'isbn': {
      const n = normalizeIsbn(v);
      return n ? exact('isbn', n) : null;
    }
    case 'issn':
      return isValidIssn(v) ? exact('issn', formatIssn(v)) : null;
    case 'doi':
      return /^10\.\d{4,9}\/\S+$/.test(v) ? exact('doi', cleanDoi(v)) : null;
    case 'ndldc':
      return fromNdldcPath(v);
    case 'pmc':
      return /^(PMC)?\d+$/i.test(v) ? exact('pmc', v.replace(/^PMC/i, '')) : null;
    default:
      return v ? exact(type, v) : null;
  }
}

function formatIssn(v: string): string {
  const d = v.replace('-', '').toUpperCase();
  return `${d.slice(0, 4)}-${d.slice(4)}`;
}

/** `1234567` / `1234567/1/45` / `info:ndljp/pid/1234567/45` 等 */
function fromNdldcPath(v: string): DetectedId | null {
  const m = /^(?:info:ndljp\/)?(?:pid\/)?(\d{6,10})(?:\/(\d+)(?:\/(\d+))?)?/.exec(v);
  if (!m) return null;
  // 新形式 pid/{pid}/{巻}/{コマ}、旧形式 info:ndljp/pid/{pid}/{コマ}
  const koma = m[3] ? Number(m[3]) : m[2] ? Number(m[2]) : undefined;
  return exact('ndldc', m[1], koma ? { koma } : undefined);
}

/** URL から識別子を取り出す */
function fromUrl(u: URL): DetectedId[] {
  const host = u.hostname.replace(/^www\./, '');
  const path = decodeURIComponentSafe(u.pathname);
  let m: RegExpExecArray | null;

  if (/(^|\.)doi\.org$/.test(host) && (m = /^\/(10\.\d{4,9}\/.+)$/.exec(path)))
    return [exact('doi', cleanDoi(m[1]))];
  if (host === 'cir.nii.ac.jp' && (m = /^\/crid\/(\d+)/.exec(path))) return [exact('crid', m[1])];
  if (host === 'ci.nii.ac.jp') {
    if ((m = /^\/naid\/(\d+)/.exec(path))) return [exact('naid', m[1])];
    if ((m = /^\/ncid\/([A-Z]{2}\d{7}[\dX])/.exec(path))) return [exact('ncid', m[1])];
  }
  if (host === 'ndlsearch.ndl.go.jp' || host === 'iss.ndl.go.jp') {
    // R100000002 = 図書の NDL 書誌、R000000004 = 雑誌記事索引
    if ((m = /^\/books\/R\d{9}-I(\d+)/.exec(path))) return [exact('ndlbib', m[1])];
  }
  if (host === 'id.ndl.go.jp') {
    if ((m = /^\/bib\/(\d+)/.exec(path))) return [exact('ndlbib', m[1])];
    if ((m = /^\/jpno\/(\d+)/.exec(path))) return [exact('jpno', m[1])];
  }
  if (host === 'dl.ndl.go.jp') {
    const d = fromNdldcPath(path.replace(/^\/(?:ja\/)?/, ''));
    if (d) return [d];
  }
  if (host === 'hdl.handle.net' && (m = /^\/(\d+(?:\.\d+)*\/.+)$/.exec(path))) return fromHandle(m[1]);
  if (host === 'da.lib.kobe-u.ac.jp' && (m = /\/(\d{10})(?:\/|$)/.exec(path))) return [exact('kobenp', m[1])];
  if (host === 'pubmed.ncbi.nlm.nih.gov' && (m = /^\/(\d+)/.exec(path))) return [exact('pmid', m[1])];
  if (/ncbi\.nlm\.nih\.gov$/.test(host) && (m = /\/pmc\/articles\/PMC(\d+)/i.exec(path)))
    return [exact('pmc', m[1])];
  if (host === 'arxiv.org' && (m = /^\/(?:abs|pdf)\/(.+?)(?:v\d+)?(?:\.pdf)?$/.exec(path)))
    return [exact('arxiv', m[1])];

  // J-STAGE 等、パスに DOI を含むもの
  if ((m = /(10\.\d{4,9}\/[^?#\s]+)/.exec(path)) && host.endsWith('jstage.jst.go.jp')) {
    const doi = m[1].replace(/\/_(?:article|pdf).*$/, '');
    return [exact('doi', cleanDoi(doi)), exact('url', u.href)];
  }
  return [exact('url', u.href)];
}

function fromHandle(h: string): DetectedId[] {
  const kobe = new RegExp(`^${KOBE_HANDLE_PREFIX.replace(/\./g, '\\.')}/(\\d{10})$`).exec(h);
  if (kobe) return [exact('kobenp', kobe[1]), exact('hdl', h)];
  if (/^10\.\d{4,9}\//.test(h)) return [exact('doi', cleanDoi(h))];
  return [exact('hdl', h)];
}

/**
 * 入力文字列から識別子候補を推定する。
 * 先頭ほど確からしい。純数字など形式だけでは決まらないものは複数候補（confidence: 'guess'）を返す。
 */
export function detectIds(input: string): DetectedId[] {
  const s = input.trim().replace(/^<|>$/g, '');
  if (!s) return [];

  // 1) URL
  if (/^https?:\/\//i.test(s)) {
    try {
      return fromUrl(new URL(s));
    } catch {
      return [];
    }
  }
  // 2) 明示的な接頭辞 `type:value`
  // 「ISBN 978-…」「ISBN-13: …」「DOI 10.…」のような空白区切り・桁数付きも受ける
  const pm = /^([^\s:]+?)\s*[:：]\s*(.+)$/.exec(s.replace(/^(isbn|issn)-?1[03]\b/i, '$1')) ??
    /^([A-Za-z]{3,6})\s+(\S.*)$/.exec(s);
  if (pm && !/^info$/i.test(pm[1])) {
    const t = PREFIXES[pm[1].toLowerCase()];
    if (t) {
      if (t === 'hdl') return fromHandle(pm[2].trim());
      const d = fromPrefixed(t, pm[2]);
      return d ? [d] : [];
    }
  }
  if (/^info:ndljp\/pid\//.test(s)) {
    const d = fromNdldcPath(s);
    return d ? [d] : [];
  }

  // 3) 形式による判定
  if (/^10\.\d{4,9}\/\S+$/.test(s)) return [exact('doi', cleanDoi(s))];
  if (/^[A-Z]{2}\d{7}[\dX]$/.test(s)) return [exact('ncid', s)];
  if (/^PMC\d+$/i.test(s)) return [exact('pmc', s.slice(3))];
  if (/^\d{4}-\d{3}[\dX]$/i.test(s) && isValidIssn(s)) return [exact('issn', s.toUpperCase())];
  if (/^\d+(?:\.\d+)*\/\S+$/.test(s)) return fromHandle(s);

  const compact = s.replace(/[\s‐-]/g, '');
  const isbn = normalizeIsbn(compact);
  if (isbn && (/[‐-]/.test(s) || compact.length === 13 || /X$/i.test(compact))) {
    return [exact('isbn', isbn)];
  }

  if (/^\d+$/.test(compact)) return guessNumeric(compact, isbn);
  return [];
}

/** 純数字の曖昧判定。桁数と先頭の傾向から候補を並べる */
function guessNumeric(d: string, isbn: string | null): DetectedId[] {
  const g = (type: IdType, value = d): DetectedId => ({ type, value, confidence: 'guess' });
  const out: DetectedId[] = [];
  const len = d.length;
  if (len === 19 && d.startsWith('1')) out.push(g('crid'));
  if (isbn) out.push(g('isbn', isbn));
  if (len === 8) out.push(g('jpno'));
  if (len >= 9 && len <= 12 && !d.startsWith('0')) out.push(g('naid'));
  if (len >= 7 && len <= 12) out.push(g('ndlbib'));
  if (len === 10 && d.startsWith('0100')) out.unshift(g('kobenp'));
  if (len >= 6 && len <= 10 && !d.startsWith('0')) out.push(g('ndldc'));
  if (len >= 1 && len <= 9) out.push(g('pmid'));
  return out;
}
