<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  CdxAccordion,
  CdxButton,
  CdxField,
  CdxIcon,
  CdxInfoChip,
  CdxMessage,
  CdxSelect,
  CdxTextArea,
  CdxTextInput,
  CdxToggleButtonGroup,
} from '@wikimedia/codex';
import { cdxIconAlert, cdxIconBookmark, cdxIconCopy, cdxIconReference } from '@wikimedia/codex-icons';
import { applyOverrides } from '@/core/merge/merge';
import type { Passage, PassageMode } from '@/core/model/passage';
import type { CiteRecord, SourceId } from '@/core/model/record';
import { pick } from '@/core/model/record';
import { generate } from '@/core/templates/generate';
import { listTemplates, type Family } from '@/core/templates/profiles';
import { wrapRef } from '@/core/templates/serialize';
import { validateCall } from '@/core/templates/validate';
import { nameToString } from '@/core/transforms/names';
import { parseTemplateAt } from '@/core/wikitext/template';
import { addClip, db } from '@/db/dexie';
import { wikiInsert } from '@/lib/wiki-client';
import { MODE_LABELS, SOURCE_LABELS, TYPE_LABELS, modeItems } from '../labels';
import { article, copyText, notify, settings } from '../store';
import RecordForm from './RecordForm.vue';

const props = defineProps<{
  record: CiteRecord;
  passage?: Passage;
  /** ポップアップ用の簡易表示 */
  compact?: boolean;
  sourceErrors?: { source: string; message: string }[];
}>();

const overrides = ref<Partial<CiteRecord>>({});
const familyChoice = ref<'auto' | Family>('auto');
const templateChoice = ref<string | null>(null);
const mode = ref<PassageMode>(settings.value.passageMode);
const refName = ref('');
/** 利用者が wikitext を直接書き換えたらその文字列（生成し直すまで保持） */
const manual = ref<string | null>(null);

watch(
  () => props.record.key,
  async (key) => {
    overrides.value = (await db.records.get(key))?.overrides ?? {};
    templateChoice.value = null;
    manual.value = null;
  },
  { immediate: true },
);
watch(() => settings.value.passageMode, (m) => (mode.value = m));

const effective = computed(() => applyOverrides(props.record, overrides.value));

async function patch(p: Partial<CiteRecord>) {
  overrides.value = { ...overrides.value, ...p };
  manual.value = null;
  const key = props.record.key;
  // 取得結果を保存していない（手入力など）場合も含めて保存
  const stored = await db.records.get(key);
  if (stored) await db.records.update(key, { overrides: JSON.parse(JSON.stringify(overrides.value)) });
  else await db.records.put({ key, record: props.record, overrides: JSON.parse(JSON.stringify(overrides.value)), updatedAt: new Date().toISOString() });
}

function resetOverrides() {
  overrides.value = {};
  manual.value = null;
  db.records.update(props.record.key, { overrides: undefined });
}

const family = computed<Family | undefined>(() => (familyChoice.value === 'auto' ? undefined : familyChoice.value));

const gen = computed(() =>
  generate(effective.value, {
    settings: settings.value,
    passage: props.passage,
    passageMode: mode.value,
    article: article.style,
    family: family.value,
    template: templateChoice.value ?? undefined,
    refName: refName.value.trim() || undefined,
  }),
);

/** 手で直した場合はそれを解析し直して検証する */
const out = computed(() => {
  const g = gen.value;
  if (manual.value === null) return { wikitext: g.wikitext, inline: g.inline, bibliography: g.bibliography, issues: g.issues };
  const text = manual.value.trim();
  const name = refName.value.trim() || undefined;
  const base = { wikitext: text, inline: g.sfn ?? wrapRef(text, name), bibliography: g.sfn ? `* ${text}` : undefined };
  const t = parseTemplateAt(text, 0);
  if (!t || t.end !== text.length) return { ...base, issues: [{ level: 'error' as const, message: 'テンプレートの {{ }} が対応していません' }] };
  const call = { template: t.name, params: t.params.filter((p) => p.named).map((p) => ({ name: p.name, value: p.value })) };
  return { ...base, issues: validateCall(call) };
});

const familyButtons = computed(() => [
  { value: 'auto', label: article.style?.family ? `記事に合わせる（${article.style.family === 'ja' ? 'ja' : '2'}）` : '自動' },
  { value: 'ja', label: 'Cite ○○ ja' },
  { value: '2', label: 'Cite ○○2' },
]);

