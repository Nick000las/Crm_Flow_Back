# Plano de implementação: integração CRM × Kanban

Base: `docs/crm/CRMFlow — Plano de Execução Integração CRM × Kanban.md` (4/11/2026), conferido contra o código da branch `ref/CRMxKANBAN` e o banco de dev em 4/11/2026. Os marcos M0 a M7 e as decisões P e D são os daquele documento; aqui estão a adaptação ao projeto e os checklists.

## Contexto

O merge juntou dois módulos que não conversam. O CRM é dono dos leads, e o Kanban tem um motor próprio, com cards nativos. O objetivo é fazer o Kanban trabalhar sobre os dados do CRM sem copiar dado e sem um módulo importar o outro, mantendo os quadros de projeto como estão.

**Decisões do dono (4/11/2026):**

- **Escopo:** M0, M1, M2 e M6 executados. Correção de 05/11/2026: a feat_Forms foi descartada e os formulários serão feitos do zero depois da sincronização. M3, M4 e M5 dependem do marco novo M2.5 (Fundação comercial).
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
- [ ] **0.3b Dados de dev (você):** `pnpm create:master` e `pnpm create:tenant`, depois `pnpm crm:reconcile`. Em 05/11/2026 só existem o tenant `Plataforma (interno)` e 1 usuário: falta criar um tenant de trabalho e rodar o reconcile nele.
- [x] **0.4 Formatação:** rodar `pnpm format`. Commit único seu, sem nada junto. Antes de todo o resto, para não misturar diffs.
- [x] **0.5 CI:** `pnpm test` e `test:fk-coverage` em `pr-checks.yml`; `npm run` trocado por `pnpm`; `db:migrate` (`migrate dev`) trocado por `db:migrate:deploy`. Só valida de fato no primeiro PR.
- [x] **0.6 Docs:** a contagem de 20 ocorrências estava errada (somava `pnpm`); restou 1 em documento histórico, que não se atualiza. Contador único registrado em `docs/MASTER_DOCUMENT.md` §1.1.3 e `crm_leads` removido do §1.6.1.
- [x] **0.7** `crm-lead-read-model.js` fica como está, sem remover. O ramo duplo sai no M2.5, etapa F5 (registrado no doc de compatibilidade).

**Aceite**

- [x] `_prisma_migrations` e `prisma/migrations` têm exatamente as mesmas 33 entradas, e `modulo_crm.crm_deal` não existe.
- [x] Criar e editar lead funcionam no banco resetado (`campos.db.test.js`, 10/10).
- [x] Gates verdes no ambiente local, inclusive `format:check`. Ressalva: `pnpm test:kanban:integration` não roda no Windows (prefixo de variável no script); validado com o comando equivalente, com Redis local.
- [ ] CI verde: **não validado**. A branch ainda não tem upstream, então o `pr-checks.yml` novo nunca rodou. Marcar no primeiro PR.

**Validação (05/11/2026):** 33 migrations iguais na pasta e em `_prisma_migrations`; `crm_deal`, `crm_pipeline` e `crm_event` não existem; `leads` tem `status` e `valor`; `campos.db.test.js` 10/10.

**Handoff ao front:** nenhum contrato muda. Avisar que o banco foi trocado.

---

## M1. Correções do Kanban atual

**Antes de começar:** passar pelo desenvolvedor do Kanban (seu ponto de controle).

- [x] **1.1 Testes primeiro:** teste de integração que prova o problema atual, com dois usuários em quadros diferentes.
- [x] **1.2 Hooks repetidos:** tirar `authenticateHook` e `verificarModulo` de `kanban-universal/index.js` e a checagem de `tenant_modules` em `executar()`. `app.js` já cobre as rotas; conferir os sockets, que têm autenticação própria.
- [x] **1.3 Leitura sem lock:** constante única `ACOES_DE_LEITURA` (hoje a lista está repetida no service e no repository).
- [x] **1.4 Lock por quadro:** `resolverQuadro` descobre o quadro por consulta direcionada e `carregarQuadro` traz só ele, depois do lock (`pg_advisory_xact_lock(hashtextextended(boardId, 0))`; o uuid do quadro já é único). `board.create`, `members` e `email.*` não carregam quadro.
- [x] **1.5 `board.get` consistente:** leitura de colunas e depois de cards, documentada em `carregarQuadro` e testada junto com movimentos simultâneos.
- [x] **1.6 Papéis:** usar `ROLES` e `ERROR_CODES` só nas linhas que este marco tocar.
- [x] **1.7 Fuso:** `listarEmpresasParaEmail` devolve `t.fuso_horario`, passado a `prepararEmails`. Remover `KANBAN_EMAIL_TIMEZONE` de `env.js`, `.env.example` e docs. Falha em um tenant não para os outros.
- [x] **1.8 Flags:** declarar `featureFlags` no módulo (`kanban_universal.quadros_entidade`, `kanban_universal.vinculo_entidade`), com a constante `KANBAN_FEATURES`.
- [x] **1.9 Tipos:** `boardType` validado por `TIPOS_QUADRO` (`projetos`, `postagens_agencia`); `crm_leads` saiu. Sem `CHECK` no banco, porque o catálogo muda no M2 e a revisão do desenvolvedor do Kanban foi dispensada pelo dono.

