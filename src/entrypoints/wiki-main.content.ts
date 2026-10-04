/**
 * MAIN world で動くブリッジ。ページの jQuery と mw を使ってソースエディタを操作する。
 * jquery.textSelection は WikiEditor・CodeMirror・素の textarea の違いを吸収してくれる。
 * 保存（wpSave）には一切触れない。
 */
import { insertBibliography } from '@/core/wikitext/sections';
import { BRIDGE_FROM_MAIN, BRIDGE_TO_MAIN, type WikiRequest, type WikiStatus } from '@/lib/messages';

declare const $: any;
declare const mw: any;

export default defineContentScript({
  matches: ['*://*.wikipedia.org/*'],
  world: 'MAIN',
  runAt: 'document_idle',
  main() {
    const textbox = () => {
      if (typeof $ === 'undefined' || !document.getElementById('wpTextbox1')) throw new Error('ソースエディタが開いていません');
      return $('#wpTextbox1');
    };

    function status(): WikiStatus {
      const action = typeof mw !== 'undefined' ? mw.config.get('wgAction') : undefined;
      return {
        editing: !!document.getElementById('wpTextbox1') && (action === 'edit' || action === 'submit'),
        visualEditor: document.documentElement.classList.contains('ve-active'),
        pageName: typeof mw !== 'undefined' ? mw.config.get('wgPageName') : undefined,
        host: location.host,
      };
    }

    function handle(req: WikiRequest): unknown {
      switch (req.type) {
        case 'wiki:status':
          return status();
        case 'wiki:getText':
          return textbox().textSelection('getContents');
        case 'wiki:insert': {
          const tb = textbox();
          // 選択範囲があればその直後、無ければカーソル位置に入れる（選択文字列は消さない）
          tb.textSelection('encapsulateSelection', { post: req.text });
          if (!req.bibliography) return { bibliography: 'none' };
          let caret: number = tb.textSelection('getCaretPosition');
          const r = insertBibliography(tb.textSelection('getContents'), req.bibliography.line, { dedupe: req.bibliography.dedupe });
          if (r.status === 'inserted') {
            if (r.at! <= caret) caret += req.bibliography.line.length + 1;
            tb.textSelection('setContents', r.text);
            tb.textSelection('setSelection', { start: caret });
          }
          return { bibliography: r.status };
        }
        case 'wiki:setText': {
          const tb = textbox();
          tb.textSelection('setContents', req.text);
          if (req.selectStart !== undefined) {
            tb.textSelection('setSelection', { start: req.selectStart, end: req.selectEnd ?? req.selectStart });
            tb.textSelection('scrollToCaretPosition');
          }
          return true;
        }
        case 'wiki:select': {
          const tb = textbox();
          tb.textSelection('setSelection', { start: req.start, end: req.end });
          tb.textSelection('scrollToCaretPosition');
          tb.trigger('focus');
          return true;
        }
      }
    }

    window.addEventListener('message', (ev) => {
      if (ev.source !== window || ev.data?.type !== BRIDGE_TO_MAIN) return;
      const { id, req } = ev.data as { id: string; req: WikiRequest };
      let response;
      try {
        response = { ok: true, result: handle(req) };
      } catch (e: any) {
        response = { ok: false, error: String(e?.message ?? e) };
      }
      window.postMessage({ type: BRIDGE_FROM_MAIN, id, response }, location.origin);
    });
  },
});
