---
paths:
  - "src/core/db/**"
  - "prisma/**"
  - "src/modules/nucleo/*/**"
  - "src/modules/verticais/*/**"
---

# Regra: Acesso a Dado Multi-tenant e Fronteira de Módulo

Backend em **JavaScript puro (ESM, Node >= 20.11)** — sem TypeScript e sem build step.
Tipagem é documental, via JSDoc; garantia de contrato é runtime (`assertModule`) + Zod na borda HTTP.

Este repositório NÃO usa workspaces — a fronteira entre módulos é garantida por
subpath imports do Node + ESLint (`eslint-plugin-boundaries`), não por impossibilidade física.
Antes de escrever ou revisar:

1. Toda query de negócio passa por `getTenantClient(tenantId, ...)`, chamado
   SÓ de dentro de um arquivo em `adapters/`. Nunca em `controllers/` ou `services/`.
2. Camadas só se chamam numa direção: `controller → service → adapter`.
3. Imports SEMPRE por alias (`#core/*`, `#shared/*`, `#modules/*`, `#api/*`, declarados no
   campo `imports` do `package.json`) — nunca caminho relativo saindo da pasta do módulo.
   Dentro do próprio módulo, relativo é permitido (`../services/x.js`).
4. Todo import ESM leva extensão explícita `.js` — inclusive os por alias
   (`#core/db/tenantClient.js`) e os de `index` (`#modules/nucleo/crm/index.js`).
5. Nenhum módulo importa de outro módulo. Se dois módulos precisam compartilhar
   algo, isso pertence a `#core` ou `#shared`.
6. Toda tabela nova tem `tenant_id UUID NOT NULL` + RLS habilitado + policy
   (copiar `prisma/migrations/0001_init/rls.sql`).
7. Depois de mudança de schema, rodar `npm run test:rls-coverage`.
8. Antes de considerar qualquer tarefa concluída, rodar `npm run lint` —
   é o que pega import indevido entre módulos, já que nada impede fisicamente.

Consulte `MODULE_CONTRACT.md` na raiz do repo para o contrato completo.
