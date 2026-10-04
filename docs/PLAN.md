# Citebridge — 実装計画（MVP〜v0.3）

## Context
jawikiでは `{{Cite ○○}}`（＋`|和書`）が事実上の標準で、既存ツール（VE Citoid / RefToolbar / ProveIt 等）もそれ前提。ユーザーは `{{Cite ○○ ja}}` と `{{Cite ○○2}}` を常用しており、これらに対応した出典生成ツールが存在しないことが発案動機。
ID（DOI/CRID/NDL書誌ID/ISBN 等）→ メタデータ取得 → ja／2 系テンプレート生成 → 編集 → 挿入、さらに出典クリップボードと「一節＋ページ番号」の紐づけを行う Chrome 拡張を新規作成する（`C:\Users\kicra\Documents\Citebridge` は空）。

### 調査で確定した事実（jawiki）
| 系統 | 実体 | TemplateData |
|---|---|---|
| `Cite ○○`（+`|和書`） | `Citation/core` / `Citation/core-ja-jp`（非Lua旧式） | あり（本ツールでは後回し） |
| `Cite ○○ ja`（26種: book/journal/web/news/magazine/thesis/report/conference/encyclopedia…） | `モジュール:Citation/CS-ja` + `/Configuration` + `/Whitelist` | **少なくとも book ja は無し** |
| `Cite ○○2`（12種: web/news/book/journal/conference/press release/magazine/report/interview/thesis/AV media notes/wikisource） | `モジュール:Citation/CS1`（+Identifiers/Date validation/Whitelist） | あり・citoid maps あり（book2 は部分的） |
- `Cite journal2` は `crid`/`naid`/`ncid`、`Cite book2` は `crid`/`ncid`（`naid` 無し）→ **専用引数の有無はテンプレート単位で判定必須**。
- ⇒ TemplateData 単独では ja 系に対応不可。**各モジュールの `/Whitelist`（Luaテーブル）を正とし、TemplateData は補助**とする。

### ユーザー決定事項
- UI：**Codex 完全準拠**（→ Vue 3 + `@wikimedia/codex` + `@wikimedia/codex-design-tokens`。React/MUI は使わない）
- ブラウザ：**Chrome/Edge 先行**（sidePanel API）。Firefox は後段階
- MVP 対象：**ja 系と 2 系の両方**
- 一節の使い方：**page(s)= のみ / quote= 挿入 / sfn・harv 形式** を**設定で切替**（挿入時に個別上書きも可）
- 前回提案の追加機能（ページ取り込み、クリップボード、旧リンク変換、access-date、アーカイブ/WARP、撤回警告、OA、一貫性検査、翻訳支援、NDLDCコマ、sfn、一括、ショートカット、Wikidata）は今後の方針として採用

## 技術スタック
WXT（MV3, Chrome先行）／Vue 3 + Codex／TypeScript／Dexie(IndexedDB)／Vitest／pnpm

## ディレクトリ構成（主要）
```
src/
  core/                      # UI非依存・純粋関数中心（全てユニットテスト対象）
    ids/        detect.ts normalize.ts (doi, crid, naid, ncid, ndlbib, jpno, ndldc, isbn, issn, hdl)
    model/      record.ts (CiteRecord: CSL-JSON拡張・多言語・provenance) passage.ts
    sources/    doi-ra.ts crossref.ts jalc.ts cinii-research.ts ndl-search.ts citoid.ts page-meta.ts
    merge/      merge.ts (項目別優先規則・出典記録・矛盾リスト)
    templates/
      profiles/ cs-ja.json cs1-2.json   # 生成物：テンプレート別の有効引数・別名・専用ID引数
      overrides/ jawiki.json            # 手書き補正（型→テンプレート選択、ID→専用引数 or id={{X}}）
      mapper.ts   # CiteRecord + Passage + 設定 → {template, params}
      serialize.ts# params → wikitext（横並び/縦並び、記事スタイル追従）
      validate.ts # CS1/CS-ja エラー予測（必須引数・日付形式等）
    wikitext/   parse-refs.ts (書式保持の <ref>/テンプレート解析)
    transforms/ names.ts dates.ts (和暦・ISBD・巻号) pages.ts
  entrypoints/
    background.ts            # fetch プロキシ・ホスト別レート制限・キャッシュ層
    sidepanel/  (Vue+Codex)  # 主UI：ID入力・編集・クリップボード・一節・記事内出典一覧
    popup/      (Vue+Codex)  # 素早い ID→コピー/挿入
    wiki.content.ts          # *.wikipedia.org 編集画面検出・MAIN world ブリッジ注入
    wiki-main.ts             # MAIN world：mw / textSelection 経由で挿入・本文取得
    capture.content.ts       # 任意ページ：citation_* meta/COinS/JSON-LD 抽出、選択テキスト→一節
  db/ dexie.ts (records, rawResponses, passages, clips, templateCache, settings)
scripts/
  gen-profiles.ts            # jawiki の CS-ja / CS1 Whitelist(raw Lua) + TemplateData を取得→ profiles/*.json 生成
tests/ fixtures/ (APIレスポンス録画) golden/ (record→wikitext 期待値)
```

