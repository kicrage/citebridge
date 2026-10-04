import type { WikiRequest, WikiResponse, WikiStatus } from './messages';

export async function activeTab() {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

async function send<T>(req: WikiRequest): Promise<T> {
  const tab = await activeTab();
  if (!tab?.id || !tab.url || !/^https:\/\/[^/]+\.wikipedia\.org\//.test(tab.url)) {
    throw new Error('ウィキペディアの編集画面を開いてください');
  }
  let res: WikiResponse<T> | undefined;
  try {
    res = await browser.tabs.sendMessage(tab.id, req);
  } catch {
    throw new Error('編集画面と接続できません。拡張の更新後はページを再読み込みしてください');
  }
  if (!res) throw new Error('編集画面から応答がありません');
  if (!res.ok) throw new Error(res.error);
  return res.result;
}

export async function wikiStatus(): Promise<WikiStatus | undefined> {
  try {
    return await send<WikiStatus>({ type: 'wiki:status' });
  } catch {
    return undefined;
  }
}

export const wikiGetText = () => send<string>({ type: 'wiki:getText' });

export const wikiInsert = (text: string, bibliography?: { line: string; dedupe: string[] }) =>
  send<{ bibliography: 'none' | 'inserted' | 'exists' | 'no-section' }>({ type: 'wiki:insert', text, bibliography });

export const wikiSetText = (text: string, selectStart?: number, selectEnd?: number) =>
  send<true>({ type: 'wiki:setText', text, selectStart, selectEnd });

export const wikiSelect = (start: number, end: number) => send<true>({ type: 'wiki:select', start, end });