**Aceite**

- [x] Dois usuários do mesmo tenant editando quadros diferentes não entram em fila (teste com dois locks concorrentes).
- [x] Duas escritas no mesmo quadro continuam em série e a ordem dos cards fica íntegra.
- [x] Lembrete em fuso distante cai no dia local certo perto da virada (dois tenants, duas datas).
- [x] `test:kanban:integration` verde: 32/32 com `KANBAN_TEST_REDIS_URL`, incluindo os 3 de tempo real.

**Como ficou (05/11/2026):**

- A revisão do desenvolvedor do Kanban foi dispensada pelo dono.
- Toda escrita em quadro passa por `resolverQuadro`, lock do quadro, `exigirParticipacao` e `carregarQuadro`, nessa ordem. A autorização vem depois do lock para uma revogação em andamento valer para a escrita.
- A checagem de módulo saiu de `executar()`: vale o `exigirModuloAtivo` do `app.js`, com teste de integração. Ele tem cache de até 30 s, invalidado na troca de módulos.
- Risco que continua: a transação interativa do Prisma expira em 5 s, então uma fila longa de escritas no mesmo quadro pode falhar. O escopo por quadro reduz o problema, mas não o elimina.

**Handoff ao front:** tirar `crm_leads` de `board-types.js`; `POST /kanban/boards` recusa tipo fora do catálogo.

---

## M2. Contrato de provedor no core

**Antes de começar:** revisão do desenvolvedor do Kanban dispensada pelo dono.

**Adaptação principal: dois contratos pequenos em vez de um grande.**

```js
// Module.quadros: conteúdo de um quadro vindo de outro módulo
[{ boardType, entidadeTipo, listarQuadros(ctx), listarColunas(ctx, quadroRef),
   listarCards(ctx, quadroRef, { colunaRef, filtros, cursor, limite }),
   resumoColuna(ctx, quadroRef, { colunaRef, filtros }),
   mover(ctx, { quadroRef, entidadeId, colunaDestino, expectedUpdatedAt }),
   criar(ctx, { quadroRef, colunaRef, dados }), acoesPermitidas(ctx, entidadeId) }]

// Module.entidades: referência leve a um registro de outro módulo (M3 e M6)
[{ tipo, descrever(ctx, ids), rotaFicha(id),
   resolverVinculos(tenantId, ids) }] // { [id]: idAtual | null }, sem usuário: uso de job
```

`resolverVinculos` devolve o id atual porque um lead mesclado (M7 do CRM) não pode perder o vínculo.

- [x] **2.1** `src/core/types/module.js`: documentar e validar `quadros` e `entidades` em `assertModule` (falha no boot).
- [x] **2.2** `#core/quadros/registro.js`: `provedorDoQuadro(boardType)`, `provedorDaEntidade(tipo)`, `provedoresDeQuadro()` (no lugar do `tiposDeQuadro()` previsto, porque o motor precisa do provedor, não só do tipo), sobre `modulosRegistrados()`. Tipo repetido falha no boot (`assertProvedoresValidos`).
- [x] **2.3** `ERROR_CODES.CAMPOS_OBRIGATORIOS`: 400 com `fields`, no mesmo formato dos erros de regra do M8 do CRM.
- [x] **2.4 Motor separado:** `services/quadro-entidade.service.js`, sem passar por `executar()`, com rotas próprias `/kanban/quadros/:boardType/:quadroRef/...`. `quadroRef` não é uuid, e as rotas de `boards` seguem iguais.
- [x] **2.5** `GET /kanban/boards` passa a juntar quadros nativos e dos provedores, com `modo: 'nativo' | 'entidade'`. Flag desligada: lista igual à de hoje. Flag ligada e módulo dono não contratado: os mesmos quadros, só com o campo novo `modo`. Erro em provedor não derruba os quadros nativos.
- [x] **2.6** Sem linha em `boards`, sem coluna editável e sem excluir card. Só o que `acoesPermitidas` devolver.
- [x] **2.7** `testing/provedor-falso.js`, usado só nos testes.

