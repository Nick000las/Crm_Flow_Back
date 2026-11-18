/** @file Exercita o comando de correção: resolve chaves inline e mantém falhas não corrigíveis. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

const require = createRequire(import.meta.url);
const script = fileURLToPath(new URL('../format.js', import.meta.url));
const sharedURL = new URL('../../eslint.rules.js', import.meta.url).href;
const recommendedURL = pathToFileURL(require.resolve('@eslint/js')).href;

async function fixture(run) {
  const directory = await mkdtemp(path.join(tmpdir(), 'flow-format-'));

  try {
    await writeFile(
      path.join(directory, 'eslint.config.mjs'),
      `import shared from ${JSON.stringify(sharedURL)};\nimport js from ${JSON.stringify(recommendedURL)};\nexport default [js.configs.recommended, shared];\n`,
    );

    await writeFile(
      path.join(directory, '.prettierrc.json'),
      '{"singleQuote":true,"semi":true,"tabWidth":2}',
    );

    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('lint:fix conclui a formatação depois de adicionar chaves', async () => {
  await fixture(async (directory) => {
    await writeFile(
      path.join(directory, 'example.js'),
      'export function read(value) { if (!value) return null; return value; }',
    );

    const result = spawnSync(process.execPath, [script], { cwd: directory, encoding: 'utf8' });

    assert.equal(result.status, 0, result.stdout + result.stderr);

    assert.match(
      await readFile(path.join(directory, 'example.js'), 'utf8'),
      /if \(!value\) \{\n\s+return null;\n\s+\}/,
    );
  });
});

test('lint:fix continua falhando quando resta um erro de qualidade', async () => {
  await fixture(async (directory) => {
    await writeFile(path.join(directory, 'example.js'), 'missingFunction();');

    const result = spawnSync(process.execPath, [script], { cwd: directory, encoding: 'utf8' });

    assert.equal(result.status, 1);
    assert.match(result.stdout, /no-undef/);
  });
});
