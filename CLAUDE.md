# Citebridge — 作業メモ（Claude 向け）

jawiki 向けの出典テンプレート生成 Chrome 拡張（WXT + Vue 3 + Codex + Dexie）。計画・進捗・未検証の点は docs/PLAN.md、使い方は README.md。

## 決まりごと
- 応答・コメント・UI 文言は日本語。
- **ウィキペディアへの保存は絶対に自動化しない**（挿入まで）。jawiki への書き込み系 API も呼ばない。読み取り（action=parse 等）は可。
- UI は Codex のみ（@wikimedia/codex、デザイントークンは theme-wikimedia-ui.css）。React/MUI 等は使わない。
- テンプレートの引数は各モジュールの Whitelist（profiles.generated.json）を正とする。TemplateData は補助。
- 変更後は `npm test`・`npm run compile` を通す。生成結果が変わる変更はゴールデン（tests/golden）を見直してから更新する。
- Wikimedia API は連続アクセスで 429 になるので間隔を空ける。
- {{Sfn}} で参照されやすい種類（book・journal・magazine・thesis・report・conference）には、sfn モードでなくても ref={{SfnRef|…}} を付ける（設定 sfnRef、既定オン。web・news・事典項目は付けない）。
- NDL デジタルコレクションの PID は dl.ndl.go.jp の URL（/ja/ /en/ 等の言語プレフィックス、/api/iiif/{pid}/、スキームなし）と NDL サーチの books/R100000039-I{PID} から取る（I 番号は PID。R100000002 / R000000004 の I 番号は書誌ID）。

## 構成
- src/core/: UI 非依存の純粋関数（ids, sources, merge, templates, wikitext, transforms）。すべて Vitest 対象
- src/entrypoints/: background（取得・キャッシュ・取り込み）、wiki.content + wiki-main.content（MAIN world で jquery.textSelection により挿入）、sidepanel、popup
- src/ui/: Vue コンポーネントと共有状態、src/db/: Dexie
- tests/fixtures: API の録画レスポンス、tests/e2e/smoke.mjs: Chromium で通しのスモークテスト（API と編集画面は偽物）

## 次にやること（以前の環境では外部に接続できず保留していたもの）
1. ~~NDL デジタルコレクション PID の書誌取得~~ → 済（2026-10-05）。src/core/sources/ndl.ts の `fetchNdldc` / `parseNdldcOai`。
   - 使う API: OAI-PMH `https://dl.ndl.go.jp/api/oaipmh?verb=GetRecord&metadataPrefix=dcndl_porta&identifier=oai:dl.ndl.go.jp:info:ndljp/pid/{pid}`。公開・制限付きを問わず引ける（IIIF マニフェストは公開資料のみ、`/api/item/search/info:ndljp/pid/` は震災アーカイブ等で 404）。存在しない PID は HTTP 200 で `<error verb="idDoesNotExist">`。
   - Citoid フォールバックは廃止（SPA の汎用題名「国立国会図書館デジタルコレクション」だけ返り、失敗が成功に見えるため）。
   - 録画は tests/fixtures/ndldc_oai_*.xml（exif:width/height の繰り返しだけ除去）。図書・雑誌号・写本・錦絵・写真を網羅。テストは tests/ndldc.test.ts とゴールデン ndldc-oai-*.txt。
   - 割り切り: ids は ndldc（雑誌は issn も）のみ。DOI（10.11501/…）・書誌ID・JPNO は id=/doi= に出すと冗長なので record に入れない。雑誌・新聞の「号」は題名を container に入れ、記事題名（title）は利用者が補う（validate が必須エラーを出す）。雑誌の号は「(53);2003」形式から issue を取るが、サンプルは 1 件だけ。新聞（Newspaper）の PID は未確認。
