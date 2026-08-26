# MODULE_CONTRACT.md

Este documento é o contrato único de como um módulo (`src/modules/nucleo/*` ou
`src/modules/verticais/*`) é construído neste repositório. O objetivo é que
duas pessoas trabalhando em módulos diferentes nunca precisem se perguntar
nada uma à outra sobre arquitetura — as respostas estão todas aqui.

Backend em **JavaScript puro (ESM, Node >= 20.11)** — sem TypeScript, sem
build step. Tipagem é documental via JSDoc; garantias reais são impostas em
runtime (`assertModule`, Zod na borda HTTP) e estaticamente pelo
`eslint.config.js` (`eslint-plugin-boundaries` + `no-restricted-imports`).

## 1. O que é (e o que não é) um módulo

Um módulo é uma feature de **produto**, isolada, que um tenant contrata e que
pode ser ligada/desligada independente das demais (`TenantModule` no schema).
CRM, kanban, agendamento, pagamento in-chat e os módulos verticais
(estética capilar, tatuagem) são módulos.

O que **não** é módulo — mesmo sendo backend, mesmo tendo rota HTTP:

- **Infraestrutura de plataforma**, sem `tenant_id` para escopar, sem
  toggle por tenant. Exemplos já existentes: `/health` (`src/api/routes/health.js`)
  e `/admin/tenants` (`src/api/routes/admin-tenants.js`, usa `getAdminClient()`
  porque roda sem tenant existente ainda). Isso mora em `src/api/routes/`.
- **Infraestrutura compartilhada** que mais de um módulo usa (auth, gateway de
  banco, config, error handling). Isso mora em `src/core/`.

Se está em dúvida se algo é módulo: pergunte "isso faz sentido *desligado*
para um tenant específico, enquanto outro tenant continua usando?". Se sim,
é módulo. Se não, é `core/` ou `api/`.

## 2. Estrutura de pastas obrigatória

```
src/modules/<categoria>/<nome-do-modulo>/
├── index.js                    # exporta o objeto Module (contrato, seção 7)
├── controllers/
│   └── <recurso>.controller.js # HTTP fino — ver seção 3
├── services/
│   ├── <recurso>.service.js    # lógica de negócio — ver seção 3
│   └── <recurso>.service.test.js
├── adapters/
│   └── <recurso>.repository.js # único ponto de acesso a dado — ver seção 4
├── schemas/                    # opcional — ver critério abaixo
│   └── <recurso>.schema.js
├── types/
│   └── index.js                # @typedef do módulo (JSDoc)
└── prisma/
    └── schema.prisma.part      # DDL cru do schema deste módulo (ver seção 5)
```

`<categoria>` é `nucleo` ou `verticais`. Um módulo sem alguma dessas pastas
(ex: um módulo sem estado próprio, só orquestração) pode omitir a pasta que
não usa — mas nunca pode inventar uma pasta nova fora deste conjunto sem
atualizar este documento.

`schemas/` é opcional. Use pasta própria quando o módulo tiver **mais de ~2
schemas Zod**; com 1 ou 2, mantenha inline no arquivo do `controller` que o
usa — é o que CRM (`leads.controller.js`) e kanban (`board.controller.js`)
fazem hoje, 1 schema cada. Nenhum módulo dentro de `src/modules/` precisa
disso ainda — o critério fica documentado aqui pra quando um crescer o
suficiente.

Exemplo real: `src/modules/nucleo/crm/` segue essa estrutura à risca — vale
usar como referência sempre que tiver dúvida de onde algo vai.

## 3. Camadas: direção de dependência

```
controller → service → adapter
```

Uma seta é uma direção **permitida**. O inverso nunca é permitido, e pular
uma camada também não (`controller` nunca chama `adapter` direto).

- **`controllers/`** — HTTP fino. Recebe `(app)`, registra rotas Fastify,
  valida body/params com Zod, chama `services/`, formata a resposta. Nunca
  contém regra de negócio. Nunca importa nada de `adapters/`.
