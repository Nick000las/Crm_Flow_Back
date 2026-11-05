# Plano de implementação: integração CRM × Kanban

Base: `docs/crm/CRMFlow — Plano de Execução Integração CRM × Kanban.md` (4/11/2026), conferido contra o código da branch `ref/CRMxKANBAN` e o banco de dev em 4/11/2026. Os marcos M0 a M7 e as decisões P e D são os daquele documento; aqui estão a adaptação ao projeto e os checklists.

## Contexto

O merge juntou dois módulos que não conversam. O CRM é dono dos leads, e o Kanban tem um motor próprio, com cards nativos. O objetivo é fazer o Kanban trabalhar sobre os dados do CRM sem copiar dado e sem um módulo importar o outro, mantendo os quadros de projeto como estão.

**Decisões do dono (4/11/2026):**

- **Escopo:** executar agora M0, M1, M2 e M6. M3, M4 e M5 ficam com checklist, bloqueados até a feat_Forms refeita chegar.
- **Vínculo e LGPD no M6:** leitura mais varredura. O nome some na hora; um job diário limpa os vínculos órfãos; o outbox substitui o job depois.
- **`crm_leads`:** é só teste. O tipo sai no M1, sem migrar nada.

## O que o código mostrou (muda o plano original)

| Achado                                                                                                                        | Consequência                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `crm_deal`, `crm_pipeline` e `crm_event` existem só no banco de dev. As migrations 0030–0034 não estão em nenhuma ref do Git. | O banco atual é a **única cópia** desse schema: exportar antes de trocar (M0.1).                         |
| `prisma migrate status` responde "up to date" com 5 migrations a mais no banco.                                               | O aceite do M0 não pode depender só dele; conferir `_prisma_migrations` contra a pasta.                  |
| Hoje `leads` não tem `status`, `valor` etc. no banco de dev.                                                                  | Escrever lead no dev está quebrado. O M0 é bloqueador de verdade.                                        |
| `format:check` falha em 257 arquivos e está no CI.                                                                            | A formatação vem primeiro, antes de qualquer outra mudança.                                              |
| `pr-checks.yml` não roda `pnpm test` nem `test:fk-coverage`.                                                                  | A suíte principal não protege os PRs. Entra no M0.                                                       |
| Prefixos duplicados 0008–0011 (CRM e Kanban).                                                                                 | Não renomear o que já foi aplicado. Provar o replay do zero. A próxima migration é a **0035**.           |
| Flag precisa começar com a `key` do módulo (`assertModule`).                                                                  | As do Kanban são `kanban_universal.*`, não `kanban.*`.                                                   |
| `publicarKanban` é decorado no escopo do módulo Kanban, e a audiência sai de `board_members`.                                 | No M5 o CRM não enxerga esse decorator, e quadro de entidade não tem membros. Vai para um canal no core. |
| `board_type` guardado é `projetos`; o front também conhece `postagens_agencia`.                                               | Não renomear para `nativo`. "Nativo" é derivado: tipo sem provedor.                                      |
| O M6 precisa só da pessoa, mas `descreverCard` está no contrato do quadro.                                                    | Separar dois contratos (M2).                                                                             |

## Convenções de execução

- **Git:** só você commita. Cada marco entrega uma lista de commits sugeridos e para.
- **Front:** não mexo em `Front/`. Cada marco termina com handoff.
- **Segredos e Neon:** criar a branch e trocar o `.env` são ações suas.
- **Clean code:** estrangular, não reescrever. O `executar()` de 400 linhas só é tocado onde o marco exige; o refactor amplo fica no M7. Mudança de comportamento e movimentação de código não vão no mesmo commit.
- **Migrations:** aditivas, contador único a partir de 0035, RLS em tudo.
- **Gates de todo marco:** `pnpm lint`, `format:check`, `test`, `test:rls-coverage`, `test:fk-coverage`, `test:tenant-isolation`, `test:kanban:integration`.
- **Parada obrigatória:** ao fim de cada marco eu reporto e espero o seu sinal.
- **Primeira ação depois de aprovado:** copiar este plano para `docs/crm/plano-execucao-crm-kanban.md`, que vira a fonte dos checklists.

---

## M0. Ambiente (bloqueador)

**Objetivo:** banco igual à main e CI confiável.

