<script setup lang="ts">
import { computed, ref } from 'vue';
import { CdxButton, CdxCheckbox, CdxIcon, CdxInfoChip, CdxMessage, CdxProgressBar } from '@wikimedia/codex';
import { cdxIconArticleSearch, cdxIconNext, cdxIconReload } from '@wikimedia/codex-icons';
import { mapRecord } from '@/core/templates/mapper';
import { getTemplate } from '@/core/templates/profiles';
import { validateCall, type Issue } from '@/core/templates/validate';
import {
  applyFills,
  citeFamily,
  duplicateRefs,
  existingParams,
  fillSuggestions,
  findAllCites,
  findRefs,
  lookupIdOf,
  relocate,
  type FillSuggestion,
} from '@/core/wikitext/refs';
import type { ParsedTemplate } from '@/core/wikitext/template';
import { sendToBackground } from '@/lib/messages';
import { wikiGetText, wikiSelect, wikiSetText } from '@/lib/wiki-client';
import { article, notify, refreshArticle, settings } from '../store';

interface Entry {
  t: ParsedTemplate;
  family: ReturnType<typeof citeFamily>;
  title: string;
  issues: Issue[];
  /** 補完候補（調べた後） */
  fills?: (FillSuggestion & { on: boolean })[];
  busy?: boolean;
  note?: string;
}

const loading = ref(false);
const error = ref('');
const entries = ref<Entry[]>([]);
const dupCount = ref(0);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    await refreshArticle();
    const text = await wikiGetText();
    entries.value = findAllCites(text).map((t) => {
      const family = citeFamily(t.name);
      const ex = existingParams(t);
      const issues =
        family === 'legacy'
          ? []
          : validateCall({ template: t.name, params: t.params.filter((p) => p.named).map((p) => ({ name: p.name, value: p.value })) });
      return { t, family, title: ex.get('title')?.value || ex.get('chapter')?.value || '（題名なし）', issues };
    });
    dupCount.value = duplicateRefs(findRefs(text)).length;
  } catch (e: any) {
    error.value = String(e?.message ?? e);
    entries.value = [];
  } finally {
    loading.value = false;
  }
}

const counts = computed(() => article.style?.counts);

async function jump(e: Entry) {
  try {
    const t = relocate(await wikiGetText(), e.t);
    if (!t) throw new Error('記事が編集されたため場所が分かりません。読み込み直してください');
    await wikiSelect(t.start, t.end);
  } catch (err: any) {
    notify(String(err?.message ?? err), 'error');
  }
}

/** 識別子から書誌を引き直し、空欄・未記入の引数だけを候補にする（既存の値は変えない） */
async function suggest(e: Entry) {
  const id = lookupIdOf(e.t);
  if (!id) {
    e.note = 'DOI・ISBN・CRID などの識別子が無いため調べられません';
    return;
  }
  e.busy = true;
  e.note = undefined;
  try {
    const res = await sendToBackground({ type: 'resolve', input: id.value, id });
    if (!res.ok) throw new Error(res.error);
    if (!('record' in res)) throw new Error('識別子を特定できませんでした');
    const tpl = getTemplate(e.t.name) ? e.t.name : undefined;
    const m = mapRecord(res.record, { family: e.family === '2' ? '2' : 'ja', template: tpl, settings: settings.value, passageMode: 'pages' });
    const fills = fillSuggestions(e.t, m.call.params.filter((p) => p.name !== 'access-date'));
    e.fills = fills.map((f) => ({ ...f, on: true }));
    if (!fills.length) e.note = '補える項目はありません';
  } catch (err: any) {
    e.note = String(err?.message ?? err);
  } finally {
    e.busy = false;
  }
}

