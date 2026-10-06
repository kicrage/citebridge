# Citebridge — 作業メモ（Claude 向け）

jawiki 向けの出典テンプレート生成 Chrome 拡張（WXT + Vue 3 + Codex + Dexie）。計画・進捗・未検証の点は docs/PLAN.md、使い方は README.md。

## 決まりごと
- 応答・コメント・UI 文言は日本語。
- **ウィキペディアへの保存は絶対に自動化しない**（挿入まで）。jawiki への書き込み系 API も呼ばない。読み取り（action=parse 等）は可。
- UI は Codex のみ（@wikimedia/codex、デザイントークンは theme-wikimedia-ui.css）。React/MUI 等は使わない。
- テンプレートの引数は各モジュールの Whitelist（profiles.generated.json）を正とする。TemplateData は補助。
- 変更後は `npm test`・`npm run compile` を通す。生成結果が変わる変更はゴールデン（tests/golden）を見直してから更新する。
- Wikimedia API は連続アクセスで 429 になるので間隔を空ける。
- ref={{SfnRef|…}} は、CS1 / CS-ja が著者（編者）と年から自動生成する CITEREF（jawiki の action=parse で確認済み）と {{Sfn}} のキーが一致しないときだけ付ける。同じ値を明示すると「CS1メンテナンス: デフォルトと同じref」になる。付けるのは著者も編者もいないとき、author= に「姓 名」を書く設定のとき等。設定 sfnRef: needed（既定）/ always / never。
- NDL デジタルコレクションの PID は dl.ndl.go.jp の URL（/ja/ /en/ 等の言語プレフィックス、/api/iiif/{pid}/、スキームなし）と NDL サーチの books/R100000039-I{PID} から取る（I 番号は PID。R100000002 / R000000004 の I 番号は書誌ID）。

## 構成
- src/core/: UI 非依存の純粋関数（ids, sources, merge, templates, wikitext, transforms）。すべて Vitest 対象
- src/entrypoints/: background（取得・キャッシュ・取り込み）、wiki.content + wiki-main.content（MAIN world で jquery.textSelection により挿入）、sidepanel、popup
- src/ui/: Vue コンポーネントと共有状態、src/db/: Dexie
- tests/fixtures: API の録画レスポンス、tests/e2e/smoke.mjs: Chromium で通しのスモークテスト（API と編集画面は偽物）。`npm run build` のあと `CHROMIUM_PATH="C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" npm run e2e`（Edge 154 で拡張の読み込みまで動く。Playwright の Chromium は未導入。ブランド版 Chrome は --load-extension が効かない可能性）

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
   - 「世界大百科事典（旧版）内の〇〇の言及」（article#sekai_refs）は他項目（【油】より…）の抜粋で、w- 目印もリンクも無い。項目扱いにして wid=ref1, ref2…（ページ内の順）、題名=抜粋元の項目名（油）、辞書名・出版社は出典欄から、url=語のページ#sekai_refs（抜粋元の項目自体の URL は HTML に無い）。取り込みでは選択位置を含む <article> の中だけで目印を探す（別辞書の項目に飛ばない）。
   - 録画は 平野郷-864282 と 夏目漱石-17193（13 辞書）。テストは tests/kotobank.test.ts。host_permissions に kotobank.jp を追加したので、更新後に権限の再承認が要る。
1d. 機関リポジトリ（WEKO）・雑誌（NCID/ISSN）（2026-10-06）:
   - ページ取り込み: citation_author に 1 人 3 表記（漢字・カナ・ローマ字）が並ぶ → 漢字だけ残しカナを yomi に（pagemeta の dedupeScripts）。meta に無く本文の表にだけある NCID（「識別子タイプ NCID／関連識別子 AN…」）は collectPage が本文から拾い citebridge:ncid として渡す（収録誌の NCID）。
   - issn= を出力する（NATIVE_IDS）。DOI があれば出さない（論文は DOI で特定済み）。
   - 雑誌の NCID は CiNii Research の opensearch/books?ncid= で引く（全文検索 opensearch/all では雑誌が上位に出ず「見つからない」になっていた）。雑誌レコード（resourceType「雑誌」）は 誌名=container・ISSN・NCID、題名は空（記事名は利用者が補う）、発行者は著者にしない、刊行期間（1976.3-2002.3）は日付にしない。
   - ISSN 入力: opensearch/books?issn= で雑誌を検索（同じ ISSN のサブシリーズが複数ある）。1 件ならそのまま、複数なら候補ボタン（ChooseEntryError、src/core/sources/choose.ts。コトバンクと共通）。NDL サーチの ISSN 検索は論文まで 1500 件返すので使わない。
   - サイドパネルのボタンからの取り込みで、許可が無いサイト（host_permissions 外。機関リポジトリなど）は許可ダイアログが要る。ダイアログはクリック直後に出さないと出ない/拒否扱いになるので、直近のアクティブタブの URL を覚えておいて await を挟まず request する。許可が無くて読めないときは、黙って Citoid に落とさずエラーで許可を促す。
