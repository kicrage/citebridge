<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { CdxButton, CdxIcon, CdxMessage } from '@wikimedia/codex';
import { cdxIconWindow } from '@wikimedia/codex-icons';
import type { CiteRecord } from '@/core/model/record';
import CitationEditor from '@/ui/components/CitationEditor.vue';
import IdInput from '@/ui/components/IdInput.vue';
import { dismiss, notices, refreshArticle } from '@/ui/store';

const record = ref<CiteRecord>();
const errors = ref<{ source: string; message: string }[]>([]);

function onResolved(r: CiteRecord, e: { source: string; message: string }[]) {
  record.value = r;
  errors.value = e;
}

async function openPanel() {
  const w = await browser.windows.getCurrent();
  if (w.id !== undefined) await browser.sidePanel.open({ windowId: w.id });
  window.close();
}

onMounted(refreshArticle);
</script>

<template>
  <div class="cb-popup cb-stack">
    <div class="cb-row">
      <strong class="cb-grow">Citebridge</strong>
      <cdx-button weight="quiet" size="small" @click="openPanel"><cdx-icon :icon="cdxIconWindow" />サイドパネル</cdx-button>
    </div>
    <cdx-message v-for="n in notices" :key="n.id" :type="n.type" allow-user-dismiss @user-dismissed="dismiss(n.id)">{{ n.text }}</cdx-message>
    <id-input @resolved="onResolved" />
    <citation-editor v-if="record" :record="record" :source-errors="errors" compact />
  </div>
</template>

<style scoped>
.cb-popup {
  width: 420px;
  padding: var(--spacing-75);
}
</style>
