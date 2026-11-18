/**
 * @file Aplica Prettier e autofix ESLint e valida o resultado final, sem ocultar erros restantes.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

import { ESLint } from 'eslint';

const require = createRequire(import.meta.url);
const prettierPackagePath = require.resolve('prettier/package.json');
const prettierPackage = require(prettierPackagePath);
const prettierBin =
  typeof prettierPackage.bin === 'string' ? prettierPackage.bin : prettierPackage.bin.prettier;
const prettierCLI = path.resolve(path.dirname(prettierPackagePath), prettierBin);

function formatFiles() {
  const result = spawnSync(process.execPath, [prettierCLI, '--write', '.'], { stdio: 'inherit' });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

formatFiles();

const autofix = new ESLint({ fix: true });

await ESLint.outputFixes(await autofix.lintFiles(['.']));

// Chaves adicionadas pelo ESLint precisam passar pelo Prettier antes do lint final.
formatFiles();

const eslint = new ESLint();
const results = await eslint.lintFiles(['.']);
const formatter = await eslint.loadFormatter('stylish');
const output = formatter.format(results);

if (output) {
  process.stdout.write(output);
}

process.exitCode = results.some((result) => result.errorCount || result.warningCount) ? 1 : 0;