1b. 新聞記事文庫（神戸大学）の取得（2026-10-05）: src/core/sources/kobe.ts。記事ページ `https://da.lib.kobe-u.ac.jp/da/np/{ID}/` の表（<th>項目名</th><td>）を読む（meta が無く <title> は「題名 | 新聞記事文庫」）。取れるのは題名（「主 : 副」は分離）・新聞名・著者名（「氏名:肩書」の肩書は捨てる）・出版日（連載は範囲「A/B」→初回日）。ページ（面）・新聞社名は元データに無い。巻・記事番号・切抜帳は切抜帳の位置なので出典には使わない。Handle URL・da URL・ID のどれからでも同じ。url= の Handle URL と重なるので hdl= は出さない。録画は tests/fixtures/kobe_np_*.html、テストは tests/kobe.test.ts。
1c. コトバンク（2026-10-06）: src/core/sources/kotobank.ts。語のページ `https://kotobank.jp/word/{見出し語}-{数字}` には辞書ごとの項目が並び、各項目の前に `<div class="page_link_marker" id="w-{wid}">` がある。出典 URL の `#w-…` はこの wid（ページ HTML から取れる）。記事は {{Cite encyclopedia ja}}: title=URL の見出し語、encyclopedia=辞書名（h2、全角スペースは半角に）、publisher=出典欄の最初の <small> から（「株式会社平凡社「…」」→平凡社、辞書名だけなら無し）、author=本文末尾「執筆者： …」（世界大百科事典のみ）、url=…#w-wid、via=コトバンク、access-date。
   - 項目の決め方: サイドパネルの入力に #w- が無く項目が複数なら ChooseEntryError → 候補ボタン（DetectedId.label）。ページ取り込みでは 選択範囲の項目 → URL の #w- → 画面に見えている項目（src/lib/capture.ts の entryAnchor）。
   - 候補が同じ表示になる項目（日本歴史地名大系の同一分類など）は本文の食い違い始めを添えて区別。出版社の書式は辞書ごとにまちまち（サンプルは tests/fixtures/kotobank_*.html、漱石のほうは本文を削った録画）。出版社が取れない辞書がある（ブリタニカ等は辞書名のみ）。
   - 録画は 平野郷-864282 と 夏目漱石-17193（13 辞書）。テストは tests/kotobank.test.ts。host_permissions に kotobank.jp を追加したので、更新後に権限の再承認が要る。
2. ~~実 API（JaLC・Crossref・CiNii・NDL）で取得を確認~~ → 済（2026-10-06）。Crossref（DOI 2 件）・CiNii（CRID/NAID/NCID）・NDL（ISBN/JPNO/書誌ID/記事索引）は実応答で出典が組み立つ。JaLC は実応答（curl）がフィクスチャと同じキー構成であることだけ確認（下記の環境事情で Node からは引けなかった）。見つけて直したこと:
   - NDL サーチの雑誌記事索引 R000000004-I{n} を ndlbib 扱いしていて、同じ番号の別の図書（R100000002-I{12桁}）を引いていた → IdType ndlarticle を新設。記事に付く NDLBibID は図書と番号が衝突するため、article-journal/magazine では {{国立国会図書館書誌ID}} を出さない。
   - DOI 10.11501/{PID} は NDL デジタルコレクションの DOI。JaLC 経由だと著者を姓名に割る・巻次が題名に混ざる → PID として OAI-PMH で引く。
   - 叢書名の「 ; ア7-5」（巻次）を series から落とす。CRID からの取得で CiNii を二重に引いていたのをやめた。
   - createHttp にネットワークエラー（接続タイムアウト・DNS）の再試行を追加。
   - 環境メモ: この開発環境は .jp ホストの初回 DNS 解決が約 12 秒かかり、Node の接続タイムアウト（10 秒）を超えて api.japanlinkcenter.org が引けないことが多い（curl なら通る）。コードの問題ではない。
   - 未確認: JaLC の図書・学位論文 DOI、CiNii の学位論文、Newspaper の NDL PID。CiNii の連載誌（NCID）は date が範囲（1994.3-2006.2）で解釈できず警告が出る（仕様どおり）。
3. 生成 wikitext を jawiki の action=parse に通し、CS1 / CS-ja のエラー表示が出ないことを確認。特に:
   - CS-ja が CITEREF を自動生成するか（しなければ現状どおり ja 系は ref={{SfnRef|…}} を明示、するなら省ける）
   - id={{NDLDC|pid}} の表示
   - {{新聞記事文庫}} の正しい使い方（現状は url= に Handle URL）
4. 実際の Chrome に .output/chrome-mv3 を読み込み、利用者サンドボックスの編集画面で挿入・Sfn・空欄補完を手動確認（保存はしない）。