async function apply(e: Entry) {
  const chosen = (e.fills ?? []).filter((f) => f.on);
  if (!chosen.length) return;
  try {
    const text = await wikiGetText();
    const t = relocate(text, e.t);
    if (!t) throw new Error('記事が編集されたため場所が分かりません。読み込み直してください');
    const next = applyFills(text, t, chosen);
    const after = next.length - text.length;
    await wikiSetText(next, t.start, t.end + after);
    notify(`${chosen.length} 項目を補いました（差分を確認してから保存してください）`);
    await load();
  } catch (err: any) {
    notify(String(err?.message ?? err), 'error');
  }
}

const familyLabel = (f: Entry['family']) => (f === 'ja' ? 'ja' : f === '2' ? '2' : '旧');
</script>

<template>
  <div class="cb-stack">
    <div class="cb-row">
      <cdx-button action="progressive" :disabled="loading" @click="load">
        <cdx-icon :icon="entries.length ? cdxIconReload : cdxIconArticleSearch" />記事の出典を読み込む
      </cdx-button>
    </div>
    <cdx-progress-bar v-if="loading" inline aria-label="読み込み中" />
    <cdx-message v-if="error" type="error" inline>{{ error }}</cdx-message>
    <div v-if="counts && entries.length" class="cb-subtle">
      Cite ○○ ja: {{ counts.ja }} / Cite ○○2: {{ counts['2'] }} / 旧来の Cite ○○: {{ counts.legacy }}
      <template v-if="article.style?.family">（新しい出典は {{ article.style.family === 'ja' ? 'ja 系' : '2 系' }} で作ります）</template>
    </div>
    <cdx-message v-if="dupCount" type="notice" inline>
      同じ文献・同じページを指す &lt;ref&gt; が {{ dupCount }} 組あります。&lt;ref name&gt; でまとめられます。
    </cdx-message>

    <ul class="cb-list">
      <li v-for="(e, i) in entries" :key="i + ':' + e.t.start" class="cb-item">
        <div class="cb-stack">
          <div class="cb-row">
            <cdx-info-chip :status="e.issues.some((x) => x.level === 'error') ? 'error' : e.issues.length ? 'warning' : 'notice'">
              {{ familyLabel(e.family) }}
            </cdx-info-chip>
            <span class="cb-grow">{{ e.title }}</span>
            <cdx-button weight="quiet" size="small" aria-label="編集画面で表示" @click="jump(e)"><cdx-icon :icon="cdxIconNext" /></cdx-button>
          </div>
          <div class="cb-subtle cb-mono">{{ e.t.name }}</div>
          <ul v-if="e.issues.length" class="cb-list cb-subtle">
            <li v-for="(x, n) in e.issues" :key="n">{{ x.level === 'error' ? 'エラー' : '注意' }}: {{ x.message }}</li>
          </ul>
          <div v-if="e.family !== 'legacy'" class="cb-row">
            <cdx-button size="small" :disabled="e.busy" @click="suggest(e)">空欄を補う候補を調べる</cdx-button>
          </div>
          <cdx-progress-bar v-if="e.busy" inline aria-label="取得中" />
          <span v-if="e.note" class="cb-subtle">{{ e.note }}</span>
          <div v-if="e.fills?.length" class="cb-stack">
            <cdx-checkbox v-for="f in e.fills" :key="f.param.name" v-model="f.on">
              <span class="cb-mono">{{ f.param.name }}={{ f.param.value }}</span>
              <template #description>{{ f.kind === 'empty' ? '空欄に記入' : '引数を追加' }}</template>
            </cdx-checkbox>
            <div class="cb-row">
              <cdx-button size="small" action="progressive" weight="primary" @click="apply(e)">選んだ項目を記事に反映</cdx-button>
            </div>
          </div>
        </div>
      </li>
    </ul>
    <cdx-message v-if="!loading && !entries.length && !error" type="notice" inline>
      ソース編集画面を開いた状態で「記事の出典を読み込む」を押すと、記事内の出典テンプレートを一覧し、エラーや空欄を確認できます。既存の値は書き換えません。
    </cdx-message>
  </div>
</template>
