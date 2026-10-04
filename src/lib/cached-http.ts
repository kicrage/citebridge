import { createHttp, type Http } from '@/core/sources/http';
import { db } from '@/db/dexie';

const DAY = 24 * 60 * 60 * 1000;

/** ソースごとの保持期間。書誌データはほとんど変わらないので長め、Web ページは短め */
function ttlFor(url: string): number {
  const host = new URL(url).host;
  if (/crossref|japanlinkcenter|cir\.nii|ndlsearch/.test(host)) return 30 * DAY;
  if (host === 'doi.org') return 90 * DAY;
  if (/wikipedia\.org$/.test(host)) return 7 * DAY;
  return DAY;
}

const UA = `Citebridge/${browser.runtime.getManifest().version} (Wikipedia citation helper extension)`;

/**
 * レート制限付き fetch に IndexedDB のキャッシュを重ねる。
 * 同じ識別子を2回目に取得するときはネットワークに出ない。
 */
export function createCachedHttp(opts: { bypassCache?: boolean } = {}): Http {
  const net = createHttp({
    minIntervalMs: {
      'ja.wikipedia.org': 1000, // Citoid は連続アクセスで 429 になる
      'cir.nii.ac.jp': 500,
      'ndlsearch.ndl.go.jp': 500,
    },
    headers: { 'Api-User-Agent': UA },
  });

  async function cached(url: string, init: RequestInit | undefined, kind: 'json' | 'text'): Promise<string> {
    if (!opts.bypassCache) {
      const hit = await db.raw.get(url);
      if (hit && hit.expiresAt > Date.now()) return hit.body;
    }
    const body = kind === 'json' ? JSON.stringify(await net.json(url, init)) : await net.text(url, init);
    const now = Date.now();
    await db.raw.put({ url, body, fetchedAt: now, expiresAt: now + ttlFor(url) });
    return body;
  }

  return {
    async json(url, init) {
      return JSON.parse(await cached(url, init, 'json'));
    },
    text(url, init) {
      return cached(url, init, 'text');
    },
  };
}
