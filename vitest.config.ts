import { defineConfig } from 'vitest/config';

// core/ は拡張 API に依存しない純粋関数なので、WXT のテスト用プラグインは使わずに素の Node 環境で走らせる
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: true,
  },
});
