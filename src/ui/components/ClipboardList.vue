<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { liveQuery } from 'dexie';
import { CdxButton, CdxField, CdxIcon, CdxMessage, CdxSearchInput, CdxTextArea, CdxTextInput, CdxToggleButtonGroup } from '@wikimedia/codex';
import { cdxIconAdd, cdxIconEdit, cdxIconQuotes, cdxIconTrash } from '@wikimedia/codex-icons';
import { applyOverrides } from '@/core/merge/merge';
import { inferPageKind, type Clip, type PageKind, type Passage } from '@/core/model/passage';
import { pick } from '@/core/model/record';
import { nameToString } from '@/core/transforms/names';
import { db, removeClip, type StoredRecord } from '@/db/dexie';
import { TYPE_LABELS } from '../labels';

const props = defineProps<{ focus?: { recordKey: string; passageId?: string } }>();
const emit = defineEmits<{ use: [stored: StoredRecord, passage?: Passage] }>();

interface Row {
  clip: Clip;
  stored?: StoredRecord;
  passages: Passage[];
}

const rows = ref<Row[]>([]);
const sub = liveQuery(async () => {
  const clips = await db.clips.orderBy('addedAt').reverse().toArray();
  const stored = await db.records.bulkGet(clips.map((c) => c.recordKey));
  const passages = await db.passages.toArray();
  return clips.map((clip, i) => ({
    clip,
    stored: stored[i],
    passages: passages.filter((p) => p.recordKey === clip.recordKey).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt)),
  }));
}).subscribe((v) => (rows.value = v));
defineExpose({ unsubscribe: () => sub.unsubscribe() });

const query = ref('');
const shown = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return rows.value;
  return rows.value.filter((r) => [summary(r).title, summary(r).people, r.clip.memo, ...r.passages.map((p) => p.text)].join(' ').toLowerCase().includes(q));
});

function summary(r: Row) {
  if (!r.stored) return { title: r.clip.recordKey, people: '', year: '', type: '' };
  const rec = applyOverrides(r.stored.record, r.stored.overrides);
  return {
    title: pick(rec.title) ?? r.clip.recordKey,
    people: rec.authors.slice(0, 3).map(nameToString).join('、') + (rec.authors.length > 3 ? ' ほか' : ''),
    year: rec.issued?.y ? String(rec.issued.y) : '',
    type: TYPE_LABELS[rec.type],
  };
}

/** 開いている文献（一節を追加・編集する対象） */
const open = ref<string | null>(null);
watch(
  () => props.focus,
  (f) => {
    if (f) open.value = f.recordKey;
  },
  { immediate: true },
);

const kindButtons = [
  { value: 'p', label: 'ページ' },
  { value: 'loc', label: '章・節など' },
  { value: 'koma', label: 'コマ' },
];

async function savePassage(p: Passage, patch: Partial<Passage>) {
  const next = { ...p, ...patch };
  if (patch.page !== undefined && next.pageKind !== 'koma' && next.pageKind !== 'loc') next.pageKind = next.page ? inferPageKind(next.page) : 'p';
  await db.passages.put(JSON.parse(JSON.stringify(next)));
}

const newText = ref('');
const newPage = ref('');
async function addPassage(recordKey: string) {
  if (!newText.value.trim()) return;
  await db.passages.put({
    id: crypto.randomUUID(),
    recordKey,
    text: newText.value.trim(),
    page: newPage.value.trim() || undefined,
    pageKind: newPage.value.trim() ? inferPageKind(newPage.value) : 'p',
    capturedAt: new Date().toISOString(),
  });
  newText.value = '';
  newPage.value = '';
}

async function saveMemo(r: Row, memo: string) {
  await db.clips.update(r.clip.recordKey, { memo: memo.trim() || undefined });
}
</script>

<template>
  <div class="cb-stack">
    <cdx-search-input v-model="query" placeholder="題名・著者・一節で絞り込む" />
    <cdx-message v-if="!rows.length" type="notice">
      出典クリップボードは空です。作成タブで取得した文献を保存するか、閲覧中のページで右クリック →「選択範囲を一節として保存」を使ってください。
    </cdx-message>
    <ul class="cb-list">
      <li v-for="r in shown" :key="r.clip.recordKey" class="cb-item" :class="{ 'cb-item--active': open === r.clip.recordKey }">
        <div class="cb-stack">
          <div class="cb-row">
            <div class="cb-grow">
              <strong>{{ summary(r).title }}</strong>
              <div class="cb-subtle">{{ [summary(r).type, summary(r).people, summary(r).year].filter(Boolean).join(' / ') }}</div>
            </div>
            <cdx-button weight="quiet" size="small" :aria-label="'一節を表示'" @click="open = open === r.clip.recordKey ? null : r.clip.recordKey">
              <cdx-icon :icon="cdxIconQuotes" /> {{ r.passages.length }}
            </cdx-button>
          </div>
          <div class="cb-row">
            <cdx-button v-if="r.stored" size="small" action="progressive" @click="emit('use', r.stored)">
              <cdx-icon :icon="cdxIconEdit" />出典を作る
            </cdx-button>
            <cdx-button size="small" weight="quiet" action="destructive" aria-label="削除" @click="removeClip(r.clip.recordKey)">
              <cdx-icon :icon="cdxIconTrash" />
            </cdx-button>
          </div>

          <div v-if="open === r.clip.recordKey" class="cb-stack">
            <cdx-field optional>
              <template #label>メモ（使う予定の記事など）</template>
              <cdx-text-input :model-value="r.clip.memo ?? ''" @change="(e: Event) => saveMemo(r, (e.target as HTMLInputElement).value)" />
            </cdx-field>
            <div v-for="p in r.passages" :key="p.id" class="cb-item" :class="{ 'cb-item--active': focus?.passageId === p.id }">
              <div class="cb-stack">
                <blockquote class="cb-quote">{{ p.text }}</blockquote>
                <div class="cb-row">
                  <cdx-text-input
                    class="cb-page"
                    :model-value="p.page ?? ''"
                    placeholder="ページ"
                    aria-label="ページ"
                    @change="(e: Event) => savePassage(p, { page: (e.target as HTMLInputElement).value.trim() || undefined })"
                  />
                  <cdx-toggle-button-group
                    :model-value="p.pageKind === 'pp' ? 'p' : p.pageKind"
                    :buttons="kindButtons"
                    @update:model-value="(v: unknown) => savePassage(p, { pageKind: v as PageKind })"
                  />
                </div>
                <div class="cb-row">
                  <cdx-button v-if="r.stored" size="small" action="progressive" @click="emit('use', r.stored, p)">この一節で出典を作る</cdx-button>
                  <cdx-button size="small" weight="quiet" action="destructive" aria-label="一節を削除" @click="db.passages.delete(p.id)">
                    <cdx-icon :icon="cdxIconTrash" />
                  </cdx-button>
                </div>
              </div>
            </div>
            <div class="cb-stack">
              <cdx-text-area v-model="newText" :rows="2" autosize placeholder="一節を貼り付け（PDF など右クリックで取れない場合）" />
              <div class="cb-row">
                <cdx-text-input v-model="newPage" class="cb-page" placeholder="ページ" aria-label="ページ" />
                <cdx-button size="small" :disabled="!newText.trim()" @click="addPassage(r.clip.recordKey)">
                  <cdx-icon :icon="cdxIconAdd" />一節を追加
                </cdx-button>
              </div>
            </div>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.cb-page {
  width: 7em;
  min-width: 0;
}
</style>