**Aceite**

- [x] Provedor falso: listar, paginar, mover, mover com `CAMPOS_OBRIGATORIOS` e criar.
- [x] Tenant sem CRM ou sem flag: mesmos quadros, sem migration. Sem flag a resposta é idêntica; com a flag, cada quadro ganha só o campo `modo`.
- [x] Módulo com contrato mal formado quebra no boot.
- [x] Nenhum import entre módulos (ESLint de fronteiras).

**Como ficou (05/11/2026):**

- Dois ajustes no contrato: `mover` recebe `quadroRef`, para o provedor recusar outro quadro, e o quadro declara `entidadeTipo`, para o motor descrever os cards em lote pelo provedor de entidade.
- Rotas, todas atrás de `kanban_universal.quadros_entidade`: `GET .../colunas`, `POST .../resumo`, `POST .../cards/busca`, `POST .../cards`, `GET .../cards/:entidadeId/acoes` e `PATCH .../cards/:entidadeId/mover`, com o prefixo `/kanban/quadros/:boardType/:quadroRef`. Busca e resumo são POST porque os filtros não cabem na query.
- Sem provedor ou com o módulo dono não contratado, a resposta é 404: para esse tenant o quadro não existe.
- O motor não publica evento de tempo real em quadro de entidade. Isso entra no M5.
- Nenhum provedor real existe ainda: o CRM entra no M6 (`entidades`) e no M3 (`quadros`).

**Validação de M0 a M2 (05/11/2026, todos os gates de novo):**

| Gate                                                             | Resultado                                                                  |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `lint`, `format:check`                                           | limpos                                                                     |
| `test`                                                           | 786 passando, 38 ignorados (rodam nas duas linhas abaixo)                  |
| `*.db.test.js` do CRM com `CRM_DB_TESTS=1`                       | 28/28                                                                      |
| Integração do Kanban com Redis local                             | 32/32                                                                      |
| `test:rls-coverage`, `test:fk-coverage`, `test:tenant-isolation` | 2, 1 e 2 passando                                                          |
| Sobras no banco                                                  | só o tenant `Plataforma (interno)`; nenhum quadro, logo nenhum `crm_leads` |

**Handoff ao front:** contrato das rotas novas, `modo` e o formato de `CAMPOS_OBRIGATORIOS`. Sem tela nova ainda: não existe provedor real.

---

## M6. Vínculo de card de projeto com a pessoa

Depende só do M2. Atrás de `kanban_universal.vinculo_entidade`. Executado **depois** do M2, não em paralelo, porque usa o registro de entidades.

- [x] **6.1 Migration 0035:** `cards` ganha `entidade_tipo` e `entidade_id` nulos, `CHECK` de ambos juntos e índice parcial `(tenant_id, entidade_tipo, entidade_id)`. Sem FK entre schemas. O trigger `kanban_card_activity` ignora essas colunas, então `card.link` grava a própria atividade, sem o id da pessoa.
- [x] **6.2 CRM:** `Module.entidades` com `tipo: 'pessoa'`. `descrever` usa `identificadorVisivel` e `obterSchemaDoPapel`; anonimizado, na lixeira ou inexistente fica fora da resposta, que é a regra do contrato do M2 para "restrito" (no lugar do `{ id, restrito: true }` previsto). Filtrar sempre por tenant.
- [x] **6.3 Kanban:** ação `card.link` (vincular e desvincular), só em quadro nativo, e `vinculo` resolvido no `card.get` e no `board.get` em lote (sem N+1).
- [x] **6.4 Aba Projetos:** `GET /kanban/vinculos?entidadeTipo=pessoa&entidadeId=`. O CRM não importa o Kanban: quem chama é a tela.
- [x] **6.5 Varredura:** `src/workers/kanban.worker.js` e a fila `kanban-manutencao`, job diário com `resolverVinculos`, no padrão de `crm.worker.js`: repontar id mesclado e limpar órfão ou anonimizado. Script `pnpm worker:kanban`. Precisa estar no deploy; o M7 reaproveita esse worker para os e-mails.