- [x] **0.1 Preservar (eu):** exportar o schema de 0030–0034 do banco atual (só estrutura, sem dados) para `docs/crm/referencia-schema-0030-0034.sql`.
- [x] **0.2 Banco (decisão do dono, 04/11/2026):** sem branch nova no Neon. O mesmo banco de dev foi resetado (schemas `modulo_*` removidos e `prisma migrate reset`), com perda de todos os dados de dev. O role `app_tenant` foi mantido.
- [x] **0.3 Replay:** as 33 migrations aplicadas do zero.
- [ ] **0.3b Dados de dev (você):** `pnpm create:master` e `pnpm create:tenant`, depois `pnpm crm:reconcile`.
- [x] **0.4 Formatação:** rodar `pnpm format`. Commit único seu, sem nada junto. Antes de todo o resto, para não misturar diffs.
- [x] **0.5 CI:** `pnpm test` e `test:fk-coverage` em `pr-checks.yml`; `npm run` trocado por `pnpm`; `db:migrate` (`migrate dev`) trocado por `db:migrate:deploy`. Só valida de fato no primeiro PR.
- [x] **0.6 Docs:** a contagem de 20 ocorrências estava errada (somava `pnpm`); restou 1 em documento histórico, que não se atualiza. Contador único registrado em `docs/MASTER_DOCUMENT.md` §1.1.3 e `crm_leads` removido do §1.6.1.
- [x] **0.7** `crm-lead-read-model.js` fica como está, sem remover. A decisão de tirar o ramo duplo sai na feat_Forms (registrar no doc de compatibilidade).

**Aceite**

- [x] `_prisma_migrations` e `prisma/migrations` têm exatamente as mesmas 33 entradas, e `modulo_crm.crm_deal` não existe.
- [x] Criar e editar lead funcionam no banco resetado (`campos.db.test.js`, 10/10).
- [x] Gates verdes, inclusive `format:check`. Ressalvas: `pnpm test:kanban:integration` não roda no Windows (prefixo de variável no script), validado com o comando equivalente; os 3 testes de tempo real exigem `KANBAN_TEST_REDIS_URL` e ficaram de fora.

**Handoff ao front:** nenhum contrato muda. Avisar que o banco foi trocado.

---

## M1. Correções do Kanban atual

**Antes de começar:** passar pelo desenvolvedor do Kanban (seu ponto de controle).

- [ ] **1.1 Testes primeiro:** teste de integração que prova o problema atual, com dois usuários em quadros diferentes.
- [ ] **1.2 Hooks repetidos:** tirar `authenticateHook` e `verificarModulo` de `kanban-universal/index.js` e a checagem de `tenant_modules` em `executar()`. `app.js` já cobre as rotas; conferir os sockets, que têm autenticação própria.
- [ ] **1.3 Leitura sem lock:** constante única `ACOES_DE_LEITURA` (hoje a lista está repetida no service e no repository).
- [ ] **1.4 Lock por quadro:** extrair `carregarEscopo(tx, tenantId, action, id)`. Ela resolve `id → boardId` com consulta direcionada (quadro, coluna, card, comentário) e, na escrita, trava com `pg_advisory_xact_lock(hashtextextended(tenantId || ':' || boardId, 0))`. Só então carrega colunas e cards **daquele** quadro. `board.create`, `members` e `email.*` não carregam quadro.
- [ ] **1.5 `board.get` consistente:** colunas e cards sem lock são leituras separadas. Trazer os dois numa consulta só ou documentar e testar a concorrência com reordenação.
- [ ] **1.6 Papéis:** usar `ROLES` e `ERROR_CODES` só nas linhas que este marco tocar.
- [ ] **1.7 Fuso:** `listarEmpresasParaEmail` devolve `t.fuso_horario`, passado a `prepararEmails`. Remover `KANBAN_EMAIL_TIMEZONE` de `env.js`, `.env.example` e docs. Falha em um tenant não para os outros.
- [ ] **1.8 Flags:** declarar `featureFlags` no módulo (`kanban_universal.quadros_entidade`, `kanban_universal.vinculo_entidade`), com a constante `KANBAN_FEATURES`.
- [ ] **1.9 Tipos:** `boardType` deixa de ser texto livre; catálogo com `projetos` e `postagens_agencia`. `crm_leads` sai. Colocar um `CHECK` em banco só se o desenvolvedor do Kanban concordar, porque o catálogo mudará no M2.

**Aceite**

