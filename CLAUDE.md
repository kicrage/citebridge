# Citebridge — 作業メモ（Claude 向け）

jawiki 向けの出典テンプレート生成 Chrome 拡張（WXT + Vue 3 + Codex + Dexie）。計画・進捗・未検証の点は docs/PLAN.md、使い方は README.md。

## 決まりごと
- 応答・コメント・UI 文言は日本語。
- **ウィキペディアへの保存は絶対に自動化しない**（挿入まで）。jawiki への書き込み系 API も呼ばない。読み取り（action=parse 等）は可。
- UI は Codex のみ（@wikimedia/codex、デザイントークンは theme-wikimedia-ui.css）。React/MUI 等は使わない。
- テンプレートの引数は各モジュールの Whitelist（profiles.generated.json）を正とする。TemplateData は補助。
- 変更後は `npm test`・`npm run compile` を通す。生成結果が変わる変更はゴールデン（tests/golden）を見直してから更新する。
- Wikimedia API は連続アクセスで 429 になるので間隔を空ける。

## 構成
- src/core/: UI 非依存の純粋関数（ids, sources, merge, templates, wikitext, transforms）。すべて Vitest 対象
- src/entrypoints/: background（取得・キャッシュ・取り込み）、wiki.content + wiki-main.content（MAIN world で jquery.textSelection により挿入）、sidepanel、popup
- src/ui/: Vue コンポーネントと共有状態、src/db/: Dexie
- tests/fixtures: API の録画レスポンス、tests/e2e/smoke.mjs: Chromium で通しのスモークテスト（API と編集画面は偽物）

## 次にやること（以前の環境では外部に接続できず保留していたもの）
1. NDL デジタルコレクション PID の書誌取得: 現状は Citoid 任せで未検証。NDL の公式 API / IIIF マニフェスト / NDL サーチのいずれかで専用アダプタを作り、実レスポンスを tests/fixtures に録画してテストする。
2. 実 API（JaLC・Crossref・CiNii・NDL）で取得を確認し、必要ならフィクスチャを追加。
3. 生成 wikitext を jawiki の action=parse に通し、CS1 / CS-ja のエラー表示が出ないことを確認。特に:
   - CS-ja が CITEREF を自動生成するか（しなければ現状どおり ja 系は ref={{SfnRef|…}} を明示、するなら省ける）
   - id={{NDLDC|pid}} の表示
   - {{新聞記事文庫}} の正しい使い方（現状は url= に Handle URL）
4. 実際の Chrome に .output/chrome-mv3 を読み込み、利用者サンドボックスの編集画面で挿入・Sfn・空欄補完を手動確認（保存はしない）。