const templateItems = computed(() =>
  listTemplates(gen.value.family)
    .map((t) => ({ value: t.name, label: t.name }))
    .sort((a, b) => a.label.localeCompare(b.label)),
);

function onTemplate(v: string | number | null) {
  templateChoice.value = v === gen.value.call.template && !templateChoice.value ? null : (v as string);
  manual.value = null;
}

function onFamily(v: unknown) {
  familyChoice.value = v as 'auto' | Family;
  templateChoice.value = null;
  manual.value = null;
}

const sources = computed(() => {
  const set = new Set<SourceId>(Object.values(effective.value.provenance) as SourceId[]);
  return [...set].map((s) => SOURCE_LABELS[s]).join('・');
});

/** 複数ソースで値が食い違った項目（クリックでその値を採用） */
const conflicts = computed(() =>
  (props.record.conflicts ?? []).filter((c) => !(c.field in overrides.value)).map((c) => ({
    field: c.field,
    options: c.values.map((v) => ({ source: SOURCE_LABELS[v.source], value: v.value, text: describe(v.value) })),
  })),
);

function describe(v: unknown): string {
  if (Array.isArray(v)) return v.map((n) => nameToString(n)).join('、');
  if (v && typeof v === 'object' && 'raw' in (v as object)) return (v as { raw: string }).raw;
  if (v && typeof v === 'object') return pick(v as Record<string, string>) ?? '';
  return String(v ?? '');
}

const FIELD_LABELS: Record<string, string> = {
  title: '題名',
  authors: '著者',
  publisher: '出版者',
  issued: '発行日',
  volume: '巻',
  issue: '号',
  pages: 'ページ',
  container: '収録誌',
  place: '出版地',
  edition: '版',
  series: 'シリーズ',
};

const canInsert = computed(() => !!article.status?.editing);
const errorCount = computed(() => out.value.issues.filter((i) => i.level === 'error').length);

async function insert() {
  try {
    if (mode.value === 'sfn' && out.value.bibliography) {
      const dedupe = [gen.value.call.params.find((p) => p.name === 'ref')?.value, effective.value.ids.doi, effective.value.ids.isbn, out.value.wikitext].filter(
        (x): x is string => !!x,
      );
      const r = await wikiInsert(out.value.inline, { line: out.value.bibliography, dedupe });
      if (r.bibliography === 'inserted') notify('Sfn を挿入し、参考文献節に追記しました');
      else if (r.bibliography === 'exists') notify('Sfn を挿入しました（参考文献節には既にあります）');
      else notify('Sfn を挿入しました。参考文献節が見つからないので、本体は「本体をコピー」で貼り付けてください', 'warning');
    } else {
      await wikiInsert(out.value.inline);
      notify('編集画面に挿入しました（保存はご自身で行ってください）');
    }
  } catch (e: any) {
    notify(String(e?.message ?? e), 'error');
  }
}

async function clip() {
  await patch({});
  await addClip(props.record.key);
  notify('出典クリップボードに保存しました');
}
</script>

