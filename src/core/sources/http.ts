/** ソースアダプタが使う HTTP 取得関数（拡張ではレート制限・キャッシュ付き実装、テストではフィクスチャを注入） */
export interface Http {
  json<T = unknown>(url: string, init?: RequestInit): Promise<T>;
  text(url: string, init?: RequestInit): Promise<string>;
}

export interface SourceContext {
  http: Http;
  /** Crossref の polite pool 用 */
  mailto?: string;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
  ) {
    super(`HTTP ${status}: ${url}`);
  }
}

export class NotFoundError extends Error {}

/** ホストごとの最小間隔を守る素朴なレート制限付き fetch */
export function createHttp(opts: { minIntervalMs?: Record<string, number>; headers?: Record<string, string> } = {}): Http {
  const last = new Map<string, number>();
  const queue = new Map<string, Promise<unknown>>();

  async function throttled(url: string, init?: RequestInit): Promise<Response> {
    const host = new URL(url).host;
    const gap = opts.minIntervalMs?.[host] ?? 200;
    const prev = queue.get(host) ?? Promise.resolve();
    const run = prev.then(async () => {
      const wait = (last.get(host) ?? 0) + gap - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last.set(host, Date.now());
      for (let attempt = 0; ; attempt++) {
        let res: Response;
        try {
          res = await fetch(url, { ...init, headers: { ...opts.headers, ...init?.headers } });
        } catch (e) {
          // 接続タイムアウト・DNS の一時的な失敗（初回の名前解決が遅い環境がある）は少し待って再試行する
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
            continue;
          }
          throw e;
        }
        if ((res.status === 429 || res.status === 503) && attempt < 3) {
          const ra = Number(res.headers.get('retry-after'));
          await new Promise((r) => setTimeout(r, (ra > 0 ? ra * 1000 : 1000) * 2 ** attempt));
          continue;
        }
        return res;
      }
    });
    queue.set(host, run.catch(() => undefined));
    return run;
  }

  return {
    async json(url, init) {
      const res = await throttled(url, { ...init, headers: { Accept: 'application/json', ...init?.headers } });
      if (res.status === 404) throw new NotFoundError(url);
      if (!res.ok) throw new HttpError(res.status, url);
      return res.json();
    },
    async text(url, init) {
      const res = await throttled(url, init);
      if (res.status === 404) throw new NotFoundError(url);
      if (!res.ok) throw new HttpError(res.status, url);
      return res.text();
    },
  };
}