- **`services/`** — lógica de negócio pura. Nunca importa `fastify`. Nunca
  chama `getTenantClient()` diretamente — isso é trabalho do `adapter`.
  Chama funções de `adapters/` do **próprio** módulo.
- **`adapters/`** — única camada que toca dado. Nunca importa `fastify`.

O `eslint.config.js` aplica isso automaticamente: `controllers/` não pode
importar `#core/db/tenantClient.js` nem nada de `**/adapters/*`; `services/`
não pode importar `#core/db/tenantClient.js` nem `fastify`; `adapters/` não
pode importar `fastify`. Rodar `npm run lint` pega qualquer violação.

Exemplo real (`crm`): [`leads.controller.js`](src/modules/nucleo/crm/controllers/leads.controller.js)
chama [`leads.service.js`](src/modules/nucleo/crm/services/leads.service.js),
que chama [`leads.repository.js`](src/modules/nucleo/crm/adapters/leads.repository.js).

## 4. Acesso a dado multi-tenant

Toda query de negócio que toca uma tabela com `tenant_id` passa por
`getTenantClient(tenantId, callback)` (`#core/db/tenantClient.js`), chamado
**só** de dentro de um arquivo em `adapters/`.

```js
// adapters/leads.repository.js
import { getTenantClient } from '#core/db/tenantClient.js';

export function buscarLeadsPorTenant(tenantId) {
  return getTenantClient(tenantId, (tx) => tx.$queryRaw`
    SELECT id, nome, telefone FROM modulo_crm.leads
    WHERE tenant_id = ${tenantId}::uuid
    ORDER BY created_at DESC
  `);
}
```

Duas regras não-negociáveis aqui:

1. **Sempre filtre `WHERE tenant_id = ...` explicitamente na query**, mesmo
   sabendo que a RLS do Postgres já vai bloquear por trás. É defesa em
   profundidade de propósito — não é redundância acidental, é não confiar
   numa única camada de proteção.
2. **`$queryRaw`/`$executeRaw` sempre como tagged template**, nunca
   concatenando string. É isso que faz o Prisma parametrizar o valor
   automaticamente e evitar SQL injection. Nunca use `$queryRawUnsafe`.

Tabelas de módulo (`modulo_crm.*`, `modulo_kanban_universal.*`, etc.) não são
`model` do Prisma — são SQL cru, acessado via `$queryRaw`/`$executeRaw`
dentro do `adapter`. Isso é proposital: RLS, triggers e alguns `CHECK` não
são representáveis em Prisma Schema Language (ver comentário no topo de
`prisma/schema.prisma`). `getAdminClient()` é uso restrito, só para
operações administrativas sem tenant ainda existente (ex: provisionamento).

## 5. Toda tabela nova precisa de `tenant_id` + RLS + policy

Copie `prisma/templates/rls-tenant-isolation.sql` como ponto de partida.
Toda `CREATE TABLE` de um módulo segue este modelo:

```sql
CREATE SCHEMA IF NOT EXISTS modulo_<nome>;

CREATE TABLE modulo_<nome>.<tabela> (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE modulo_<nome>.<tabela> ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modulo_<nome>.<tabela>
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE INDEX idx_<tabela>_tenant_id ON modulo_<nome>.<tabela>(tenant_id);
```

Depois de qualquer mudança de schema:

```bash
npm run test:rls-coverage       # bloqueador de merge — varre TODO o banco
npm run test:tenant-isolation   # bloqueador de merge — tenta vazar dado ativamente
```

Os dois têm que passar antes de considerar a mudança pronta. Se
`test:rls-coverage` passar mas você não confia nele: ele só confere
`ENABLE ROW LEVEL SECURITY`, não `FORCE ROW LEVEL SECURITY` — se o role de
conexão do app for dono das tabelas, RLS pode estar "habilitado" e mesmo
assim não fazer nada. Confirme com `test:tenant-isolation`, que testa o
comportamento de verdade, não só a flag.

## 6. Imports