**Decisão do dono (05/11/2026):** a aba mostra só os cards dos quadros que o usuário pode ver, e some se ele não vir nenhum.

**Aceite**

- [x] O card mostra o nome atualizado quando o CRM muda.
- [x] Anonimizar: o nome some na hora; depois do job, o vínculo some de todos os cards, e os cards ficam.
- [x] Usuário sem acesso ao registro vê só "Registro restrito". O CRM não restringe por linha, então os casos são: anonimizado, lixeira, CRM desligado no tenant e erro do provedor. Identificador oculto para o papel cai no nome, que não aceita restrição.
- [x] Lead mesclado: o vínculo passa para o principal, inclusive em cadeia (A → B → C).
- [x] Nenhuma tabela do Kanban guarda dado pessoal do CRM: só tipo e uuid. `activities` não guarda nem o id.

**Como ficou (05/11/2026):**

- A flag desligada não muda nenhuma resposta: `present()` esconde as colunas novas e o campo `vinculo` sai antes de responder.
- Mesclado responde pelo principal já na leitura, e o provedor informa `idAtual` para o link da ficha não dar 404. Até a varredura da noite, a aba do principal ainda não lista os cards herdados.
- `pnpm worker:kanban` precisa registrar os módulos, então `worker` passou a poder importar `api` no ESLint, só para `#api/modules.js`.
- A varredura roda às 2h, antes da purga da lixeira (3h), e alcança tenants cancelados, porque limpar referência a dado pessoal não depende de contrato.
- Risco que continua: `compose.yaml` e CI não sobem workers. Sem o `worker:kanban` no deploy, o nome some na leitura, mas a referência fica.
- Falha encontrada no M6 e corrigida em 05/11/2026: `anonimizarLead` parava no primeiro nível de mesclagem. Em A → B → C, anonimizar C deixava A com os dados na lixeira até a purga. Agora percorre a cadeia inteira, com teste em `lgpd.db.test.js`.

**Handoff ao front:** seletor de pessoa no card, exibição do vínculo e aba Projetos.

---

## M2.5. Fundação comercial

**Por que existe:** a branch feat_Forms foi descartada (decisão do dono, 05/11/2026). Os formulários serão feitos do zero **depois** da sincronização, então a base comercial que M3, M4 e M5 usam nasce aqui. O provedor falso do M2 já provou o contrato; um mock novo não provaria nenhum aceite do M3, que são regras sobre dado real.

**Objetivo:** cada pessoa ter N oportunidades em pipelines configuráveis, com uma regra só para mudar status, e a leitura voltar a ter um modelo só. A API de leads continua compatível durante a transição.

**Base:** `docs/crm/referencia-schema-0030-0034.sql` é referência, não cópia. As migrations são novas, a partir da 0036; os números 0030–0034 não são reaproveitados.

**Entra:**

| Tabela ou coluna                                                     | Do schema exportado                                                                                                |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `crm_pipeline`                                                       | igual, inclusive `auto_create_*`                                                                                   |
| `crm_deal`                                                           | sem `version` (o projeto usa `expectedUpdatedAt`) e sem `won_at_estimated` (só servia à migração de dados antigos) |
| `crm_event`                                                          | igual: append-only, só o controle de processamento muda                                                            |
| `crm_option.pipeline_id`                                             | status passa a pertencer a um pipeline                                                                             |
| `leads.principal_deal_id`, `lifecycle_stage`, `lifecycle_changed_at` | iguais                                                                                                             |

**Fica de fora:**

| Item                                                                         | Motivo                                                           | Quando                       |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------- |
| Formulários, anamnese e link público                                         | plano próprio, do zero                                           | depois do M5                 |
| Segunda venda (D6: oferecer juntar ao card de pós-venda ou criar outro)      | regra de exceção; o M3 não depende dela                          | depois do M5                 |
| `crm_field_pipeline` (campo por pipeline)                                    | nenhum aceite usa                                                | com os formulários           |
| `crm_lifecycle_config` (rótulos do ciclo de vida)                            | os rótulos padrão bastam                                         | quando houver pedido         |
| Contadores `open_deals_count`, `won_deals_count`, `open_service_deals_count` | dá para calcular na leitura; contador duplicado exige manutenção | só se o M4 medir necessidade |
| `custom_fields` na oportunidade                                              | campos personalizados seguem no lead                             | com os formulários           |
| Consumir o outbox                                                            | aqui ele só é gravado                                            | M5                           |
| Bot, mensagens e créditos                                                    | fora do escopo                                                   | outro plano                  |