<template>
  <div class="cb-stack">
    <div class="cb-row">
      <cdx-info-chip>{{ TYPE_LABELS[effective.type] }}</cdx-info-chip>
      <span class="cb-subtle">取得元: {{ sources || '—' }}</span>
    </div>

    <cdx-message v-if="sourceErrors?.length && !compact" type="warning" inline>
      一部のソースから取得できませんでした: {{ sourceErrors.map((e) => e.source).join('、') }}
    </cdx-message>

    <cdx-message v-if="conflicts.length && !compact" type="warning">
      <div class="cb-stack">
        <span>ソースによって値が違う項目があります。使う値を選べます。</span>
        <div v-for="c in conflicts" :key="c.field" class="cb-row">
          <strong>{{ FIELD_LABELS[c.field] ?? c.field }}</strong>
          <cdx-button v-for="o in c.options" :key="o.source" size="small" @click="patch({ [c.field]: o.value })">
            {{ o.text }}（{{ o.source }}）
          </cdx-button>
        </div>
      </div>
    </cdx-message>

    <cdx-field v-if="!compact" is-fieldset>
      <template #label>テンプレートの系統</template>
      <cdx-toggle-button-group :model-value="familyChoice" :buttons="familyButtons" @update:model-value="onFamily" />
    </cdx-field>

    <div class="cb-row">
      <cdx-field class="cb-grow">
        <template #label>テンプレート</template>
        <cdx-select :selected="gen.call.template" :menu-items="templateItems" @update:selected="onTemplate" />
      </cdx-field>
      <cdx-field v-if="passage" class="cb-grow">
        <template #label>一節の使い方</template>
        <cdx-select v-model:selected="mode" :menu-items="modeItems" :default-label="MODE_LABELS[mode]" />
      </cdx-field>
    </div>

    <cdx-message v-if="passage" type="notice" inline>
      一節: 「{{ passage.text.length > 40 ? passage.text.slice(0, 40) + '…' : passage.text }}」
      {{ passage.page ? `（${passage.pageKind === 'koma' ? 'コマ' : 'p.'} ${passage.page}）` : '（ページ未入力）' }}
    </cdx-message>

    <cdx-accordion v-if="!compact">
      <template #title>書誌情報を直す</template>
      <div class="cb-stack">
        <record-form :record="effective" @patch="patch" />
        <div class="cb-row">
          <cdx-button weight="quiet" :disabled="!Object.keys(overrides).length" @click="resetOverrides">取得した値に戻す</cdx-button>
        </div>
      </div>
    </cdx-accordion>

    <cdx-field>
      <template #label>ウィキテキスト</template>
      <template #description>直接書き換えることもできます</template>
      <cdx-text-area
        class="cb-code"
        :model-value="out.wikitext"
        autosize
        :rows="compact ? 4 : 6"
        @update:model-value="(v: string) => (manual = v)"
      />
    </cdx-field>
    <div v-if="manual !== null" class="cb-row">
      <span class="cb-subtle">手で編集中です。書誌情報やテンプレートを変えると生成し直します。</span>
      <cdx-button size="small" weight="quiet" @click="manual = null">生成し直す</cdx-button>
    </div>

    <cdx-message v-if="gen.dropped.length && manual === null" type="notice" inline>
      {{ gen.call.template }} で使えないため省いた引数: {{ gen.dropped.map((p) => p.name).join('、') }}
    </cdx-message>
    <ul v-if="out.issues.length" class="cb-list">
      <li v-for="(i, n) in out.issues" :key="n" class="cb-row">
        <cdx-icon :icon="cdxIconAlert" size="small" :class="i.level === 'error' ? 'cb-error' : 'cb-warning'" />
        <span>{{ i.message }}</span>
      </li>
    </ul>

    <cdx-field v-if="!compact && mode !== 'sfn'" optional>
      <template #label>ref name</template>
      <cdx-text-input v-model="refName" placeholder="同じ出典を何度も使うとき" />
    </cdx-field>

    <div v-if="mode === 'sfn' && out.bibliography" class="cb-stack">
      <span class="cb-subtle">本文に入るもの</span>
      <code class="cb-mono">{{ out.inline }}</code>
    </div>

    <div class="cb-row">
      <cdx-button action="progressive" weight="primary" :disabled="!canInsert" @click="insert">
        <cdx-icon :icon="cdxIconReference" />編集画面に挿入
      </cdx-button>
      <cdx-button @click="copyText(out.inline)"><cdx-icon :icon="cdxIconCopy" />コピー</cdx-button>
      <cdx-button v-if="mode === 'sfn'" @click="copyText(out.wikitext)">本体をコピー</cdx-button>
      <cdx-button v-if="!compact" weight="quiet" @click="clip"><cdx-icon :icon="cdxIconBookmark" />クリップボードに保存</cdx-button>
    </div>
    <span v-if="!canInsert" class="cb-subtle">
      {{ article.status?.visualEditor ? 'ビジュアルエディターには未対応です。ソース編集に切り替えてください。' : '挿入するには、アクティブなタブでウィキペディアのソース編集画面を開いてください。' }}
    </span>
    <span v-else-if="errorCount" class="cb-subtle">エラーが {{ errorCount }} 件あります。このまま挿入すると記事にエラー表示が出ます。</span>
  </div>
</template>

<style scoped>
.cb-error {
  color: var(--color-icon-error);
}
.cb-warning {
  color: var(--color-icon-warning);
}
</style>
