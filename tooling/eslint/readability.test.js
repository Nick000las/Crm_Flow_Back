/** @file Verifica espaçamento de contextos, imports e estabilidade entre ESLint e Prettier. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { URL } from 'node:url';

import { Linter } from 'eslint';
import { format } from 'prettier';

import shared from '../../eslint.rules.js';

test('separa preparação, validação, execução e retorno sem criar ciclo com Prettier', async () => {
  const source = `import { z, a } from 'library';
export function run() {
  const input = read();
  if (!input) {
    throw new Error('Entrada inválida');
  }
  save(input);
  return input;
}`;
  const linter = new Linter();
  const result = linter.verifyAndFix(source, [shared]);

  assert.equal(result.messages.length, 0);
  assert.match(result.output, /import \{ a,\s*z \} from 'library'/);
  assert.ok(result.output.includes('const input = read();\n\n  if'));
  assert.ok(result.output.includes('  }\n\n  save(input);\n\n  return input;'));

  const prettierOptions = JSON.parse(
    await readFile(new URL('../../.prettierrc.json', import.meta.url), 'utf8'),
  );
  const formatted = await format(result.output, { ...prettierOptions, parser: 'babel' });
  const second = linter.verifyAndFix(formatted, [shared]);

  assert.equal(second.messages.length, 0);
  assert.equal(second.fixed, false);
  assert.equal(second.output, formatted);
});
