<script setup lang="ts">
import { ref } from 'vue';
import { CdxButton, CdxField, CdxIcon, CdxRadio, CdxTextInput, CdxToggleSwitch } from '@wikimedia/codex';
import { cdxIconDownload, cdxIconUpload } from '@wikimedia/codex-icons';
import { PROFILE_INFO } from '@/core/templates/profiles';
import { db, exportData, importData } from '@/db/dexie';
import { modeItems } from '../labels';
import { notify, settings } from '../store';

const familyItems = [
  { value: 'auto', label: '記事に合わせる（記事内で多い方）' },
  { value: 'ja', label: 'Cite ○○ ja に固定' },
  { value: '2', label: 'Cite ○○2 に固定' },
];
const layoutItems = [
  { value: 'auto', label: '記事に合わせる' },
  { value: 'inline', label: '横並び（1行）' },
  { value: 'block', label: '縦並び（引数ごとに改行）' },
];

async function doExport() {
  const data = await exportData();
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `citebridge-${data.exportedAt.slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

const fileInput = ref<HTMLInputElement>();
async function doImport(ev: Event) {
  const f = (ev.target as HTMLInputElement).files?.[0];
  if (!f) return;
  try {
    const n = await importData(JSON.parse(await f.text()));
    notify(`${n} 件の文献を読み込みました`);
  } catch (e: any) {
    notify(String(e?.message ?? e), 'error');
  }
  (ev.target as HTMLInputElement).value = '';
}

async function clearCache() {
  await db.raw.clear();
  notify('取得結果のキャッシュを消しました');
}
</script>

<template>
  <div class="cb-stack">
    <cdx-field is-fieldset>
      <template #label>テンプレートの系統</template>
      <cdx-radio v-for="i in familyItems" :key="i.value" v-model="settings.family" name="family" :input-value="i.value">{{ i.label }}</cdx-radio>
    </cdx-field>
    <cdx-field v-if="settings.family === 'auto'" is-fieldset>
      <template #label>記事に出典が無いとき</template>
      <cdx-radio v-model="settings.defaultFamily" name="defaultFamily" input-value="ja">Cite ○○ ja</cdx-radio>
      <cdx-radio v-model="settings.defaultFamily" name="defaultFamily" input-value="2">Cite ○○2</cdx-radio>
    </cdx-field>
    <cdx-field is-fieldset>
      <template #label>一節の使い方（既定）</template>
      <template #description>挿入するときに個別に変えられます</template>
      <cdx-radio v-for="i in modeItems" :key="i.value" v-model="settings.passageMode" name="mode" :input-value="i.value">{{ i.label }}</cdx-radio>
    </cdx-field>
    <cdx-field is-fieldset>
      <template #label>著者名</template>
      <cdx-radio v-model="settings.nameStyle" name="names" input-value="last-first">last= と first= に分ける</cdx-radio>
      <cdx-radio v-model="settings.nameStyle" name="names" input-value="author">author= に「姓 名」</cdx-radio>
    </cdx-field>
    <cdx-field is-fieldset>
      <template #label>日付</template>
      <cdx-radio v-model="settings.dateStyle" name="date" input-value="iso">2024-05-01</cdx-radio>
      <cdx-radio v-model="settings.dateStyle" name="date" input-value="ja">2024年5月1日</cdx-radio>
    </cdx-field>
    <cdx-field is-fieldset>
      <template #label>書式</template>
      <cdx-radio v-for="i in layoutItems" :key="i.value" v-model="settings.layout" name="layout" :input-value="i.value">{{ i.label }}</cdx-radio>
    </cdx-field>
    <cdx-field>
      <template #label>和文の本題と副題のつなぎ</template>
      <cdx-text-input v-model="settings.subtitleJoinJa" />
    </cdx-field>
    <cdx-toggle-switch v-model="settings.urlWithId">DOI・CRID などがあっても url= を書く</cdx-toggle-switch>
    <cdx-toggle-switch v-model="settings.accessDate">url= を書くときに access-date= を付ける</cdx-toggle-switch>
    <cdx-field optional>
      <template #label>連絡先メールアドレス（Crossref 用）</template>
      <template #description>Crossref の推奨に従い、問い合わせ先として API 要求に付けます。外部にはこれ以外の用途で送りません</template>
      <cdx-text-input v-model="settings.mailto" input-type="email" />
    </cdx-field>

    <h2 class="cb-section-title">データ</h2>
    <div class="cb-row">
      <cdx-button @click="doExport"><cdx-icon :icon="cdxIconDownload" />書き出す</cdx-button>
      <cdx-button @click="fileInput?.click()"><cdx-icon :icon="cdxIconUpload" />読み込む</cdx-button>
      <input ref="fileInput" type="file" accept="application/json" hidden @change="doImport" />
      <cdx-button weight="quiet" @click="clearCache">キャッシュを消す</cdx-button>
    </div>
    <p class="cb-subtle">
      テンプレート定義: {{ PROFILE_INFO.wiki }}（{{ PROFILE_INFO.generatedAt.slice(0, 10) }} 取得）。
      記事の保存は Citebridge では行いません。挿入後の差分確認と保存はご自身で行ってください。
    </p>
  </div>
</template>
