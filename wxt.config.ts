import { defineConfig } from 'wxt';

/** メタデータ取得に使う API のホスト（host_permissions は使うものだけに絞る） */
const API_HOSTS = [
  'https://doi.org/*',
  'https://api.crossref.org/*',
  'https://api.japanlinkcenter.org/*',
  'https://cir.nii.ac.jp/*',
  'https://ndlsearch.ndl.go.jp/*',
  'https://dl.ndl.go.jp/*',
  'https://hdl.handle.net/*',
  'https://da.lib.kobe-u.ac.jp/*',
  // Citoid（REST API）と編集画面への挿入
  'https://*.wikipedia.org/*',
];

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: 'Citebridge',
    description: 'DOI・CRID・NDL書誌ID・ISBN などから Cite ○○ ja / Cite ○○2 の出典テンプレートを作り、編集画面に挿入します',
    permissions: ['storage', 'sidePanel', 'contextMenus', 'activeTab', 'scripting', 'clipboardWrite'],
    host_permissions: API_HOSTS,
    // 任意 URL の meta 取得は利用者が許可したときだけ
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    action: { default_title: 'Citebridge' },
    commands: {
      'save-passage': {
        suggested_key: { default: 'Alt+Shift+Q' },
        description: '選択範囲を一節として保存',
      },
    },
  },
});