- Sempre por subpath import do Node (`#core/*`, `#shared/*`, `#modules/*`,
  `#api/*`, declarados no campo `imports` do `package.json`) — nunca
  caminho relativo saindo da pasta do módulo (`../../outro-modulo/...`).
  Dentro do próprio módulo, relativo é permitido e preferido
  (`../services/leads.service.js`).
- Toda importação ESM leva extensão `.js` explícita — inclusive as por
  alias (`#core/db/tenantClient.js`) e as de `index` (`#modules/nucleo/crm/index.js`).
- **Nenhum módulo importa de outro módulo.** Se `crm` e `kanban-universal`
  precisarem compartilhar algo, isso pertence a `#core` ou `#shared`, nunca
  um importando o outro direto. `eslint-plugin-boundaries` aplica isso.

## 7. O contrato do objeto `Module`

Todo módulo exporta, do seu `index.js`, um objeto que satisfaz:

```js
/**
 * @typedef {object} Module
 * @property {string} key                    // identificador único, snake_case
 * @property {string} name                   // nome legível
 * @property {(app: FastifyInstance) => void | Promise<void>} registerRoutes
 * @property {string[]} [requiredFeatureFlags]
 */
```

Validado em runtime por `assertModule()` (`#core/types/module.js`) — um
módulo mal formado quebra o **boot** do servidor, não uma requisição em
produção. `registerRoutes(app)` é chamado dentro de um `app.register(...)`
próprio (escopo isolado do Fastify), então hooks (`app.addHook('preHandler', ...)`)
registrados dentro dele não vazam para outros módulos.

Exemplo real:

```js
// modules/nucleo/crm/index.js
import { authenticateHook } from '#core/auth/rbac.js';
import { registrarRotasLeads } from './controllers/leads.controller.js';

export const crmModule = {
  key: 'crm',
  name: 'CRM de Vendas',
  async registerRoutes(app) {
    app.addHook('preHandler', authenticateHook);
    registrarRotasLeads(app);
  },
};
```

## 8. Testes esperados

No mínimo, todo `service` tem teste unitário mockando o próprio `adapter`
(nunca o banco real) — ver [`leads.service.test.js`](src/modules/nucleo/crm/services/leads.service.test.js)
como referência: `vi.mock('../adapters/xxx.repository.js', () => ({ ... }))`.

Módulo novo não precisa de teste de RLS próprio — os dois bloqueadores de
CI (`test:rls-coverage`, `test:tenant-isolation`, seção 5) já cobrem
**qualquer** tabela de **qualquer** schema automaticamente, contanto que a
tabela siga o modelo de RLS obrigatório.

## 9. Registrando um módulo novo

Único lugar do repositório onde módulos são listados:
`src/api/modules.js`, array `MODULES`. Adicionar um módulo = adicionar uma
linha:

```js
import { meuModuloNovoModule } from '#modules/nucleo/meu-modulo-novo/index.js';

export const MODULES = [
  crmModule,
  kanbanUniversalModule,
  // ...
  meuModuloNovoModule, // <- nova linha
];
```

Nada em `api/app.js` precisa mudar — o loop que registra módulos já itera
`MODULES` genericamente, chamando `assertModule` e `registerRoutes` para
cada um. `assertUniqueModuleKeys` garante que duas `key` iguais quebram o
boot, não silenciosamente sobrescrevem uma rota.

## 10. Checklist antes de considerar um módulo pronto

- [ ] Estrutura de pastas segue a seção 2
- [ ] Nenhuma camada importa fora da direção da seção 3
- [ ] `getTenantClient()` só aparece em `adapters/`, sempre com
      `WHERE tenant_id = ...` explícito e `$queryRaw`/`$executeRaw` como
      tagged template
- [ ] Toda tabela nova tem RLS + policy (seção 5) e
      `npm run test:rls-coverage && npm run test:tenant-isolation` passam
- [ ] Nenhum import relativo sai da pasta do módulo; nenhum import de outro
      módulo
- [ ] `index.js` exporta um objeto `Module` válido e está listado em
      `api/modules.js`
- [ ] `service` tem teste unitário mockando o `adapter`
- [ ] `npm run lint` passa sem erro
