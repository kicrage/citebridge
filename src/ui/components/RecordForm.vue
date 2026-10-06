<script setup lang="ts">
import { reactive, watch } from 'vue';
import { CdxField, CdxSelect, CdxTextArea, CdxTextInput } from '@wikimedia/codex';
import type { CiteRecord, Multilingual, Name, WorkType } from '@/core/model/record';
import { pick } from '@/core/model/record';
import { formatDate, parseDate } from '@/core/transforms/dates';
import { parseName } from '@/core/transforms/names';
import { TYPE_LABELS } from '../labels';

/** 表示中のレコード（overrides 適用済み） */
const props = defineProps<{ record: CiteRecord }>();
/** 変更した項目だけを返す（親が overrides に重ねる） */
const emit = defineEmits<{ patch: [patch: Partial<CiteRecord>] }>();

const typeItems = (Object.keys(TYPE_LABELS) as WorkType[]).map((value) => ({ value, label: TYPE_LABELS[value] }));

type MultiField = 'title' | 'subtitle' | 'container';
type PeopleField = 'authors' | 'editors' | 'translators';
type PlainField = 'volume' | 'issue' | 'pages' | 'publisher' | 'place' | 'edition' | 'series' | 'url' | 'language' | 'volumeTitle' | 'degree';

const PLAIN: [PlainField, string][] = [
  ['volume', '巻'],
  ['issue', '号'],
  ['pages', '掲載ページ'],
  ['publisher', '出版者'],
  ['place', '出版地'],
  ['edition', '版'],
  ['series', 'シリーズ'],
  ['url', 'URL'],
  ['language', '言語（ja / en など）'],
  ['volumeTitle', '巻の書名（ja 系のみ）'],
  ['degree', '学位'],
];

const showPeople = (list: Name[]) =>
  list.map((n) => (n.literal ? n.literal : n.given ? `${n.family}, ${n.given}` : (n.family ?? ''))).join('\n');

/** 入力中は下書きを編集し、フォーカスが外れたら確定する（1文字ごとの再解析で入力が崩れないように） */
const draft = reactive<Record<string, string>>({});

function reset() {
  const r = props.record;
  for (const f of ['title', 'subtitle', 'container'] as MultiField[]) draft[f] = pick(r[f]) ?? '';
  for (const f of ['authors', 'editors', 'translators'] as PeopleField[]) draft[f] = showPeople(r[f]);
  for (const [f] of PLAIN) draft[f] = r[f] ?? '';
  draft.date = (r.issued?.y ? formatDate(r.issued) : r.issued?.raw) ?? '';
}
watch(() => props.record, reset, { immediate: true });

function langKey(m: Multilingual | undefined): string {
  const v = pick(m);
  return (m && Object.keys(m).find((k) => m[k] === v)) ?? 'ja';
}

function commitMulti(f: MultiField) {
  const v = draft[f].trim();
  if (v === (pick(props.record[f]) ?? '')) return;
  const m = { ...props.record[f] };
  if (v) m[langKey(m)] = v;
  else delete m[langKey(m)];
  emit('patch', { [f]: m });
}

function commitPeople(f: PeopleField) {
  if (draft[f] === showPeople(props.record[f])) return;
  const prev = props.record[f];
  const flat = (n: Name) => n.literal ?? `${n.family}${n.given}`;
  const list = draft[f]
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l): Name => {
      const n = parseName(l).name;
      const yomi = prev.find((x) => x.yomi && flat(x) === flat(n))?.yomi;
      return yomi ? { ...n, yomi } : n;
    });
  emit('patch', { [f]: list });
}

function commitPlain(f: PlainField) {
  const v = draft[f].trim();
  if (v !== (props.record[f] ?? '')) emit('patch', { [f]: v || undefined });
}

function commitDate() {
  const cur = (props.record.issued?.y ? formatDate(props.record.issued) : props.record.issued?.raw) ?? '';
  if (draft.date.trim() !== cur) emit('patch', { issued: parseDate(draft.date) });
}

function onType(v: string | number | null) {
  if (v && v !== props.record.type) emit('patch', { type: v as WorkType });
}
</script>

<template>
  <div class="cb-stack">
    <cdx-field>
      <template #label>資料種別</template>
      <cdx-select :selected="record.type" :menu-items="typeItems" @update:selected="onType" />
    </cdx-field>
    <cdx-field>
      <template #label>題名</template>
      <cdx-text-input v-model="draft.title" @blur="commitMulti('title')" />
    </cdx-field>
    <cdx-field optional>
      <template #label>副題</template>
      <cdx-text-input v-model="draft.subtitle" @blur="commitMulti('subtitle')" />
    </cdx-field>
    <cdx-field optional>
      <template #label>収録誌・収録書</template>
      <cdx-text-input v-model="draft.container" @blur="commitMulti('container')" />
    </cdx-field>
    <cdx-field>
      <template #label>著者</template>
      <template #description>1行に1人。「姓, 名」で姓と名を分けます。団体名や分けない名前はそのまま</template>
      <cdx-text-area v-model="draft.authors" autosize :rows="2" @blur="commitPeople('authors')" />
    </cdx-field>
    <cdx-field optional>
      <template #label>編者</template>
      <cdx-text-area v-model="draft.editors" autosize :rows="1" @blur="commitPeople('editors')" />
    </cdx-field>
    <cdx-field optional>
      <template #label>訳者</template>
      <cdx-text-area v-model="draft.translators" autosize :rows="1" @blur="commitPeople('translators')" />
    </cdx-field>
    <cdx-field>
      <template #label>発行日</template>
      <template #description>1990-04、1990年4月、昭和12年5月 などで入力できます</template>
      <cdx-text-input v-model="draft.date" @blur="commitDate" />
    </cdx-field>
    <cdx-field v-for="[f, label] in PLAIN" :key="f" optional>
      <template #label>{{ label }}</template>
      <cdx-text-input v-model="draft[f]" @blur="commitPlain(f)" />
    </cdx-field>
  </div>
</template>
