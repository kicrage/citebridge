<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { CdxButton, CdxIcon, CdxInfoChip, CdxMessage, CdxTab, CdxTabs } from '@wikimedia/codex';
import { cdxIconDownload, cdxIconReload } from '@wikimedia/codex-icons';
import type { Passage } from '@/core/model/passage';
import type { CiteRecord } from '@/core/model/record';
import { db, type StoredRecord } from '@/db/dexie';
import { sendToBackground } from '@/lib/messages';
import { activeTab } from '@/lib/wiki-client';
import ArticleRefs from '@/ui/components/ArticleRefs.vue';
import CitationEditor from '@/ui/components/CitationEditor.vue';
import ClipboardList from '@/ui/components/ClipboardList.vue';
import IdInput from '@/ui/components/IdInput.vue';
import SettingsForm from '@/ui/components/SettingsForm.vue';
import { article, current, dismiss, notices, notify, refreshArticle } from '@/ui/store';

const tab = ref('create');
const errors = ref<{ source: string; message: string }[]>([]);
const focus = ref<{ recordKey: string; passageId?: string }>();

function onResolved(record: CiteRecord, errs: { source: string; message: string }[]) {
  current.record = record;
  current.passage = undefined;
  errors.value = errs;
}

function useStored(stored: StoredRecord, passage?: Passage) {
  // overrides は CitationEditor が DB から読み直すので、元のレコードを渡す
  current.record = stored.record;
  current.passage = passage;
  errors.value = stored.errors ?? [];
  tab.value = 'create';
}

const capturing = ref(false);
async function captureActive() {
  const t = await activeTab();
  if (!t?.id || !t.url) return;
  capturing.value = true;
  try {
    // サイドパネルのボタンでは activeTab が付かないので、そのサイトの読み取りを許可してもらう
    if (/^https?:/.test(t.url)) {
      const origin = `${new URL(t.url).origin}/*`;
      await browser.permissions.request({ origins: [origin] }).catch(() => false);
    }
    const r = await sendToBackground({ type: 'capture-tab', tabId: t.id, withSelection: true });
    if (!r.ok) throw new Error(r.error);
    const stored = await db.records.get(r.recordKey);
    if (stored) {
      const passage = r.passageId ? await db.passages.get(r.passageId) : undefined;
      useStored(stored, passage);
    }
    notify('閲覧中のページを出典クリップボードに取り込みました');
  } catch (e: any) {
    notify(String(e?.message ?? e), 'error');
  } finally {
    capturing.value = false;
  }
}

/** 右クリックやショートカットで取り込んだら、クリップボードを開いてページ番号の入力を促す */
const onStorage = (changes: Record<string, { newValue?: any }>, area: string) => {
  if (area !== 'local' || !changes.focus?.newValue) return;
  focus.value = changes.focus.newValue;
  tab.value = 'clipboard';
  if (changes.focus.newValue.passageId) notify('一節を保存しました。ページ番号を入力してください', 'notice');
};

const onTabChange = () => refreshArticle();
const onTabUpdated = (_id: number, info: { status?: string }) => {
  if (info.status === 'complete') refreshArticle();
};

onMounted(() => {
  refreshArticle();
  browser.storage.onChanged.addListener(onStorage);
  browser.tabs.onActivated.addListener(onTabChange);
  browser.tabs.onUpdated.addListener(onTabUpdated);
});
onUnmounted(() => {
  browser.storage.onChanged.removeListener(onStorage);
  browser.tabs.onActivated.removeListener(onTabChange);
  browser.tabs.onUpdated.removeListener(onTabUpdated);
});
</script>

<template>
  <div class="cb-app">
    <header class="cb-header cb-row">
      <strong class="cb-grow">Citebridge</strong>
      <cdx-info-chip v-if="article.status?.editing" status="success">編集中: {{ article.status.pageName }}</cdx-info-chip>
      <cdx-info-chip v-else-if="article.status?.visualEditor" status="warning">ビジュアルエディター（未対応）</cdx-info-chip>
      <cdx-info-chip v-else>編集画面なし</cdx-info-chip>
      <cdx-button weight="quiet" size="small" aria-label="編集画面の状態を更新" @click="refreshArticle"><cdx-icon :icon="cdxIconReload" /></cdx-button>
    </header>

    <div class="cb-notices">
      <cdx-message
        v-for="n in notices"
        :key="n.id"
        :type="n.type"
        allow-user-dismiss
        :auto-dismiss="n.type === 'success' ? 4000 : false"
        fade-in
        @user-dismissed="dismiss(n.id)"
        @auto-dismissed="dismiss(n.id)"
      >
        {{ n.text }}
      </cdx-message>
    </div>

    <cdx-tabs v-model:active="tab" framed>
      <cdx-tab name="create" label="作成">
        <div class="cb-pane cb-stack">
          <id-input @resolved="onResolved" />
          <div class="cb-row">
            <cdx-button weight="quiet" :disabled="capturing" @click="captureActive">
              <cdx-icon :icon="cdxIconDownload" />閲覧中のページから取り込む
            </cdx-button>
          </div>
          <citation-editor v-if="current.record" :record="current.record" :passage="current.passage" :source-errors="errors" />
        </div>
      </cdx-tab>
      <cdx-tab name="clipboard" label="クリップボード">
        <div class="cb-pane">
          <clipboard-list :focus="focus" @use="useStored" />
        </div>
      </cdx-tab>
      <cdx-tab name="article" label="記事の出典">
        <div class="cb-pane">
          <article-refs />
        </div>
      </cdx-tab>
      <cdx-tab name="settings" label="設定">
        <div class="cb-pane">
          <settings-form />
        </div>
      </cdx-tab>
    </cdx-tabs>
  </div>
</template>

<style scoped>
.cb-app {
  padding: var(--spacing-50);
}
.cb-header {
  padding: var(--spacing-25) var(--spacing-25) var(--spacing-50);
}
.cb-notices {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-25);
  margin-bottom: var(--spacing-50);
}
.cb-pane {
  padding: var(--spacing-75) var(--spacing-25);
}
</style>