**Decididas pelo dono em 05/11/2026** (as quatro recomendações aprovadas):

| #   | Pergunta                                                  | Recomendação                                                                                                       |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| F-1 | Todo lead novo nasce com oportunidade em Vendas?          | Sim. Hoje todo lead aparece no funil; sem oportunidade, ele sumiria do quadro.                                     |
| F-2 | Qual é a oportunidade principal de uma pessoa?            | A aberta mais recente em pipeline `sales`; sem aberta, a última ganha; senão, a mais recente.                      |
| F-3 | Ciclo de vida                                             | Derivado: com oportunidade aberta, `oportunidade`; com alguma ganha, `cliente`, que tem prioridade; senão, `lead`. |
| F-4 | Card de atendimento automático vem ligado em tenant novo? | Sim, com o dono podendo desligar.                                                                                  |

**Decididas pelo dono em 05/11/2026, depois da F0:**

- Lead sem status nasce no primeiro status aberto de Vendas. É a única mudança visível na API: hoje ele nasce com `status: null`, e `crm_deal.status` é obrigatório.
- `funil_estagio_id` e `estagio_nome` passam a devolver a opção de status.

**Decididas pelo dono em 05/11/2026, durante a F4:**

- **Mesclar:** as oportunidades dos dois continuam existindo e o lead mostra a principal (F-2). A escolha de status, valor e motivo deixa de valer e sai da tela de mesclar.
- **Data de conversão:** só em oportunidade ganha; fora disso, 400 no campo. Na importação, a linha vai para o relatório de erros.
- **`status: null`:** 400. Toda oportunidade tem status.
- **Categoria de status em uso:** 409, pedindo para mover as oportunidades antes.

### Etapas

Cada etapa fecha com os gates verdes e para para validação. Só a F5 apaga algo.

**F0. Mapa e rede de proteção**

- [x] Listar quem lê e quem grava cada campo comercial: `docs/crm/mapa-campos-comerciais.md`.
- [x] Testes de caracterização de `/crm/leads`, rodando **antes** da mudança: `leads.contrato.db.test.js`, 13 casos, incluindo edição em massa, mesclar e anonimizar. Eles são o contrato da transição.
- [x] Testes de banco do CRM no CI: `pnpm test:crm:db`, com `CRM_DB_TESTS=1`. Antes não rodavam lá. Só valida de fato no primeiro PR.

**F1. Schema aditivo**

- [x] Migration 0036: `crm_pipeline`, com RLS e FK composta por tenant.
- [x] Migration 0037: `crm_deal`, `crm_event` e colunas novas de `leads` e `crm_option`. Acrescentou `archived_at` em `crm_deal` (P9) e `UNIQUE (tenant_id, id)` em `leads`, que faltava para a FK por tenant.
- [x] Nada lê as tabelas novas ainda: `usaOportunidades` prioriza o modelo atual enquanto `funil_estagios` e `leads.status` existirem.
- [x] `test:rls-coverage` e `test:fk-coverage` cobrem as tabelas novas. Regras do banco testadas em `crm-oportunidades.schema.db.test.js`.
- [x] `crm_option` ganhou só a coluna `pipeline_id`. A regra "todo status tem pipeline" e a nova unicidade ficam para a F2, junto com o seed.

**F2. Seed por tenant**

- [x] `reconciliarTenant`: pipelines Vendas (padrão) e Atendimento, de forma idempotente. O passo `pipelines-padrao` roda antes das listas.
- [x] `crm_option`: backfill de `pipeline_id` nos status, `chk_crm_option_pipeline`, unicidade `(tenant_id, kind, pipeline_id, key)` e ajuste do `ON CONFLICT` de `inserirOpcoes` (migration 0038). É migration de dado porque a constraint vale sobre as linhas que já existem.
- [x] Status de Vendas: as opções de `crm_option` que já existem passam a pertencer ao pipeline. `funil_estagios` está vazio e não entra no seed (achado da F0). Atendimento ganha uma lista própria inicial: Aguardando início, Em atendimento, Concluído e Cancelado.
- [x] Limite de 5 pipelines por tenant (D5), validado no service, com lock por tenant contra pedidos simultâneos.
- [x] Até a F4, o `status` do lead é sempre um status do pipeline padrão: listas, inatividade e `ESFRIA_EM` filtram por ele. Sem isso, Atendimento vazaria para o formulário e nenhum lead esfriaria.
- [x] `pnpm crm:reconcile` duas vezes não duplica nada (`pipelines.db.test.js`).

