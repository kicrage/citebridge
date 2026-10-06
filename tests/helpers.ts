import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NotFoundError, type Http, type SourceContext } from '../src/core/sources/http';

export const fixture = (name: string) => readFileSync(resolve(import.meta.dirname, 'fixtures', name), 'utf8');
export const fixtureJson = (name: string) => JSON.parse(fixture(name));

/** URL の一部 → フィクスチャ名。どれにも当たらなければ 404 扱い */
export function fakeContext(routes: [RegExp, string][]): SourceContext & { calls: string[] } {
  const calls: string[] = [];
  const find = (url: string) => {
    calls.push(url);
    const hit = routes.find(([re]) => re.test(decodeURIComponent(url)));
    if (!hit) throw new NotFoundError(url);
    return fixture(hit[1]);
  };
  const http: Http = {
    async json(url) {
      return JSON.parse(find(url));
    },
    async text(url) {
      return find(url);
    },
  };
  return { http, calls };
}