- [ ] Dois usuários do mesmo tenant editando quadros diferentes não entram em fila (teste com dois locks concorrentes).
- [ ] Duas escritas no mesmo quadro continuam em série e a ordem dos cards fica íntegra.
- [ ] Lembrete em fuso distante cai no dia local certo perto da virada (dois tenants, duas datas).
- [ ] `test:kanban:integration` verde.

**Handoff ao front:** tirar `crm_leads` de `board-types.js`; `POST /kanban/boards` recusa tipo fora do catálogo.

---

## M2. Contrato de provedor no core

**Antes de começar:** passar pelo desenvolvedor do Kanban.

**Adaptação principal: dois contratos pequenos em vez de um grande.**

```js
// Module.quadros: conteúdo de um quadro vindo de outro módulo
[{ boardType, listarQuadros(ctx), listarColunas(ctx, quadroRef),
   listarCards(ctx, quadroRef, { colunaRef, filtros, cursor, limite }),
   resumoColuna(ctx, quadroRef, { colunaRef, filtros }),
   mover(ctx, { entidadeId, colunaDestino, expectedUpdatedAt }),
   criar(ctx, { quadroRef, colunaRef, dados }), acoesPermitidas(ctx, entidadeId) }]

// Module.entidades: referência leve a um registro de outro módulo (M3 e M6)
[{ tipo, descrever(ctx, ids), rotaFicha(id),
   resolverVinculos(tenantId, ids) }] // { [id]: idAtual | null }, sem usuário: uso de job
```

`resolverVinculos` devolve o id atual porque um lead mesclado (M7 do CRM) não pode perder o vínculo.

- [ ] **2.1** `src/core/types/module.js`: documentar e validar `quadros` e `entidades` em `assertModule` (falha no boot).
- [ ] **2.2** `#core/quadros/registro.js`: `provedorDoQuadro(boardType)`, `provedorDaEntidade(tipo)`, `tiposDeQuadro()`, sobre `modulosRegistrados()`. Tipo repetido falha no boot.
- [ ] **2.3** `ERROR_CODES.CAMPOS_OBRIGATORIOS`: 400 com `fields`, no mesmo formato dos erros de regra do M8 do CRM.
- [ ] **2.4 Motor separado:** `services/quadro-entidade.service.js`, sem passar por `executar()`, com rotas próprias `/kanban/quadros/:boardType/:quadroRef/...`. `quadroRef` não é uuid, e as rotas de `boards` seguem iguais.
- [ ] **2.5** `GET /kanban/boards` passa a juntar quadros nativos e dos provedores, com `modo: 'nativo' | 'entidade'`. Flag desligada ou módulo não contratado: lista igual à de hoje. Erro em provedor não derruba os quadros nativos.
- [ ] **2.6** Sem linha em `boards`, sem coluna editável e sem excluir card. Só o que `acoesPermitidas` devolver.
- [ ] **2.7** `testing/provedor-falso.js`, usado só nos testes.

**Aceite**

- [ ] Provedor falso: listar, paginar, mover, mover com `CAMPOS_OBRIGATORIOS` e criar.
- [ ] Tenant sem CRM ou sem flag: respostas iguais às de hoje, sem migration.
- [ ] Módulo com contrato mal formado quebra no boot.
- [ ] Nenhum import entre módulos (ESLint de fronteiras).

**Handoff ao front:** contrato das rotas novas, `modo` e o formato de `CAMPOS_OBRIGATORIOS`. Sem tela nova ainda: não existe provedor real.

---

## M6. Vínculo de card de projeto com a pessoa

Depende só do M2. Atrás de `kanban_universal.vinculo_entidade`. Executado **depois** do M2, não em paralelo, porque usa o registro de entidades.

- [ ] **6.1 Migration 0035:** `cards` ganha `entidade_tipo` e `entidade_id` nulos, `CHECK` de ambos juntos e índice parcial `(tenant_id, entidade_tipo, entidade_id)`. Sem FK entre schemas. Conferir o trigger `kanban_card_activity`, que precisa registrar a mudança sem dado pessoal.
- [ ] **6.2 CRM:** `Module.entidades` com `tipo: 'pessoa'`. `descrever` usa `identificadorVisivel` e `obterSchemaDoPapel`; sem permissão ou anonimizado devolve `{ id, restrito: true }`. Filtrar sempre por tenant.
- [ ] **6.3 Kanban:** ação `card.link` (vincular e desvincular), só em quadro nativo, e `vinculo` resolvido no `card.get` e no `board.get` em lote (sem N+1).
- [ ] **6.4 Aba Projetos:** `GET /kanban/vinculos?entidadeTipo=pessoa&entidadeId=`. O CRM não importa o Kanban: quem chama é a tela.
- [ ] **6.5 Varredura:** `src/workers/kanban.worker.js` e a fila `kanban-manutencao`, job diário com `resolverVinculos`, no padrão de `crm.worker.js`: repontar id mesclado e limpar órfão ou anonimizado. Script `pnpm worker:kanban`. Precisa estar no deploy; o M7 reaproveita esse worker para os e-mails.