**F3. Service único de oportunidade**

- [x] `oportunidades.service.js`: criar, editar, mudar status, arquivar e lixeira. Ganhar, perder e reabrir são `mudarStatusDaOportunidade`: a categoria da opção define o efeito. Ficha, importação e edição em massa entram nele na F4, e o `mover` no M3.
- [x] Reaproveitar as regras do M8: obrigatoriedade por status, motivo de perda e opção ativa, com a categoria da opção do pipeline certo (`validarRegras`). Campo faltando vira `CAMPOS_OBRIGATORIOS`.
- [x] Na mesma transação: oportunidade, ciclo de vida, oportunidade principal, histórico na timeline da pessoa e `crm_event`. Mudar status continua contando como interação (`ultima_interacao_em`), que é o relógio do M9.
- [x] Atendimento automático ao ganhar, sem duplicar (`uq_crm_deal_origem_quadro`), e `source_reopened_at` quando a venda de origem reabre. Até a D6 existir, cada venda ganha cria o próprio card de atendimento, mesmo com outro aberto.
- [x] Publicar por `crm-outbox.repository.js`, usado só dentro de transação.

**F4. Fluxos do CRM sobre a oportunidade**

- [x] Primeiro passo: leitura e escrita trocaram de modelo juntas. `usaOportunidades` agora prefere as oportunidades, e nada mais grava nas colunas comerciais de `leads`, que ficam vazias até a F5.
- [x] Criar e editar lead: campos comerciais vão para a oportunidade principal, na mesma transação do lead, e a resposta não muda de formato. Um PUT continua sendo um evento só na timeline. O dono da principal acompanha o responsável; a oportunidade de atendimento mantém o dela.
- [x] Filtros, views salvas, busca, totais e exportação: todos leem por `fonteLeads`. A lista segue por data de criação, como hoje: `estagio_ordem` saiu do `ORDER BY` porque agruparia a tabela por status.
- [x] Importação: lead novo com oportunidade; regra de duplicados igual à de hoje.
- [x] Edição em massa e distribuição: mudar responsável alcança a oportunidade. A distribuição só atribui ao criar, e a oportunidade já nasce com esse dono.
- [x] Inatividade (M9) e score (M14): relógio e regras leem o status da oportunidade. O score é recalculado também nas mudanças feitas pelo service único.
- [x] **Mesclar:** oportunidades do secundário passam para o principal, inclusive as da lixeira, e a principal é recalculada nos dois lados.
- [x] **Anonimizar:** `title` da oportunidade é limpo em toda a cadeia de mesclagem, o título também some do histórico, e `crm_event` não guarda dado pessoal (payload só com ids). `status`, valor e motivo de perda ficam, como hoje.
- [x] **Lixeira e purga:** oportunidade acompanha a pessoa com o mesmo carimbo de `deleted_at`, então restaurar traz só as que foram junto. A purga apaga em cascata. Arquivar o lead não mexe nas oportunidades: o quadro do M3 precisa esconder cards de lead arquivado.
- [x] Backfill não foi necessário: o banco de dev tem 0 leads, e não existe produção. Se isso mudar antes da F5, é preciso migrar os dados antes de apagar as colunas.

**F5. Um modelo só**

- [ ] Remover `usaOportunidades`, o ramo legado de `fonteLeads`, `funil-estagios.repository.js` e `CRM_SCHEMA_INCOMPATIBLE`.
- [ ] Coluna "Estágio do funil" da planilha: hoje casa com `funil_estagios`, que é vazio. Passa a casar com o nome da opção de status (`funilEstagioId`), e `estagioPadraoId` sai.
- [ ] `fonteLeads` volta a usar `contato.*`, sem a lista `COLUNAS_DO_CONTATO`.
- [ ] Migration final: apaga `funil_estagios` e as colunas comerciais de `leads`. Irreversível, por isso vem por último e só depois de F0 a F4 validadas.
- [ ] Atualizar `compatibilidade-leitura-oportunidades.md` e `MASTER_DOCUMENT.md`.

