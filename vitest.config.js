import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Espelha o campo `imports` do package.json para o resolver do Vite. */
const alias = {
  '#api': fileURLToPath(new URL('./src/api', import.meta.url)),
  '#core': fileURLToPath(new URL('./src/core', import.meta.url)),
  '#shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
  '#modules': fileURLToPath(new URL('./src/modules', import.meta.url)),
};

export default defineConfig({
  resolve: { alias },
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
    // Testes de RLS e isolamento tocam o banco real — rodam em série.
    fileParallelism: false,
  },
});