## データモデル要点
- `CiteRecord`：`key`（"doi:…" 等）、`ids`、`type`、`title{ja,en,…}`、`authors[{family,given,literal,yomi}]`、`issued{iso,raw}`、巻号頁・出版者等、`provenance[field]`、`userOverrides`（別層）、`schemaVersion`。
- `Passage`（一節）：`id, recordKey, text, page, pageKind('p'|'pp'|'loc'|'koma'), note, sourceUrl, capturedAt`。1レコード:N一節。
- `Clip`（出典クリップボード）：レコード参照＋タグ＋対象記事メモ。
- 挿入時、一節モード（設定値／個別上書き）:
  - `pages`：`page=`/`pages=` のみ
  - `quote`：`page(s)=` + `quote=`
  - `sfn`：カーソルに `{{Sfn|著者|年|p=}}`、本体テンプレートを「参考文献」節に存在確認→無ければ追加（`ref=harv`/`{{SfnRef}}` の ja 系可否は gen-profiles 結果で確認して分岐）

## 段階
1. **P0 雛形**：WXT+Vue+Codex セットアップ、sidePanel/popup 空画面、Dexie、Vitest。
2. **P1 コア**：ID 検出/正規化（DOI, CRID, NDL書誌ID, ISBN, NAID, NCID）、ソース（doi.org/ra→Crossref/JaLC、CiNii Research、NDLサーチ、Citoid フォールバック）、merge、`gen-profiles.ts` で ja/2 プロファイル生成、mapper/serialize/validate、和暦・氏名・巻号変換。ゴールデンテストで固める。
3. **P2 UI＋挿入**：サイドパネルで ID→プレビュー→Codex フォームで編集→ソースエディタへ挿入（`textSelection('encapsulateSelection')`、CodeMirror 含む）。テンプレート系統は記事内多数派を既定、手動切替可。キャッシュ（生/正規化/修正の3層、ソース別TTL、書出し/読込）。`access-date` 自動。
4. **P3 クリップボード＋一節**：capture.content.ts で閲覧中ページのメタ取込（J-STAGE/CiNii/NDL/NDLDC）、選択テキスト右クリック/ショートカット→一節保存（ページ番号入力、NDLDC は URL からコマ自動）。サイドパネルで文献別に一節一覧、3モードで挿入。※Chrome 内蔵 PDF ビューアは選択取得不可→手動貼付。
5. **P4 既存出典編集**：parse-refs で記事内 `<ref>` 一覧・状態バッジ・空欄補完（差分提示、上書きはしない）・重複検出→`<ref name>` 提案。
6. 以降：VE 対応、Handle/新聞記事文庫/NDLDC IIIF、旧リンク変換、WARP/Wayback、撤回/OA、翻訳支援、Firefox。

## 運用上の決め事
- 保存は自動化しない（挿入まで）。Crossref は `mailto`、Wikimedia は `Api-User-Agent`。CiNii appid はユーザー設定入力。host_permissions は使用 API に限定、capture は `activeTab`。
- プロファイル JSON はビルド時生成（MV3 は外部コード不可、データは可）。

## 検証
- `pnpm vitest`：ID 正規化（チェックディジット等）、変換（和暦・氏名・巻号）、録画フィクスチャ→CiteRecord、CiteRecord→wikitext ゴールデン（ja/2 × book/journal/web/news/thesis × 3一節モード）。
- 実描画検証スクリプト：生成 wikitext を jawiki `action=parse`（読み取りのみ）に投げ、CS1/CS-ja のエラー表示クラス・エラーカテゴリが出ないことを確認。
- 手動 E2E：`pnpm dev` で Chrome にロード → 利用者サンドボックスの編集画面で DOI（JaLC/Crossref 各1）、CRID、NDL書誌ID、ISBN を挿入→「プレビュー」で表示確認（保存はしない）。サイドパネル/ポップアップ、キャッシュ再利用（2回目にネットワーク要求が出ないこと）を確認。