**F6. API de pipelines e oportunidades**

- [ ] Configurações (só gestão): listar, criar, editar, ativar e desativar pipeline; status por pipeline; automação do atendimento. Sem apagar pipeline com oportunidade.
- [ ] Ficha: `GET` e `POST /crm/leads/:id/oportunidades`, `PUT /crm/oportunidades/:id` e `PATCH /crm/oportunidades/:id/status`, com `expectedUpdatedAt`.
- [ ] Permissão por campo aplicada, como em `/crm/leads`.

**Aceite**

- [ ] Uma pessoa com duas oportunidades em pipelines diferentes, cada uma com seu status.
- [ ] Os testes de caracterização da F0 continuam verdes: a API de leads não mudou de formato.
- [ ] Venda ganha cria o card de atendimento com a automação ligada, não cria com ela desligada, e repetir o ganho não duplica.
- [ ] Toda mudança de status grava `crm_event` e histórico na mesma transação; falhar em uma desfaz a outra.
- [ ] Mesclar preserva as oportunidades; anonimizar não deixa dado pessoal em `crm_deal` nem em `crm_event`.
- [ ] Tenant com 5 pipelines não cria o sexto.
- [ ] `funil_estagios` não existe e nenhum código o cita.
- [ ] Todos os gates verdes, sem teste ignorado.

**Handoff ao front:** a tabela e a ficha seguem funcionando na transição. Telas novas: Configurações de pipelines, aba Oportunidades na ficha. 5 arquivos do front citam funil ou estágio e precisam acompanhar a F5. Mudanças de comportamento da F4: lead sem status nasce no primeiro aberto; `funil_estagio_id` deixa de ser nulo; `status: null` é 400; `dataConversao` fora de venda ganha é 400, e reabrir uma venda exige não reenviar a data; `valor` negativo é 400; `probabilidadeFechamento` é inteiro de 0 a 100; a escolha de status, valor e motivo sai da tela de mesclar; mudar a categoria de status em uso é 409; ganhar preenche `data_conversao`, e sair de Perdido limpa `motivo_perda`.

---

## Marcos seguintes (dependem do M2.5)

**Critério de entrada:** aceite do M2.5 completo, com `crm-lead-read-model.js` reduzido a um modelo só.

### M3. Provedor `crm_oportunidades` (flag `crm.quadro_comercial`)

Passos adaptados ao código:

- [ ] O `mover` chama o service único de oportunidade do M2.5 (F3), sem regra própria.
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

### Depois do M5

- Formulários do zero, com plano próprio.
- Segunda venda (D6): oferecer juntar ao card de pós-venda existente ou criar outro. Por automação ou importação, não cria card novo e deixa o aviso "nova venda: juntar ou separar?" no card existente.

---

## Ordem e paradas

1. M0 (feito; falta o CI).
2. M1 (feito).
3. M2 (feito).
4. M6 (feito).
5. M2.5 (em andamento).
6. M3 → M4 → M5.
7. Formulários do zero e segunda venda (D6).
8. M7.

## Riscos

- **Perder o schema de 0030–0034** ao trocar de banco: mitigado pelo item 0.1, que vem antes.
- **Concorrência no M1:** trocar lock de tenant por quadro muda garantias. Testes concorrentes vêm antes da mudança.
- **Quadros nativos regredirem no M2:** motor separado, sem tocar em `executar()`.
- **Worker novo no M6:** só funciona se entrar no deploy; o nome some na leitura mesmo sem ele.
- **Tamanho do M2.5:** é o maior marco e toca fluxos sensíveis. Mitigado por etapas com parada, testes de caracterização antes da mudança e apagar só na F5.
- **Troca de modelo:** feita na F4, com leitura e escrita juntas. Até a F5, as colunas comerciais de `leads` existem, mas ficam vazias: nenhum código deve lê-las.

## Verificação

Em cada marco: rodar todos os gates, executar o aceite contra o banco novo com dados SMOKE e limpeza no fim, conferir que não sobrou tenant SMOKE, marcar o checklist em `docs/crm/plano-execucao-crm-kanban.md` com um "Como ficou" e entregar o handoff. M2 e M6 também rodam com um tenant sem CRM, para provar que nada muda nele.
