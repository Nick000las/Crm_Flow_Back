/** @file Verifica fronteiras de persistência e bloqueia regressões de SQL em services. */
import { describe, it } from 'node:test';

import { RuleTester } from 'eslint';

import layers from './layers.js';

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2023, sourceType: 'module' } });
const service = '/project/src/modules/nucleo/kanban-universal/services/card.service.js';
const repository = '/project/src/modules/nucleo/kanban-universal/adapters/card.repository.js';

tester.run('layers', layers, {
  valid: [
    { filename: service, code: 'await repository.findCard(id);' },
    { filename: service, code: 'callbacks[0]();' },
    { filename: service, code: 'const map = Object.create(null); cache.delete(key);' },
    {
      filename: service,
      code: 'import { Prisma } from "@prisma/client"; const fragment = Prisma.sql`id = ${id}`;',
    },
    {
      filename: repository,
      code: 'export function find(tx) { return tx.$queryRaw`SELECT id FROM cards`; }',
    },
    {
      filename: repository,
      code: 'throw new TypeError("Identificador SQL fora do mapa estático");',
    },
  ],
  invalid: [
    {
      filename: service,
      code: 'await tx.usuario.create({ data });',
      errors: [{ messageId: 'database' }],
    },
    {
      filename: service,
      code: 'await tx["$queryRaw"]`SELECT id FROM cards`;',
      errors: [{ messageId: 'database' }],
    },
    {
      filename: service,
      code: 'await tx.$queryRaw`SELECT id FROM cards`;',
      errors: [{ messageId: 'database' }],
    },
    {
      filename: service,
      code: 'await tx.usuario.findMany();',
      errors: [{ messageId: 'database' }],
    },
    {
      filename: service,
      code: 'import { PrismaClient } from "@prisma/client";',
      errors: [{ messageId: 'database' }],
    },
    {
      filename: repository,
      code: 'import { authorize } from "../services/access.service.js";',
      errors: [{ messageId: 'direction' }],
    },
    {
      filename: repository,
      code: 'throw new AppError({ code: "FORBIDDEN" });',
      errors: [{ messageId: 'domainError' }],
    },
    { filename: repository, code: 'throw invalidCode();', errors: [{ messageId: 'domainError' }] },
    { filename: repository, code: 'tx.$queryRawUnsafe(query);', errors: [{ messageId: 'unsafe' }] },
    {
      filename: repository,
      code: 'tx.$queryRawUnsafe`SELECT id FROM cards`;',
      errors: [{ messageId: 'unsafe' }],
    },
  ],
});
