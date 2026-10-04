# Citebridge

DOI・CRID・NAID・NCID・NDL書誌ID・全国書誌番号・ISBN・NDLデジタルコレクション・新聞記事文庫・URL から、
日本語版ウィキペディアの `{{Cite ○○ ja}}` / `{{Cite ○○2}}` 出典テンプレートを作る Chrome 拡張です。
編集画面への挿入までを行い、**記事の保存は行いません**。

## できること

- **作成**: 識別子を入れると JaLC・Crossref・CiNii Research・NDLサーチ・Citoid から書誌を集めて照合し、テンプレートを生成。
  系統（ja / 2）は記事内の多数派に合わせるか固定。書誌情報の修正、ウィキテキストの直接編集、CS1 / CS-ja のエラー予測。
- **出典クリップボード**: 文献と「一節」（引用文＋ページ・章節・コマ）を保存。閲覧中のページで右クリック →
  「選択範囲を一節として保存」または Alt+Shift+Q。一節の使い方は「ページのみ」「ページ＋引用文」「Sfn 形式」を設定・個別に切替。
  Sfn 形式では本文に `{{Sfn}}`、参考文献節に本体を追記。
- **記事の出典**: 記事内の出典テンプレートを一覧し、エラー・重複を表示。識別子から引き直して空欄・未記入の引数だけを補う（既存の値は変えない）。

## 開発

```sh
npm install
npm run dev          # Chrome に読み込んだ状態で起動
npm run build        # .output/chrome-mv3 を生成（chrome://extensions で「パッケージ化されていない拡張機能」として読み込み）
npm test             # Vitest（ID 判定・和暦・人名・アダプタ・ゴールデン）
npm run compile      # 型検査
npm run e2e          # ビルド後、Chromium で通しのスモークテスト（CHROMIUM_PATH に実行ファイル）
npm run gen:profiles # jawiki の CS-ja / CS1 の Whitelist と TemplateData からテンプレート定義を更新
```

計画と設計は [docs/PLAN.md](docs/PLAN.md) を参照。
