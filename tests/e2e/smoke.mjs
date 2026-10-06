import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * 拡張を Chromium に読み込んで、主な流れを通しで確かめるスモークテスト。
 * 外部 API と編集画面はすべて偽物に差し替えるので、ネットワークにもウィキペディアにも出ない（保存も当然しない）。
 *
 *   npm run build && npm run e2e
 *   （Chromium の場所は CHROMIUM_PATH で指定）
 */

// 拡張の Service Worker からの通信も route で差し替えるため
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS ??= '1';

const ROOT = resolve(import.meta.dirname, '../..');
const EXT = join(ROOT, '.output/chrome-mv3');
const OUT = mkdtempSync(join(tmpdir(), 'citebridge-e2e-'));
const FX = (f) => readFileSync(join(ROOT, 'tests/fixtures', f), 'utf8');
const shot = (p, n) => p.screenshot({ path: join(OUT, `${n}.png`), fullPage: true });

const WIKI_TEXT = `'''例'''は例である<ref>{{Cite book ja |last1=夏目 |first1=漱石 |title=吾輩は猫である |publisher= |date=1990 |isbn=4-00-310101-4}}</ref>。

== 脚注 ==
{{Reflist}}

== 参考文献 ==
* {{Cite journal ja |last1=山田 |title=既存 |journal=誌}}
`;

// jquery.textSelection の必要な部分だけを真似た偽の編集画面
const FAKE_EDIT = `<!doctype html><html class="client-js"><head><meta charset="utf-8"><title>編集</title></head><body>
<textarea id="wpTextbox1" style="width:600px;height:300px">${WIKI_TEXT.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</textarea>
<script>
window.mw = { config: { get: (k) => ({ wgAction: 'edit', wgPageName: '利用者:Test/sandbox' })[k] } };
window.$ = (sel) => {
  const el = document.querySelector(sel);
  return {
    trigger() { el.focus(); },
    textSelection(op, a) {
      switch (op) {
        case 'getContents': return el.value;
        case 'setContents': el.value = a; return;
        case 'getCaretPosition': return el.selectionStart;
        case 'setSelection': el.setSelectionRange(a.start, a.end ?? a.start); return;
        case 'scrollToCaretPosition': return;
        case 'encapsulateSelection': {
          const s = el.selectionStart, e = el.selectionEnd;
          const ins = (a.pre ?? '') + el.value.slice(s, e) + (a.post ?? '');
          el.value = el.value.slice(0, s) + ins + el.value.slice(e);
          el.setSelectionRange(s + ins.length, s + ins.length);
          return;
        }
      }
    },
  };
};
</script></body></html>`;

const ctx = await chromium.launchPersistentContext(join(OUT, 'profile'), {
  executablePath: process.env.CHROMIUM_PATH,
  headless: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--headless=new'],
});