2. ~~実 API（JaLC・Crossref・CiNii・NDL）で取得を確認~~ → 済（2026-10-06）。Crossref（DOI 2 件）・CiNii（CRID/NAID/NCID）・NDL（ISBN/JPNO/書誌ID/記事索引）は実応答で出典が組み立つ。JaLC は実応答（curl）がフィクスチャと同じキー構成であることだけ確認（下記の環境事情で Node からは引けなかった）。見つけて直したこと:
   - NDL サーチの雑誌記事索引 R000000004-I{n} を ndlbib 扱いしていて、同じ番号の別の図書（R100000002-I{12桁}）を引いていた → IdType ndlarticle を新設。ndlbib は NDL の解決規則に合わせ、9 桁以上は図書（R100000002-I{そのまま}、0 埋めしない）、短い番号は記事索引。記事の NDLBibID（0 埋めなし）は {{国立国会図書館書誌ID}} で記事に解決されるのでそのまま出す。
   - DOI 10.11501/{PID} は NDL デジタルコレクションの DOI。JaLC 経由だと著者を姓名に割る・巻次が題名に混ざる → PID として OAI-PMH で引く。
   - 叢書名の「 ; ア7-5」（巻次）を series から落とす。CRID からの取得で CiNii を二重に引いていたのをやめた。
   - createHttp にネットワークエラー（接続タイムアウト・DNS）の再試行を追加。
   - 環境メモ: この開発環境は .jp ホストの初回 DNS 解決が約 12 秒かかり、Node の接続タイムアウト（10 秒）を超えて api.japanlinkcenter.org が引けないことが多い（curl なら通る）。コードの問題ではない。
   - 未確認: JaLC の図書・学位論文 DOI、CiNii の学位論文、Newspaper の NDL PID。CiNii の連載誌（NCID）は date が範囲（1994.3-2006.2）で解釈できず警告が出る（仕様どおり）。
3. ~~生成 wikitext を jawiki の action=parse に通す~~ → 済（2026-10-06）。`npm run check:parse`（scripts/parse-check.ts）で tests/golden の全行と録画データ由来の出典 122 件を通し、想定外のエラー・カテゴリは 0。分かったこと:
   - CS-ja / CS1 は CITEREF を自動生成する（last1=夏目 → CITEREF夏目1990、author1=夏目漱石 → CITEREF夏目漱石1990、著者は最大 4 人、著者がなければ編者）。著者も編者もいないと生成されない。→ ref= は一致しないときだけ（上の決まりごと）。
   - id={{NDLDC|pid}} は裸の URL を出すだけで、CS1 が id の後ろに付ける「。」までリンクに含まれて壊れる → {{NDLDC|pid|format=ndljp}}（「NDLJP:pid」のリンク）にした。
   - date=YYYY-MM は MM が年の下 2 桁より大きいと（2003-12、2010-11）「曖昧な日付のフォーマット」のメンテナンスカテゴリ → その場合だけ「2003年12月」と書く（1997-03 などは ISO のまま）。
   - {{新聞記事文庫|url|ID}} の出力は https://hdl.handle.net/20.500.14094/ID で、現状の url= の Handle URL と同じ。cite 形式は Cite news に id=[[神戸大学]]経済経営研究所 新聞記事文庫 を付けて出す（出所の表記）。→ 同じ出所を via=神戸大学経済経営研究所 新聞記事文庫 として出すようにした。
   - 記事題名の無い雑誌の号（NDLDC の雑誌 PID）は title 必須エラーになる（利用者が補う前提で、check:parse では期待どおり扱い）。
   - 書誌ID・全国書誌番号・コトバンク（via=）・新聞記事文庫・Cite encyclopedia ja はエラーなし。NDL の {{国立国会図書館書誌ID|N}} は id.ndl.go.jp/bib/N → ndlonline で、0 埋めなしの短い番号（〜8 桁）は雑誌記事索引、9 桁以上は図書に解決される（fetchNdl もこの規則）。
4. 実際の Chrome に .output/chrome-mv3 を読み込み、利用者サンドボックスの編集画面で挿入・Sfn・空欄補完を手動確認（保存はしない）。
   - 済（2026-10-06）: 実 Chromium（Edge 154）に拡張を読み込んだスモークテストが通る。偽の API・編集画面で、DOI/CRID の取得・キャッシュ再利用・編集画面への Sfn 挿入と参考文献追記・クリップボード・ポップアップ・新聞記事文庫の取り込み（表の解析、via=）・記事の出典の空欄補完、コトバンク（実 DOM での選択範囲／URL の #w-／画面位置による項目判定、サイドパネルの候補ボタン）。スクリーンショットで UI も確認（候補ボタンは折り返して縦並びにした）。
   - 未了（利用者の手作業）: ① 利用者自身の Chrome に chrome://extensions →「パッケージ化されていない拡張機能」で .output/chrome-mv3 を読み込む（host_permissions に dl.ndl.go.jp / kotobank.jp が増えているので再承認）。② 利用者サンドボックス（jawiki のログイン状態）の本物の編集画面で、挿入位置・Sfn・参考文献節への追記・空欄補完・VisualEditor でない通常のソース編集画面での動作を確認。保存はしない。③ 本物のコトバンク／NDL／新聞記事文庫のページで「閲覧中のページから取り込む」。
