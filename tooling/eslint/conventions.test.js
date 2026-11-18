/** @file Verifica documentação de finalidade e posicionamento de imports com o parser real. */
import { describe, it } from 'node:test';

import { RuleTester } from 'eslint';

import filePurpose from './file-purpose.js';
import importsFirst from './imports-first.js';

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2023, sourceType: 'module' } });

tester.run('file-purpose', filePurpose, {
  valid: ['/** @file Carrega e atualiza os dados da equipe do quadro. */\nexport const team = [];'],
  invalid: [
    { code: 'export const team = [];', errors: [{ messageId: 'missing' }] },
    {
      code: '/** @param {string} id */\nexport function find(id) { return id; }',
      errors: [{ messageId: 'missing' }],
    },
    {
      code: 'export const team = [];\n/** @file Descrição tardia que não apresenta o arquivo. */',
      errors: [{ messageId: 'missing' }],
    },
  ],
});

tester.run('imports-first', importsFirst, {
  valid: [
    '/** @file Apresenta os controles do quadro comercial. */\nimport a from "a";\nconst value = a;',
  ],
  invalid: [
    {
      code: '/** @file Apresenta os controles do quadro comercial. */\nconst value = 1;\nimport a from "a";\nuse(a, value);',
      output:
        '/** @file Apresenta os controles do quadro comercial. */\nimport a from "a";\n\nconst value = 1;\n\nuse(a, value);',
      errors: [{ messageId: 'first' }],
    },
  ],
});
