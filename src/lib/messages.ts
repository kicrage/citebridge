import type { DetectedId } from '@/core/ids/types';
import type { CiteRecord } from '@/core/model/record';

/** サイドパネル・ポップアップ → background */
export type BgRequest =
  | { type: 'resolve'; input: string; id?: DetectedId; bypassCache?: boolean }
  | { type: 'capture-tab'; tabId: number; withSelection: boolean };

export type ResolveResponse =
  | { ok: true; record: CiteRecord; errors: { source: string; message: string }[] }
  | { ok: true; candidates: DetectedId[] }
  | { ok: false; error: string };

export type CaptureResponse = { ok: true; recordKey: string; passageId?: string } | { ok: false; error: string };

export function sendToBackground(req: Extract<BgRequest, { type: 'resolve' }>): Promise<ResolveResponse>;
export function sendToBackground(req: Extract<BgRequest, { type: 'capture-tab' }>): Promise<CaptureResponse>;
export function sendToBackground(req: BgRequest): Promise<unknown> {
  return browser.runtime.sendMessage(req);
}

/** 編集画面（コンテンツスクリプト）への要求 */
export type WikiRequest =
  | { type: 'wiki:status' }
  | { type: 'wiki:getText' }
  | { type: 'wiki:insert'; text: string; bibliography?: { line: string; dedupe: string[] } }
  | { type: 'wiki:setText'; text: string; selectStart?: number; selectEnd?: number }
  | { type: 'wiki:select'; start: number; end: number };

export interface WikiStatus {
  /** ソースエディタ（#wpTextbox1）が開いているか */
  editing: boolean;
  /** VisualEditor が有効か（未対応） */
  visualEditor: boolean;
  pageName?: string;
  host: string;
}

export type WikiResponse<T = unknown> = { ok: true; result: T } | { ok: false; error: string };

/** MAIN world とのやり取りで使う window.postMessage の印 */
export const BRIDGE_TO_MAIN = 'citebridge:to-main';
export const BRIDGE_FROM_MAIN = 'citebridge:from-main';
