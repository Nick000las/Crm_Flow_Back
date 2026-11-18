/** @file Verifica formatação SQL sem alterar parâmetros, literais ou expressões JavaScript. */
import assert from 'node:assert/strict';
import { describe, it, test } from 'node:test';

import { Linter, RuleTester } from 'eslint';

import sqlFormat from './sql-format.js';

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2023, sourceType: 'module' } });

tester.run('sql-format', sqlFormat, {
  valid: [
    'const fragment = Prisma.sql`AND id = ${id}::uuid`;',
    'const ordinary = `SELECT * FROM cards`;',
    'const q = tx.$queryRaw`\n  SELECT\n    id\n  FROM\n    cards\n  WHERE\n    id = ${id}::uuid\n`;',
  ],
  invalid: [
    {
      code: 'const q = tx.$queryRaw`select id from cards where id=${id}::uuid`;',
      output:
        'const q = tx.$queryRaw`\n  SELECT\n    id\n  FROM\n    cards\n  WHERE\n    id = ${id}::uuid\n`;',
      errors: [{ messageId: 'format' }],
    },
  ],
});

test('autofix preserva expressões, parâmetros repetidos e espaços significativos em literais', () => {
  const linter = new Linter();
  const code =
    "const q = tx.$queryRaw`select 'O''Brien  $9876540' as nome from cards where id=${values['$&']}::uuid and tenant_id=${tenantId}::uuid and owner_id=${tenantId}::uuid`;";
  const config = [
    { plugins: { project: { rules: { sql: sqlFormat } } }, rules: { 'project/sql': 'error' } },
  ];
  const result = linter.verifyAndFix(code, config);

  assert.equal(result.messages.length, 0);
  assert.ok(result.output.includes("'O''Brien  $9876540'"));
  assert.ok(result.output.includes("${values['$&']}::uuid"));
  assert.equal(result.output.match(/\$\{tenantId\}/g).length, 2);
  assert.ok(!result.output.includes('$98765490'));

  const second = linter.verifyAndFix(result.output, config);

  assert.equal(second.fixed, false);
  assert.equal(second.output, result.output);
});
