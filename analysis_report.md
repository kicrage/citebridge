# Citebridge 徹底分析レポート（バグ・改善点の網羅的検証）

**作成日時**: 2026-10-06  
**対象リポジトリ**: Citebridge (`c:\Users\kicra\Documents\Citebridge`)  
**ステータス**: 分析完了（修正コードの適用は行わず、分析に徹した報告）

---

## 1. 総合評価・現状の健全性

- **単体テスト (`npm test`)**: 8ファイル 163テスト 全件 PASS
- **TypeScript 型検査 (`npm run compile`)**: エラーなし（Vue 3 SFC を含む全型チェック通過）
- **設計品質**: 
  - `src/core/` が UI・ブラウザ API に依存しない純粋関数として分離されており、テスタビリティが極めて高い。
  - CS-ja / CS1 の Whitelist（Luaテーブル）をビルド時に抽出し、TemplateData の欠落を補うアプローチは jawiki の実態に即している。
  - IndexedDB（Dexie）による多層キャッシュ（生レスポンス・正規化レコード・利用者修正）が堅牢に設計されている。
- **課題と所見**:
  - 正常系およびテスト対象のフィクスチャに対しては極めて高い品質を示す一方、**正規表現の境界条件、エッジケース（未閉じタグ・0パディング日付・漢字人名）、エラーハンドリングの伝播漏れ、Chrome MV3 固有の非同期制約**において、いくつかの明確なバグおよび改善点が検出された。

---

## 2. 検出されたバグ・不具合一覧

### 【致命的・重要】