const routes = [
  [/doi\.org\/ra\//, () => ({ body: FX('ra_jalc.json'), ct: 'application/json' })],
  [/api\.japanlinkcenter\.org\/dois\//, () => ({ body: FX('jalc_10.20645_00000025.json'), ct: 'application/json' })],
  [/cir\.nii\.ac\.jp\/crid\/1390853649708396416\.json/, () => ({ body: FX('cir_1390853649708396416.json'), ct: 'application/json' })],
  [/ndlsearch\.ndl\.go\.jp\/api\/sru/, () => ({ body: FX('ndl_sru_jpno_90035836.xml'), ct: 'application/xml' })],
  [/da\.lib\.kobe-u\.ac\.jp\/da\/np\//, () => ({ body: `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>新聞記事文庫</title>
    </head><body><p id="t">紡績各社の操業短縮は本月より更に強化せらるべし</p>
    <table class="simple_data_block">
      <tr><th class="md_776">タイトル</th><td class="md_776"><div class="metadata_value">綿業の不振</div></td></tr>
      <tr><th class="md_788">新聞名</th><td class="md_788"><div class="metadata_value">大阪朝日新聞</div></td></tr>
      <tr><th class="md_955">出版日</th><td class="md_955"><div class="metadata_value">1930-05-03</div></td></tr>
    </table></body></html>`, ct: 'text/html; charset=utf-8' })],
  [/kotobank\.jp\/word\//, () => ({ body: FX('kotobank_864282.html'), ct: 'text/html; charset=utf-8' })],
  [/ja\.wikipedia\.org\/w\/index\.php/, () => ({ body: FAKE_EDIT, ct: 'text/html; charset=utf-8' })],
];
const requested = [];
const pageErrors = [];
await ctx.route('**/*', (route) => {
  const url = route.request().url();
  if (url.startsWith('chrome-extension://')) return route.continue();
  requested.push(url);
  const hit = routes.find(([re]) => re.test(url));
  if (hit) {
    const r = hit[1]();
    return route.fulfill({ status: 200, body: r.body, contentType: r.ct, headers: { 'access-control-allow-origin': '*' } });
  }
  return route.fulfill({ status: 404, body: 'not found' });
});

let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const extId = sw.url().split('/')[2];

const wiki = await ctx.newPage();
await wiki.goto('https://ja.wikipedia.org/w/index.php?title=Sandbox&action=edit');
await wiki.waitForTimeout(800);

const panel = await ctx.newPage();
panel.on('pageerror', (e) => pageErrors.push(e.message));
await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
await panel.waitForSelector('text=識別子または URL');
await shot(panel, '1-empty');

// 1) DOI から取得して生成
await panel.fill('input[placeholder^="例"]', '10.20645/00000025');
await panel.click('button:has-text("取得")');
await panel.waitForSelector('textarea.cdx-text-area__textarea >> nth=0', { timeout: 15000 }).catch(() => {});
await panel.waitForTimeout(1500);
const wt = await panel.locator('.cb-code textarea').inputValue().catch((e) => 'ERR ' + e.message);
assert.match(wt, /^\{\{Cite journal ja \|last1=近藤 \|first1=哲 \|title=漱石とハーンの神秘主義 .*\|doi=10\.20645\/00000025/);
await shot(panel, '2-generated');

// 2) ブリッジ: サイドパネルから編集画面のタブへ直接メッセージを送る
const wikiTabId = await panel.evaluate(async () => (await chrome.tabs.query({ url: 'https://ja.wikipedia.org/*' }))[0].id);
const r1 = await panel.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'wiki:status' }), wikiTabId);
assert.deepEqual(r1, { ok: true, result: { editing: true, visualEditor: false, pageName: '利用者:Test/sandbox', host: 'ja.wikipedia.org' } });
await wiki.evaluate(() => {
  const el = document.getElementById('wpTextbox1');
  const i = el.value.indexOf('である') + 3;
  el.setSelectionRange(i, i);
});
const r2 = await panel.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'wiki:insert', text: '{{Sfn|近藤|1997|p=12}}', bibliography: { line: '* {{Cite journal ja |last1=近藤 |title=漱石とハーンの神秘主義 |ref={{SfnRef|近藤|1997}}}}', dedupe: ['{{SfnRef|近藤|1997}}'] } }), wikiTabId);
assert.deepEqual(r2, { ok: true, result: { bibliography: 'inserted' } });
const afterInsert = await wiki.locator('#wpTextbox1').inputValue();
assert.ok(afterInsert.includes('である{{Sfn|近藤|1997|p=12}}<ref>'), 'Sfn がカーソル位置に入る');
assert.ok(afterInsert.includes('|journal=誌}}\n* {{Cite journal ja |last1=近藤'), '参考文献節の末尾に追記される');

// 3) 記事の出典タブ（アクティブタブ判定は wiki タブを前面にして確認）
await wiki.bringToFront();
const art = await panel.evaluate(async () => {
  const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return t?.url;
});
assert.ok(art?.startsWith('https://ja.wikipedia.org/'));

// 4) クリップボード保存と一覧
await panel.bringToFront();
await panel.click('button:has-text("クリップボードに保存")');
await panel.waitForTimeout(300);
await panel.click('.cdx-tabs__list >> text=クリップボード');
await panel.waitForTimeout(500);
await shot(panel, '3-clipboard');
await panel.click('.cdx-tabs__list >> text=設定');
await panel.waitForTimeout(300);
await shot(panel, '4-settings');

// 5) ポップアップ
const popup = await ctx.newPage();
popup.on('pageerror', (e) => pageErrors.push(e.message));
await popup.setViewportSize({ width: 460, height: 700 });
await popup.goto(`chrome-extension://${extId}/popup.html`);
await popup.fill('input[placeholder^="例"]', 'https://cir.nii.ac.jp/crid/1390853649708396416');
await popup.click('button:has-text("取得")');
await popup.waitForTimeout(2000);
const pw = await popup.locator('.cb-code textarea').inputValue();
assert.ok(pw.includes('|crid=1390853649708396416') && pw.includes('{{国立国会図書館書誌ID|4196074}}'), 'CRID から CiNii と JaLC を照合');
// 2回目の JaLC 取得はキャッシュから（ネットワークに出ない）
assert.equal(requested.filter((u) => u.includes('japanlinkcenter')).length, 1);
await shot(popup, '5-popup');

// 6) 閲覧中ページ（新聞記事文庫）の取り込みと一節
const np = await ctx.newPage();
await np.goto('https://da.lib.kobe-u.ac.jp/da/np/0100012345/');
await np.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('t')); getSelection().addRange(r); });
const npTab = await panel.evaluate(async () => (await chrome.tabs.query({ url: 'https://da.lib.kobe-u.ac.jp/*' }))[0].id);
const cap = await panel.evaluate((id) => chrome.runtime.sendMessage({ type: 'capture-tab', tabId: id, withSelection: true }), npTab);
assert.equal(cap.ok, true);
assert.equal(cap.recordKey, 'kobenp:0100012345');
assert.ok(cap.passageId);
await panel.bringToFront();
await panel.waitForTimeout(800);
await shot(panel, '6-captured');
// 一節にページを入れて、その一節で出典を作る
await panel.locator('input[aria-label="ページ"]').first().fill('2');
await panel.locator('input[aria-label="ページ"]').first().press('Tab');
await panel.waitForTimeout(300);
await panel.click('button:has-text("この一節で出典を作る")');
await panel.waitForTimeout(500);
assert.match(
  await panel.locator('.cb-code textarea').inputValue(),
  /^\{\{Cite news ja \|title=綿業の不振 \|newspaper=大阪朝日新聞 \|page=2 \|date=1930-05-03 \|url=https:\/\/hdl\.handle\.net\/20\.500\.14094\/0100012345 \|access-date=\d{4}-\d{2}-\d{2} \|via=神戸大学経済経営研究所 新聞記事文庫\}\}$/,
);
await shot(panel, '7-from-passage');

// 6b) コトバンク: 1 ページに複数の辞書の項目が並ぶ。#w-… を選択範囲・URL・画面位置から決める（実 DOM で確認）
const KB = 'https://kotobank.jp/word/%E5%B9%B3%E9%87%8E%E9%83%B7-864282';
const kb = await ctx.newPage();
await kb.goto(KB);
const kbTab = await panel.evaluate(async () => (await chrome.tabs.query({ url: 'https://kotobank.jp/*' }))[0].id);
const capKb = (withSelection) => panel.evaluate(([id, sel]) => chrome.runtime.sendMessage({ type: 'capture-tab', tabId: id, withSelection: sel }), [kbTab, withSelection]);
// a) 選択範囲がある項目（改訂新版 世界大百科事典）
await kb.evaluate(() => {
  const r = document.createRange();
  r.selectNodeContents(document.querySelector('article.sekaidaihyakka section.description p'));
  getSelection().removeAllRanges();
  getSelection().addRange(r);
});
let c = await capKb(true);
assert.equal(c.ok, true, JSON.stringify(c));
assert.equal(c.recordKey, 'kotobank:平野郷-864282#w-1199559', '選択範囲の項目の #w- を使う');
// b) 選択なし・URL に #w- なし → 画面に見えている項目（先頭のマイペディア）
await kb.evaluate(() => getSelection().removeAllRanges());
c = await capKb(false);
assert.equal(c.recordKey, 'kotobank:平野郷-864282#w-864282', '画面位置から項目を決める');
// c) URL に #w- があれば、選択が無いときはそれを使う
await kb.goto(`${KB}#w-3354299`);
await kb.evaluate(() => getSelection().removeAllRanges());
c = await capKb(false);
assert.equal(c.recordKey, 'kotobank:平野郷-864282#w-3354299', 'URL の #w- を使う');
await kb.close();
// d) サイドパネルに #w- なしの URL を入れると、辞書名つきの候補が出る
await panel.bringToFront();
await panel.click('.cdx-tabs__list >> text=作成'); // 取り込むとクリップボードのタブに移っている
await panel.fill('input[placeholder^="例"]', KB);
await panel.click('button:has-text("取得")');
await panel.waitForSelector('button:has-text("改訂新版 世界大百科事典（脇田 修）")', { timeout: 15000 });
await shot(panel, '7b-kotobank-candidates');
await panel.click('button:has-text("改訂新版 世界大百科事典（脇田 修）")');
await panel.waitForTimeout(800);
const kbWt = await panel.locator('.cb-code textarea').inputValue();
assert.match(kbWt, /^\{\{Cite encyclopedia ja \|last1=脇田 \|first1=修 \|title=平野郷 \|encyclopedia=改訂新版 世界大百科事典 \|publisher=平凡社 \|url=https:\/\/kotobank\.jp\/word\/%E5%B9%B3%E9%87%8E%E9%83%B7-864282#w-1199559 \|access-date=\d{4}-\d{2}-\d{2} \|via=コトバンク\}\}$/);
await shot(panel, '7c-kotobank');

// 7) 記事の出典タブ：wiki タブを前面にして読み込み、空欄補完
await wiki.bringToFront();
await panel.click('.cdx-tabs__list >> text=記事の出典');
await panel.click('button:has-text("記事の出典を読み込む")');
await panel.waitForTimeout(800);
await panel.locator('button:has-text("空欄を補う候補を調べる")').first().click();
await panel.waitForTimeout(1500);
await panel.click('button:has-text("選んだ項目を記事に反映")');
await panel.waitForTimeout(800);
await panel.bringToFront();
await shot(panel, '8-article');
const filled = await wiki.locator('#wpTextbox1').inputValue();
assert.ok(filled.includes('|title=吾輩は猫である |publisher=岩波書店 |date=1990 |isbn=4-00-310101-4 |series=岩波文庫'), '空欄に記入し、既存の値（date=1990）は変えない');

assert.ok(!pageErrors.length, pageErrors.join('\n'));
console.log(`ok — スクリーンショット: ${OUT}`);
await ctx.close();
