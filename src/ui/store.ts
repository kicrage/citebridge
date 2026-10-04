import { reactive, ref, watch } from 'vue';
import type { CiteRecord } from '@/core/model/record';
import type { Passage } from '@/core/model/passage';
import { DEFAULT_SETTINGS, type Settings } from '@/core/settings';
import { detectStyle, type ArticleStyle } from '@/core/wikitext/refs';
import type { WikiStatus } from '@/lib/messages';
import { loadSettings, onSettingsChanged, saveSettings } from '@/lib/settings';
import { wikiGetText, wikiStatus } from '@/lib/wiki-client';

export const settings = ref<Settings>({ ...DEFAULT_SETTINGS });
let loaded = false;

export async function initSettings() {
  settings.value = await loadSettings();
  loaded = true;
  onSettingsChanged((s) => {
    if (JSON.stringify(s) !== JSON.stringify(settings.value)) settings.value = s;
  });
}

watch(
  settings,
  (s) => {
    if (loaded) saveSettings(JSON.parse(JSON.stringify(s)));
  },
  { deep: true },
);

/** 挿入先（アクティブなタブの編集画面）の状態 */
export const article = reactive<{ status?: WikiStatus; style?: ArticleStyle; checkedAt?: number }>({});

export async function refreshArticle(): Promise<void> {
  article.status = await wikiStatus();
  article.style = undefined;
  if (article.status?.editing) {
    try {
      article.style = detectStyle(await wikiGetText());
    } catch {
      /* 読めなくても挿入はできる */
    }
  }
  article.checkedAt = Date.now();
}

/** 作成タブで編集中のもの */
export const current = reactive<{ record?: CiteRecord; passage?: Passage }>({});

export interface Notice {
  id: number;
  type: 'notice' | 'success' | 'warning' | 'error';
  text: string;
}

export const notices = ref<Notice[]>([]);
let nid = 0;

export function notify(text: string, type: Notice['type'] = 'success') {
  notices.value.push({ id: ++nid, type, text });
}

export function dismiss(id: number) {
  notices.value = notices.value.filter((n) => n.id !== id);
}

export async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
  notify('クリップボードにコピーしました');
}