**A confirmar com você no início do M6:** a aba mostra só os cards dos quadros que o usuário pode ver? Recomendação: sim, e a aba some se ele não vir nenhum.

**Aceite**

- [ ] O card mostra o nome atualizado quando o CRM muda.
- [ ] Anonimizar: o nome some na hora; depois do job, o vínculo some de todos os cards, e os cards ficam.
- [ ] Usuário sem acesso ao registro vê só "Registro restrito".
- [ ] Lead mesclado: o vínculo passa para o principal.
- [ ] Nenhuma tabela do Kanban guarda dado pessoal do CRM.

**Handoff ao front:** seletor de pessoa no card, exibição do vínculo e aba Projetos.

---

## Marcos bloqueados (não começar sem a feat_Forms refeita)

**Critério de entrada:** oportunidades, `crm_pipeline` e o outbox `crm_event` na main, com migrations novas (números depois dos usados aqui), e `crm-lead-read-model.js` reduzido a um modelo só.

### M3. Provedor `crm_oportunidades` (flag `crm.quadro_comercial`)

Passos adaptados ao código:

- [ ] Criar um service único de mudança de status da oportunidade, chamado pela ficha e pelo `mover`. Traduzir os erros de `errosDasRegras` para `CAMPOS_OBRIGATORIOS`.
- [ ] Permissão: `obterSchemaDoPapel` em `listarCards` e `descrever`; a soma sai `null` sem acesso a Valor.
- [ ] `expectedUpdatedAt` também na edição do CRM.
- [ ] Visibilidade por pipeline (D4) como condição central em `lead-filter.service.js`, para valer em busca, export e totais.

Aceite: os 6 itens do documento.

### M4. Ordem, filtros e escala

- [ ] Reaproveitar `montarCondicoes` e as views do CRM. Ordenar só pelos campos ordenáveis da tabela.
- [ ] Cursor por chave (campo de ordenação + `id`), não por `OFFSET`.
- [ ] Índices definidos com `EXPLAIN ANALYZE` sobre 20 mil oportunidades em banco de dev.
- [ ] Passar pelo desenvolvedor do Kanban. D8 segue pendente com você.

Aceite: os 5 itens do documento.

### M5. Tempo real

- [ ] Criar um canal em `#core` (publicar por tipo de entidade), porque `publicarKanban` não é visível fora do módulo.
- [ ] Definir a audiência sem `board_members`: permissão do CRM, por usuário.
- [ ] Importação e distribuição rodam no worker, fora do processo do socket: o despacho do outbox precisa chegar ao HTTP (Redis pub/sub).

Aceite: os 3 itens do documento.

### M7. Segunda etapa

Como no documento. O envio de e-mail reaproveita o `kanban.worker.js` do M6, e o refactor de camadas tira as ações de `executar()`.

---

## Ordem e paradas

1. M0 (você cria o banco; eu preparo o resto; commit de formatação isolado).
2. Revisão do desenvolvedor do Kanban → M1.
3. Revisão do desenvolvedor do Kanban → M2.
4. M6.
5. Bloqueio: feat_Forms refeita, com plano próprio.
6. M3 → M4 → M5 → M7.

## Riscos

- **Perder o schema de 0030–0034** ao trocar de banco: mitigado pelo item 0.1, que vem antes.
- **Concorrência no M1:** trocar lock de tenant por quadro muda garantias. Testes concorrentes vêm antes da mudança.
- **Quadros nativos regredirem no M2:** motor separado, sem tocar em `executar()`.
- **Worker novo no M6:** só funciona se entrar no deploy; o nome some na leitura mesmo sem ele.

## Verificação

Em cada marco: rodar todos os gates, executar o aceite contra o banco novo com dados SMOKE e limpeza no fim, conferir que não sobrou tenant SMOKE, marcar o checklist em `docs/crm/plano-execucao-crm-kanban.md` com um "Como ficou" e entregar o handoff. M2 e M6 também rodam com um tenant sem CRM, para provar que nada muda nele.
