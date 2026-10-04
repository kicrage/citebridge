/**
 * 拡張（サイドパネル等）からの要求を MAIN world のブリッジに中継する。
 * 拡張 API は MAIN world から使えず、ページの mw / jQuery は isolated world から使えないため二段にしている。
 */
import { BRIDGE_FROM_MAIN, BRIDGE_TO_MAIN, type WikiRequest, type WikiResponse } from '@/lib/messages';

export default defineContentScript({
  matches: ['*://*.wikipedia.org/*'],
  runAt: 'document_idle',
  main() {
    const pending = new Map<string, (r: WikiResponse) => void>();

    window.addEventListener('message', (ev) => {
      if (ev.source !== window || ev.data?.type !== BRIDGE_FROM_MAIN) return;
      pending.get(ev.data.id)?.(ev.data.response);
      pending.delete(ev.data.id);
    });

    const toMain = (req: WikiRequest) =>
      new Promise<WikiResponse>((resolve) => {
        const id = crypto.randomUUID();
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve({ ok: false, error: '編集画面から応答がありません（ページを再読み込みしてください）' });
        }, 5000);
        pending.set(id, (r) => {
          clearTimeout(timer);
          resolve(r);
        });
        window.postMessage({ type: BRIDGE_TO_MAIN, id, req }, location.origin);
      });

    browser.runtime.onMessage.addListener((msg: WikiRequest, _sender, sendResponse) => {
      if (typeof msg?.type !== 'string' || !msg.type.startsWith('wiki:')) return;
      toMain(msg).then(sendResponse);
      return true;
    });
  },
});