#### Bug 1: 未閉じの `{{` による `findTemplates` の走査早期終了バグ
- **該当ファイル・行**: [`src/core/wikitext/template.ts`](file:///c:/Users/kicra/Documents/Citebridge/src/core/wikitext/template.ts#L110-L114)
- **コード**:
  ```ts
  if (text.startsWith('{{', i)) {
    const t = parseTemplateAt(text, i);
    if (!t) break; // ← ここでループ全体が打ち切られる！
    if (!filter || filter(t.name)) out.push(t);
    i = t.end - 1;
  }
  ```
- **原因と影響**:
  ウィキテキストの途中に閉じ括弧 `}}` がない `{{`（利用者の書きかけ、ウィキ構文エラー、テンプレート解説の記述など）が存在した場合、`parseTemplateAt` は `undefined` を返します。
  その際、`break` しているため、**後続する数千〜数万文字に含まれる正常なテンプレートが一切検出されなくなります**。
  これにより、`findAllCites`（記事内出典一覧）、`findRefs`（重複参照検出）、`detectStyle`（記事のスタイル判定）が途中以降のすべてのテンプレートを見失います。
- **改善策**: `break` ではなく、単に `i` をインクリメントして次の文字の走査へ `continue` すべきです。

---

#### Bug 2: ページ取り込み時の `ChooseEntryError` 握りつぶしによるコトバンク取り込み失敗
- **該当ファイル・行**: [`src/entrypoints/background.ts`](file:///c:/Users/kicra/Documents/Citebridge/src/entrypoints/background.ts#L79-L84)
- **コード**:
  ```ts
  try {
    const r = await resolveId(pid, await context());
    ...
  } catch (e: any) {
    if (pid.type === 'kotobank')
      return { ok: false, error: `コトバンクの項目を取得できませんでした: ${String(e?.message ?? e)}` };
    ...
  }
  ```
- **原因と影響**:
  入力欄からの取得（`handleResolve`）では、辞書項目が特定できない場合に `ChooseEntryError` をキャッチして `{ ok: true, candidates: e.candidates }` を返し、UI に選択ボタンを出しています。
  しかし、閲覧中ページの取り込み（`capture`）では、`ChooseEntryError` を一般エラーとして catch し、即座に `{ ok: false, error: ... }` で返してしまいます。
  コトバンクのページで、選択範囲がなく、URL にも `#w-` がなく、画面位置の自動判定でも複数候補がある場合、候補選択モーダルが表示されず「取り込み失敗」のエラーとなります。
- **改善策**: `capture` の catch ブロックでも `e instanceof ChooseEntryError` を判定し、候補リストを呼び出し元（または storage）に返して辞書選択を促す必要があります。

---

#### Bug 3: `stripRole` で本名末尾の文字が役割語と誤認されて削られるバグ
- **該当ファイル・行**: [`src/core/transforms/names.ts`](file:///c:/Users/kicra/Documents/Citebridge/src/core/transforms/names.ts#L7-L12) および [L24-L28](file:///c:/Users/kicra/Documents/Citebridge/src/core/transforms/names.ts#L24-L28)
- **コード**:
  ```ts
  const ROLE_WORDS: [RegExp, Role][] = [
    [/(?:編著|編・著|共編著)$/, 'author'],
    [/(?:著|作|文|述|著作|共著|原著|原作|執筆|撰)$/, 'author'],
    [/(?:監訳|共訳|訳|翻訳|訳注|訳・注)$/, 'translator'],
    ...
  ];
  ...
  const m = new RegExp(`^(.+?)[\\s　]*${re.source}`).exec(t);
  ```
- **原因と影響**:
  空白なしで1文字の役割語（作・文・述・撰・注）が末尾にマッチします。
  そのため、「小林作」「佐藤文」「高橋述」といった実在の人名が渡された際、末尾の1文字（作・文）が役割語と誤認され、名前が「小林」「佐藤」、role が「author」となり、**本名の文字が消去されてしまいます**。
- **改善策**: 1文字の役割語（作・文・述・撰・注など）については、人名との間に空白（`[\s　]+`）が存在することを必須とするか、2文字以上の役割語（著作・共著・原著など）に限定するべきです。

---

#### Bug 4: ポップアップ画面での `browser.sidePanel.open` の User Gesture 喪失リスク
- **該当ファイル・行**: [`src/entrypoints/popup/App.vue`](file:///c:/Users/kicra/Documents/Citebridge/src/entrypoints/popup/App.vue#L18-L22)
- **コード**:
  ```ts
  async function openPanel() {
    const w = await browser.windows.getCurrent();
    if (w.id !== undefined) await browser.sidePanel.open({ windowId: w.id });
    window.close();
  }
  ```
- **原因と影響**:
  Chrome MV3 の `chrome.sidePanel.open()` はユーザー操作ハンドラから**同期的に**呼び出さなければなりません。`background.ts`（L112）には「ユーザー操作の直後に同期的に呼ぶ必要がある（await を挟むと拒否される）」と正しい注意書きがありますが、ポップアップの `openPanel` では `await browser.windows.getCurrent()` を挟んでいるため、User Gesture トークンが破棄され、Chrome のバージョンによって `sidePanel.open` がエラーで失敗します。
- **改善策**: `browser.sidePanel.open` を直接呼ぶか、ウィンドウIDを渡す場合でも同期的に取得できるコンテキストを使用する設計が必要です。

---

### 【中度・エッジケース】

#### Bug 5: `RecordForm.vue` の `commitPeople` における文字列結合の未定義値漏れ
- **該当ファイル・行**: [`src/ui/components/RecordForm.vue`](file:///c:/Users/kicra/Documents/Citebridge/src/ui/components/RecordForm.vue#L67)
- **コード**:
  ```ts
  const flat = (n: Name) => n.literal ?? `${n.family}${n.given}`;
  ```
- **原因と影響**:
  `n.family` または `n.given` のいずれか片方しか存在しない場合（欧米人の単名、または名のみなど）、`${n.family}${n.given}` は `"山田undefined"` や `"undefined太郎"` という不正な文字列になります。
  これにより、`prev.find((x) => x.yomi && flat(x) === flat(n))` による読み仮名の照合が失敗します。
- **改善策**: `${n.family ?? ''}${n.given ?? ''}` と修正する必要があります。

---

#### Bug 6: NDL デジタルコレクション新URLにおける「巻」と「コマ」の誤認
- **該当ファイル・行**: [`src/core/ids/detect.ts`](file:///c:/Users/kicra/Documents/Citebridge/src/core/ids/detect.ts#L83-L88)
- **コード**:
  ```ts
  const m = /^(?:info:ndljp\/)?(?:pid\/)?(\d{6,10})(?:\/(\d+)(?:\/(\d+))?)?/.exec(v);
  if (!m) return null;
  const koma = m[3] ? Number(m[3]) : m[2] ? Number(m[2]) : undefined;
  ```
- **原因と影響**:
  NDL デジコレの新形式 URL は `pid/{pid}/{巻}/{コマ}`（例: `pid/1234567/1/45`）または単に巻まで `pid/{pid}/{巻}`（例: `pid/1234567/2`）があります。
  もし利用者が複数巻ある資料の「第2巻」の URL（`.../pid/1234567/2`）を入力した場合、`m[2]` が 2、`m[3]` が undefined となり、`koma` が 2（第2巻ではなく「2コマ目」）と誤判定されてしまいます。
  また、正規表現で `\d{6,10}` と6桁以上を仮定していますが、古い資料の5桁 PID や IIIF パス（`\d{5,10}`）との間で桁数の下限定義に不整合があります。

---

#### Bug 7: 月日 `00`（不明）の書誌日付で「年」すら取得できなくなる問題
- **該当ファイル・行**: [`src/core/transforms/dates.ts`](file:///c:/Users/kicra/Documents/Citebridge/src/core/transforms/dates.ts#L20-L22) および [L44](file:///c:/Users/kicra/Documents/Citebridge/src/core/transforms/dates.ts#L44)
- **コード**:
  ```ts
  const valid = (y?: number, m?: number, d?: number) =>
    (y === undefined || (y > 0 && y < 3000)) &&
    (m === undefined || (m >= 1 && m <= 12)) &&
    (d === undefined || (d >= 1 && d <= 31));
  ```
- **原因と影響**:
  NDL、CiNii、J-STAGE などの学術・図書館書誌では、月や日が不明な場合に `2003-00-00` や `1998-04-00` と返すことが一般的です。
  この場合、`m` や `d` が 0 となるため `valid` が false を返し、`build` は `{ raw }` のみを返します。
  年 `2003` が明確に存在しているにもかかわらず、`y`（年）が未定義となり、`{{SfnRef}}` や `date=` のフォーマットが破綻します。
- **改善策**: `m === 0` や `d === 0` の場合は単に undefined として扱い、年のみを有効化すべきです。

---

#### Bug 8: `applyFills` における空欄補完時のスペース二重化と角括弧エスケープ漏れ
- **該当ファイル・行**: [`src/core/wikitext/refs.ts`](file:///c:/Users/kicra/Documents/Citebridge/src/core/wikitext/refs.ts#L147-L153)
- **コード**:
  ```ts
  for (const f of fills.filter((f) => f.kind === 'empty')) {
    const p = t.params.find((x) => x.named && paramKey(x.name) === paramKey(f.param.name))!;
    const seg = text.slice(p.start, p.end);
    const eq = seg.indexOf('=');
    const trail = /\s*$/.exec(seg)![0];
    edits.push({ at: p.start + eq + 1, end: p.end - trail.length, insert: (spaced ? ' ' : '') + escapeValue(f.param.value, { raw: f.param.raw }) });
  }
  ```
- **原因と影響**:
  1. 元のテキストが `| title = ` のように `=` の前後に空白がある場合、`seg` の `=` の直後から末尾空白の手前までに挿入されます。`insert` で `spaced ? ' ' : ''` を足しているため、`| title =  補完値 ` とスペースが2重になってしまいます。
  2. 新規引数追加（L143）では `brackets: /^(title|chapter)$/.test(p.name)` を指定して `&#91;` `&#93;` へのエスケープを行っていますが、空欄補完（L152）では `brackets` オプションを渡していません。角括弧を含むタイトルを補完した際に CS1 でエラーが発生します。

---

#### Bug 9: `ClipboardList.vue` における Dexie `liveQuery` の購読リーク
- **該当ファイル・行**: [`src/ui/components/ClipboardList.vue`](file:///c:/Users/kicra/Documents/Citebridge/src/ui/components/ClipboardList.vue#L23-L33)
- **原因と影響**:
  `defineExpose({ unsubscribe: () => sub.unsubscribe() })` で公開されていますが、親コンポーネント（`sidepanel/App.vue`）から呼ばれておらず、`onUnmounted` も登録されていません。
  サイドパネル内でタブを切り替えるたびに購読が蓄積し、バックグラウンドでの DB クエリ実行とメモリ消費が増加します。
- **改善策**: `onUnmounted(() => sub.unsubscribe())` を記述すべきです。

---

## 3. 仕様・設計上の改善点・不整合

### 1. CS1（2系）に対する `ref={{SfnRef|...}}` 付与の過剰性と設定乖離
- **現状**: `mapper.ts` L306 では、`family`（ja / 2）を問わず、`sfnRef` 設定が有効な場合は常に `ref={{SfnRef|...}}` を付与しています。
- **課題**: 
  - `CLAUDE.md`（L88）には「2 系は著者がいないときだけ」と記載されていますが、実際の実装では 2 系（`Cite book2` 等）でも無条件に `ref={{SfnRef|...}}` が付与されています。
  - CS1 は著者・年から自動的に CITEREF アンカーを生成する機能を持っています。手動の `{{SfnRef}}` を強制上書きすると、姓・名の分割設定（`last-first` vs `author`）と SfnRef の引数が食い違った際にアンカー不整合が起きるリスクがあります。

### 2. ページ取り込み（Capture）と URL 直接解決の機能格差
- **現状**:
  - サイドパネルの入力欄に URL を入力: Citoid（Zoteroトランスレータ）が呼ばれ、高精度な書誌情報が得られる。
  - ページを開いて「閲覧中のページから取り込む」: `pagemeta.ts` によるメタタグ抽出のみ。Citoid は呼ばれない。
- **課題**:
  一般的な Web ページでは `<meta>` タグが貧弱なケースが多く、直接入力時とページ取り込み時で取得結果に大きな差が生じます。ページ取り込み時にも必要に応じて Citoid へのフォールバックを行うか、明示的な再取得ボタンを提供することが望まれます。

### 3. 和暦変換の対応範囲（明治以前の近世・中世元号）
- **現状**: `dates.ts` の `ERAS` には「明治」「大正」「昭和」「平成」「令和」のみ定義されています。
- **課題**:
  NDL デジタルコレクションには江戸時代以前の古典籍・写本・錦絵（寛政・文化・文政・天保・安政など）が多数存在します。これらは西暦変換できず `{ raw: '天保12' }` となり、年（`issued.y`）が欠落するため SfnRef で年が参照できなくなります。主要な江戸期元号のテーブル拡張が有用です。

### 4. 新聞記事文庫の `access-date` 付与
- **現状**: `mapper.ts` L297 で、`s.accessDate` が有効な場合、`!rec.ids.ndldc`（国デジ以外）には一律 `access-date` を付与しています。
- **課題**:
  新聞記事文庫（`kobenp`）は歴史的紙媒体記事のデジタルアーカイブであり、新聞記事（`article-newspaper`）に出典閲覧日（access-date）を付けるのは jawiki の慣例として不自然な場合があります。

---

## 4. セキュリティ・堅牢性・保守性の分析

1. **DOM 操作と XSS 耐性**:
   - `html.ts` の `decode` や `serialize.ts` の `escapeValue` は、ブラウザ DOMParser を介さず純粋な文字列処理で行われており、Service Worker 上でも安全に動作します。
   - `escapeValue` による `|` → `{{!}}`、`[` `]` → `&#91;` `&#93;` へのエスケープは、ウィキテキストの注入破壊を適切に防いでいます。
2. **レート制限**:
   - `createHttp` によるホスト別キュー・待機間隔の制御、429 / 503 時の Exponential Backoff が実装されており、Wikimedia API や各書誌 API への負荷配慮がなされています。
3. **外部書き込み防止**:
   - `CLAUDE.md` の重要原則である「ウィキペディアへの保存は絶対に自動化しない」「書き込み系 API は呼ばない」は全コードで厳格に遵守されています（`wiki-main.content.ts` でも挿入のみ行い、`wpSave` には一切触れていません）。

---

## 5. まとめと次のステップ（推奨事項）

本コードベースは、jawiki 特有の複雑な出典仕様（CS-ja と CS1 の混在、Whitelist 準拠、一節と Sfn の連動など）を極めて深く理解して設計されており、基本構造は非常に完成度が高いです。

次のステップとして、以下の順序での対応を推奨します：
1. **P0（即時修正推奨のバグ）**:
   - `findTemplates` の未閉じ `{{` での `break` を `continue` に変更
   - `capture` 内での `ChooseEntryError` の正常ハンドリング
   - `stripRole` の1文字役割語における空白必須化
   - `commitPeople` の `flat` 関数における `undefined` ガード
2. **P1（エッジケース・堅牢性向上）**:
   - `dates.ts` の `00` パディング日付（月日不明）の許容
   - `applyFills` のスペース二重化防止とタイトル角括弧エスケープ
   - `ClipboardList.vue` の `liveQuery` 購読解除 (`onUnmounted`)
3. **P2（仕様調整・実環境検証）**:
   - CS1 (2系) に対する SfnRef 付与ルールの見直し（CLAUDE.md の方針との統一）
   - 実ブラウザ（Chrome MV3）での動作確認および `action=parse` による出力検証
