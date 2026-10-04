<script setup lang="ts">
import { ref } from 'vue';
import { CdxButton, CdxField, CdxMessage, CdxProgressBar, CdxTextInput } from '@wikimedia/codex';
import { cdxIconSearch } from '@wikimedia/codex-icons';
import type { DetectedId } from '@/core/ids/types';
import { ID_LABELS } from '@/core/ids/types';
import type { CiteRecord } from '@/core/model/record';
import { sendToBackground } from '@/lib/messages';

const emit = defineEmits<{ resolved: [record: CiteRecord, errors: { source: string; message: string }[]] }>();

const input = ref('');
const busy = ref(false);
const error = ref('');
const candidates = ref<DetectedId[]>([]);

async function run(id?: DetectedId, bypassCache = false) {
  if (!input.value.trim()) return;
  busy.value = true;
  error.value = '';
  if (!id) candidates.value = [];
  try {
    const res = await sendToBackground({ type: 'resolve', input: input.value, id, bypassCache });
    if (!res.ok) error.value = res.error;
    else if ('candidates' in res) candidates.value = res.candidates;
    else {
      candidates.value = [];
      emit('resolved', res.record, res.errors);
    }
  } catch (e: any) {
    error.value = String(e?.message ?? e);
  } finally {
    busy.value = false;
  }
}

defineExpose({ run, input });
</script>

<template>
  <form class="cb-stack" @submit.prevent="run()">
    <cdx-field>
      <template #label>識別子または URL</template>
      <template #description>DOI・CRID・NAID・NCID・NDL書誌ID・全国書誌番号・ISBN・NDLデジタルコレクション・新聞記事文庫・URL</template>
      <div class="cb-row">
        <cdx-text-input
          v-model="input"
          class="cb-grow"
          :start-icon="cdxIconSearch"
          clearable
          placeholder="例: 10.20645/00000025"
          :disabled="busy"
        />
        <cdx-button action="progressive" weight="primary" type="submit" :disabled="busy || !input.trim()">取得</cdx-button>
      </div>
    </cdx-field>
    <cdx-progress-bar v-if="busy" inline aria-label="取得中" />
    <cdx-message v-if="error" type="error" inline>{{ error }}</cdx-message>
    <div v-if="candidates.length" class="cb-stack">
      <cdx-message type="notice" inline>どの識別子として調べますか？</cdx-message>
      <div class="cb-row">
        <cdx-button v-for="c in candidates" :key="c.type" @click="run(c)">{{ ID_LABELS[c.type] }}</cdx-button>
      </div>
    </div>
  </form>
</template>
