# Plano: Configurações e Features do CRM

Base: [`especificacao-configuracoes.md`](./especificacao-configuracoes.md) (15/10/2026), cruzada com o estado atual do back e do front.

**Status:** plano aprovado em 2026-10-15. M0 e M1 concluídos; M1.8 (aposentadoria) antecipada em 2026-10-15 — sem produção, a flag `crm.campos_v2`, a escrita dupla e as tabelas antigas saíram (migration 0014). M2 concluído no back (falta o front). Migrations até a 0023 aplicadas no banco de dev. Revisão geral feita em 2026-10-15 (seção "Revisão pós-M2"). M3 concluído no back em 2026-10-15, M4, M6 e M7 (back e front) e M5 em 2026-10-16, M8 e M9 em 2026-10-17 (faltam os fronts do M5, do M8 e do M9), M10, M11 (em duas etapas, M11a e M11b) e M12 no back em 2026-10-18 (migrations até a 0026 aplicadas no banco de dev; faltam os fronts), M13 e M14 no back em 2026-10-26 (M13 sem migration; 0027 do M14 aplicada no banco de dev; faltam os fronts); próximo marco: M15.

## Contexto
O CRM já tem:
- leads com 3 camadas de campo, filtro, views, import/export, RBAC, módulo contratado e responsável;
- no front: lista, ficha (drawer), form dinâmico, página Campos e wizard de import.

A especificação transforma a página "Campos" numa área **Configurações** com 9 subseções e cobre as 6 lacunas do diagnóstico:
1. visibilidade única;
2. ordem numérica;
3. sem identificador;
4. listas fixas;
5. só "Excluir";
6. sem histórico.

O objetivo deste plano é ordenar essa entrega em fases, marcos (M) e subpartes. Cada marco tem objetivo, checklist e critério de pronto verificáveis, para que cada etapa termine estável antes da próxima.

## Decisões de arquitetura (já tomadas)

**A. Registro único de campos (`crm_field`)**
- **Contrato dos campos do sistema:** a constante da Camada 1 continua sendo o contrato (coluna, tipo, validador). Ela ganha **flags de capacidade** (`canHide`, `canMakeOptional`, `canRename`), validadas no back.
- **O que vai para `crm_field`:** só a configuração por tenant (label, ordem, ativo).
- **Tabelas filhas** com FK para `crm_field.id`: visibilidade por contexto, regras e permissões.
- **Campos do sistema:** entram via `reconcileSystemFields(tenantId)` idempotente.
  - Usa `ON CONFLICT DO NOTHING` e unique parcial em `(tenant_id, system_key)`.
  - Roda na criação do tenant, num job de deploy e de forma preguiçosa no resolver.
- **Valores não mudam de lugar:** continuam nas colunas nativas e em `custom_fields` JSONB. O JSONB passa a ser **indexado pelo id do campo** (nunca pelo label).
  - Os UUIDs de `tenant_lead_field_definitions` são reaproveitados como `crm_field.id`.
- **Resolver:** `getEffectiveFieldSchema(tenantId)`, com cache em Redis, alimenta form, tabela, filtros, importação e o schema Zod.
- **Migração:** atrás de feature flag, com **escrita dupla por uma release** antes de aposentar as tabelas antigas.

**B. Listas (`crm_option`) por chave estável**
- **Chave:** `unique (tenant_id, kind, key)`. A `key` é gerada do label (slug, com sufixo se colidir) e é **imutável**; renomear muda só o label.
- **Seed sem migrar leads:** os valores atuais dos CHECKs viram opções seed com as **mesmas chaves**. Os leads não mudam; só os CHECKs são removidos.
- **Status ganha `category`** (`open`/`won`/`lost`).
  - Relatórios, a regra "lost exige motivo" e a inatividade usam a `category`.
  - O back impede desativar a última opção `won` ou `lost`.
- **Ciclo de vida das opções:**
  - opção com leads vinculados nunca é excluída, só desativada;
  - a escrita aceita só opções ativas;
  - a leitura exibe as inativas com um selo.
- **Validação:** centralizada no resolver, gerando o schema Zod usado por form, API, import e bot.
- **Opcional:** FK composta via coluna gerada stored constante. Antes de adotar, validar com um spike no Neon (M3).

**C. Feature flags: rollout, não preço**
- **Nada fica atrás de pagamento:** tudo faz parte do módulo CRM base.
- **Para que servem as flags:** cada subseção nasce atrás de uma `tenant_module_feature` para liberação gradual e kill switch.
- **Ciclo de vida:** ao estabilizar, a feature liga por padrão para todo tenant com CRM, e a flag **sai do código em 1 a 2 releases**.
- **Custo variável:** features com custo variável (como provedor pago de CNPJ) podem ganhar cota no futuro, dentro do CRM.

## Convenções que valem para todo marco
- **Back:**
  - camadas `controller → service → adapter`;
  - `getTenantClient` só em adapters;
  - toda tabela nova com `tenant_id`, RLS e policy (exceto `crm_cnpj_cache`, que é global e documentada como exceção no `rls-coverage`);
  - migrations **aditivas** (MASTER_DOCUMENT §1.1.3).
- **Regras de negócio validadas no back** e reaplicadas no import, nunca só no front.
- **Front:** consome só o resolver (`/crm/leads/fields` evoluído) e nunca hardcoda campo. Visibilidade passa por `podeVer`.
- **Gates de todo marco:**
  - `pnpm lint` e `vitest` no back, e `pnpm lint`, `node --test` e `build` no front;
  - `test:rls-coverage` e `test:tenant-isolation` quando houver migration;
  - smoke test em **branch de dev do Neon**, nunca no banco principal.
- **Flag:** todo marco define a sua (`crm.<subsecao>`), com o comportamento antigo quando ela está desligada.
- **Documentação:** atualizar os docs do back e do front ao fechar cada marco.
- **Git:** nunca rodar git que altere estado; o usuário commita.
- **Divisão back/front:** este plano é executado por dois agentes. O do back não altera `Front/`; ao fechar cada marco, entrega ao agente do front o contrato HTTP (rotas, payloads, erros, flags) e o que a interface precisa fazer.

---

## FASE 0: Plataforma (pré-requisito)

### M0. Infraestrutura compartilhada
**Objetivo:** dar às fases seguintes flags, cache e fuso por tenant.

- **0.1 Feature flags.**
  - Criar `#core/tenant/feature-flags.js` com `featureAtiva(tenantId, featureKey)`, cache curto e invalidação, no mesmo padrão de `module-access.js`.
  - Criar o preHandler `exigirFeature(...)`.
  - Expor as flags ativas em `/auth/me` (`featuresAtivas`).
  - No front: helper `temFeature`.
- **0.2 Cache Redis.**
  - Criar `#core/cache/` com get/set/del por chave e TTL, sobre o `ioredis` existente.
  - Sem `REDIS_URL` (dev), cai num cache em memória.
  - `REDIS_URL` passa a ser recomendado também para o servidor HTTP.
- **0.3 Fuso por tenant.** Coluna `tenants.fuso_horario` (padrão `America/Sao_Paulo`), editável na área admin. O job de notificação de M9 depende dela.
- **0.4 Job de deploy.** Script `pnpm crm:reconcile` que roda as reconciliações idempotentes em todos os tenants. Ele é usado a partir de M1.

**Checklist**
- [x] O helper e o preHandler de flag têm teste unitário (cache e invalidação).
- [x] `/auth/me` devolve `featuresAtivas`, e há teste de rota.
- [x] A abstração de cache tem testes com Redis mockado e com o fallback em memória.
- [x] A migration do fuso foi aplicada e o RLS continua verde.

**Pronto quando:** uma rota de teste protegida por flag responde 403 com a flag desligada e 200 com ela ligada, e o front esconde o item de menu correspondente. *(coberto por `feature-flags.test.js` no back e `acesso.test.js` no front)*

**Como ficou (M0)**
- **Flags:** `#core/tenant/feature-flags.js` (`listarFeaturesAtivas`, `featureAtiva(tenantId, featureKey)`, `invalidarFeatures`, `exigirFeature` → 403 `FEATURE_NOT_ENABLED`). A chave já carrega o módulo (`crm.campos_v2`), por isso a assinatura não recebe `moduleKey`. Cada módulo declara o catálogo em `Module.featureFlags` (substitui o `requiredFeatureFlags`, que não era usado); o CRM usa `CRM_FEATURES` (`constants.js`). Admin: `GET /admin/features`, `PUT /admin/tenants/:id/features` (substitui o conjunto; lista vazia = kill switch) e `features` no `GET /admin/tenants/:id`. Front: `temFeature(user, flag)`, `feature` em `podeVer`/registry/`RequireRole` (sem `featuresAtivas` = desligada) e a seção "Feature flags" no detalhe do tenant.
- **Cache:** `#core/cache/cache.js` (`cacheGet/Set/Del`, `lerComCache`, `encerrarCache`), com chave prefixada `cache:` no Redis. Falha do Redis vira miss. `module-access.js` continua com o cache próprio em memória.
- **Fuso:** `tenants.fuso_horario` (migration 0011), validado e normalizado por `fusoHorarioSchema` (`#shared/validators`), editável em `PUT /admin/tenants/:id` e no card Identidade do admin.
- **Reconcile:** hook opcional `Module.reconciliar(tenantId)`; o do CRM é `reconciliarTenant` (`services/reconcile.service.js`, lista `PASSOS` vazia até M1). Scripts `pnpm reconcile [-- --modulo= --tenant=]` e `pnpm crm:reconcile`.

---

## FASE 1: Fundação de configuração

### M1. `crm_field` e resolver de schema (flag `crm.campos_v2` — removida)
**Objetivo:** ter uma única fonte de metadado de campos para todos os consumidores, sem perder dado.

- **1.1 Schema.**
  - **`crm_field`:** `id, tenant_id, system_key?, label, type, options jsonb, position, is_active`.
    - `type` cobre o sistema e o personalizado.
    - Unique parcial `(tenant_id, system_key) WHERE system_key IS NOT NULL`.
  - **`crm_field_visibility`:** `field_id, context, visible`, com o contexto como linha.
  - **`crm_field_rule`** e **`crm_field_permission`:** criadas vazias agora (usadas em M8 e M13).
  - Todas com RLS.
- **1.2 Contrato do sistema.**
  - A constante da Camada 1 vira `CAMPOS_SISTEMA`: cada campo tem `system_key`, coluna, tipo, validador e `canHide/canMakeOptional/canRename`, cobrindo as Camadas 1 e 2 de hoje.
  - `reconcileSystemFields(tenantId)` é chamado em `provisionarTenant`, no `crm:reconcile` e de forma preguiçosa no resolver.
- **1.3 Backfill.**
  - As definições de `tenant_lead_field_definitions` viram `crm_field`, **com o mesmo `id`**.
  - `tenant_lead_field_visibility` vira `crm_field_visibility`.
  - `custom_fields` dos leads é re-chaveado de `chave` para `id`, num `UPDATE` em lote idempotente.
- **1.4 Resolver.**
  - `getEffectiveFieldSchema(tenantId)` junta o contrato do sistema e a configuração do tenant.
  - Entrega `{ campos[], porContexto, zod(contexto) }`.
  - Cache Redis, invalidado em toda escrita de configuração.
- **1.5 Escrita dupla (1 release).**
  - Toda escrita de configuração grava no modelo novo **e** no antigo.
  - Toda escrita de `custom_fields` grava por `id`.
  - A leitura vem do modelo novo quando a flag está ligada.
- **1.6 Troca dos consumidores:**
  - `listarCamposDoTenant`;
  - validação de lead (substitui `validarCustomFields`/`validarCamada2Obrigatoria` pelo Zod do resolver);
  - `lead-filter`, import, export e `formatarLead`.
- **1.7 Contrato HTTP:** o payload e o filtro continuam aceitando `chave` (estável e legível), traduzida para `id` pelo resolver. **Decidido (D2): sim** — a API segue com `chave`; só o armazenamento usa `id`.
- **1.8 Aposentadoria** (release seguinte): remover a escrita dupla e as tabelas antigas, e retirar a flag.

**Checklist**
- [x] Rodar `reconcileSystemFields` duas vezes não duplica nada (teste). *(unitário: `campos-escrita-dupla.test.js`/`campos-reconcile.service.test.js`; no Postgres: `campos-v2.db.test.js`, pendente de rodar)*
- [ ] O backfill é idempotente: rodar de novo não altera nada, e as contagens batem antes e depois. *(coberto por `campos-v2.db.test.js` — rodar com `CRM_DB_TESTS=1` numa branch de dev depois da 0012)*
- [x] Com a flag ligada e desligada, `/crm/leads/fields`, a busca, o import e o export devolvem o mesmo resultado num tenant migrado (teste de paridade). *(unitário em `field-schema.service.test.js`; busca/filtro no banco em `campos-v2.db.test.js`)*
- [x] A invalidação de cache é testada: alterar um label reflete na próxima leitura.
- [x] Os testes atuais de leads, filtro, import e export continuam verdes sem mudança de expectativa. *(só os mocks mudaram: flag desligada + cache zerado)*

**Pronto quando:** um tenant migrado opera inteiro pelo modelo novo, com a flag ligada, sem diferença observável no front.

**Aposentadoria antecipada (2026-10-15).** Sem produção, os itens 1.5 e 1.8 viraram uma conversão única:
- **Migration 0014:**
  - semeia os campos do sistema (snapshot do contrato) e copia os personalizados com o mesmo `id`;
  - reescreve `custom_fields` só por `id`;
  - apaga `tenant_lead_field_definitions`/`tenant_lead_field_visibility` e as linhas da flag `crm.campos_v2`.
- **Resolver:** um caminho só (`crm_field`).
- **Reconcile:** só semeia os campos do sistema.
- **`custom_fields`:** é gravado por `id` e volta por `chave`. Valor de campo excluído (desativado) fica no banco e some da API.
- **Rotas antigas removidas** (2026-10-15, depois que o front migrou): `GET/PUT /crm/field-visibility` e `PUT /crm/field-definitions/reorder`. Ficam `POST`, `PUT :id` e `DELETE :id` de `/crm/field-definitions` (criar, editar e excluir personalizado), com as regras do M2.
- **Testes:** o teste de banco agora é `services/campos.db.test.js` (`CRM_DB_TESTS=1`).

O que está abaixo descreve a etapa intermediária, mantida como histórico.

**Como ficou (M1)**
- **Schema** (migration 0012): `crm_field` (`system_key` nulo = personalizado; `chave` = slug da API; `is_required`/`is_active`), `crm_field_visibility` (contexto como linha), `crm_field_rule` e `crm_field_permission` vazias. Filhas com FK composta `(tenant_id, field_id)`, que impede filho de outro tenant. Índices únicos parciais: um `system_key` por tenant e `chave` única só entre personalizados **ativos** (excluir libera a chave). Sem CHECK em `type`: os tipos crescem em M2/M11.
- **Contrato:** `CAMPOS_SISTEMA` + `CONTEXTOS_VISIBILIDADE` em `constants.js`, derivados das constantes de camada, com `canHide/canMakeOptional/canRename`.
- **Reconcile:** `services/campos-reconcile.service.js` (passos `campos-sistema`, `campos-personalizados`, `custom-fields-por-id`) em `PASSOS` do CRM. Roda no `pnpm crm:reconcile`, na criação do tenant e na contratação do módulo (`#core/tenant/reconcile.js`, best-effort) e de forma preguiçosa no resolver.
- **Resolver:** `services/field-schema.service.js` → `obterSchemaCampos(tenantId)` = `{ v2, visibilidade, definicoes, campos }`, mesmo formato nos dois modos, cache `crm:campos:<tenant>:v1|v2` (60 s) invalidado em toda escrita de configuração. `listarVisibilidadeDoTenant`/`listarDefinicoesPorTenant` viraram leituras dele; leads, filtro, import, export e views só passam por ali.
- **`custom_fields` por id:** escrita dupla nos dois modos (`customFieldsParaArmazenamento` grava na `chave` e no `id`, e `null` limpa os dois). A resposta HTTP volta sempre por `chave` (`customFieldsParaApi`), sem as cópias por id. No modo novo o filtro lê `custom_fields[id]` (`chaveArmazenamento`).
- **Escrita dupla de configuração:** os adapters antigos gravam também em `crm_field` na mesma transação. Excluir definição apaga no antigo e só **desativa** no novo.
- **Correção junto:** personalizado cuja chave colide com a de um campo do sistema (ex.: "Empresa") passa a dar 409.
- **Desvios do plano:**
  - **Zod gerado pelo resolver (1.6):** fica pro M2, quando os tipos novos entram no contrato. A validação continua em `leads.service`/`import.service`, mas lendo o schema do resolver.
  - **`label` dos campos do sistema:** já é gravado em `crm_field`, mas só passa a valer com o renomear (M2).
- **1.8 Aposentadoria (próxima release):** remover a escrita dupla e as tabelas antigas, rodar um passo de reconcile que apague as chaves por `chave` dos personalizados em `custom_fields` e retirar a flag `crm.campos_v2`.

### M2. Área Configurações, visibilidade por contexto, ordenação e tipos MVP
**Objetivo:** fechar as lacunas 1 e 2, e criar a casca das 9 subseções.

- **2.0 Navegação.**
  - "Campos" vira "Configurações" (`/crm/configuracoes/:secao`), com uma sidebar interna das 9 subseções.
  - As subseções ainda não entregues ficam ocultas por flag.
  - Escrita só para DONO/MASTER.
- **2.1 Visibilidade por contexto.**
  - Na UI, uma matriz Criação · Ficha · Tabela · Filtros por campo.
  - No back, `PUT` por campo e contexto, respeitando `canHide`.
  - **Consumidores:**
    - o form de criação usa `create_form`;
    - a ficha usa `detail`;
    - o seletor de colunas usa `table`;
    - o construtor de filtro usa `filter`.
  - Desligar um contexto não apaga dados.
- **2.2 Ordenação por arrastar.**
  - Lista com drag-and-drop, com alternativa por teclado (MASTER_DOCUMENT §4.3; mantém ↑/↓).
  - "Voltar ao padrão", que restaura a ordem do contrato do sistema e dos personalizados por data de criação.
  - O input numérico some.
  - No back, `PUT .../reorder` em transação.
- **2.3 Tipos MVP.**
  - Somar `texto_longo`, `monetario` (BRL), `telefone`, `email` e `url` aos atuais.
  - Cada tipo tem validador no contrato, renderizador no front e conversão no import, filtro e export.

**Checklist**
- [x] Teste de rota: OPERADOR → 403 na escrita. *(`crm.routes.test.js`: papel conferido antes das flags)*
- [x] Desligar "Filtros" de um campo o tira do construtor de filtro, e o back rejeita um filtro por ele. *(`field-schema.service.test.js`; vale pra busca, export e views salvas)*
- [x] A reordenação é atômica, e "voltar ao padrão" é testado. *(um UPDATE com `unnest … WITH ORDINALITY` numa transação)*
- [x] Cada tipo novo é validado no form, no PUT, no import (linha inválida aparece no Revisar), no filtro (operadores por tipo) e no export (formatação). *(no back; o renderizador de cada tipo fica com o front)*
- [ ] A ordenação funciona sem mouse (navegação por teclado). *(front)*

**Pronto quando:** o DONO esconde um campo só da tabela e o reordena, e o OPERADOR vê o efeito nos quatro contextos.

**Como ficou (M2, back)**
- **Rotas novas** (`controllers/configuracoes.controller.js`), **sem feature flag** (a flag `crm.configuracoes` foi removida quando o front apagou a página Campos antiga; leitura para qualquer papel, escrita só DONO/MASTER):
  - `GET /crm/configuracoes/campos`: todos os campos ativos, inclusive ocultos, com `id`, `labelPadrao`, `visibilidade` por contexto e `capacidades`.
  - `PUT /crm/configuracoes/campos/:id`: `{ label?, obrigatorio?, visibilidade? }` parcial; `label: null` volta ao nome padrão.
  - `PUT /crm/configuracoes/campos/ordem`: `{ ids }` com todos os campos.
  - `POST /crm/configuracoes/campos/ordem/padrao`.

  Escrita só DONO/MASTER; o papel é conferido antes da flag.
- **Regras de capacidade no back** (`services/configuracoes-campos.service.js`):
  - **Ocultar:** só campo com `canHide`. A Camada 1 abriu para `fonteLead`, `tags` e `ultimaInteracaoEm`; `nome`, `email`, `telefone` e `status` nunca somem.
  - **Obrigatoriedade:** obrigatoriedade fixa (`nome`/`email`/`telefone`) não muda, e campo obrigatório precisa aparecer em `create_form`.
  - **Renomear:** nome repetido dá 409.
  - **Ordem:** a lista precisa ter cada campo exatamente uma vez.
- **Resolver:**
  - **Visibilidade:** cada campo traz `visibilidade` (`create_form/detail/table/filter`) nos dois modos. No modo antigo, os quatro contextos derivam do `visivel`.
  - **Campo oculto:** oculto em todos os contextos sai da lista, e `camposDoContexto` filtra uma tela.
  - **Label e obrigatoriedade:** o label renomeado e a obrigatoriedade da Camada 1 vêm de `crm_field`.
  - **Dado na resposta:** a Camada 2 só deixa de vir na resposta quando está oculta em todos os contextos.
- **`GET /crm/leads/fields?contexto=`**: devolve só os campos de uma tela. Sem o parâmetro, o comportamento é o de antes, agora com `visibilidade` em cada campo.
- **Filtro por contexto:** busca, export e views só filtram por campo visível em `filter`.
- **Obrigatoriedade genérica** (`validarObrigatoriosNativos`): vale para qualquer nativo obrigatório visível em `create_form`, incluindo a Camada 1 configurada. Também não deixa limpar com `null`.
- **Tipos MVP** (`services/tipos-campo.service.js`): `texto_longo` (até 10.000), `monetario` (reais, até 2 casas), `telefone` (gravado só com dígitos, sem DDI), `email` (minúsculo) e `url` (http/https). Cada tipo tem validação, normalização e conversão da planilha (`R$ 1.234,56`, máscara de telefone). O filtro normaliza o valor buscado (telefone com máscara, e-mail) e tem operadores por tipo; o export sai com telefone formatado. A migration 0013 amplia o CHECK da tabela antiga por causa da escrita dupla.
- **Escrita dupla:** existiu nesta etapa (`espelharNoModeloAntigo`) e saiu com a aposentadoria.
- **Desvio:** o Zod gerado pelo resolver (pendente desde 1.6) ficou de fora outra vez. A validação por tipo agora é única (`tipos-campo.service.js`) e compartilhada por form, PUT, import e filtro, o que cobre o objetivo; a geração de schema Zod em si volta a ser avaliada no M8 (regras condicionais).

### M3. Listas configuráveis (flag `crm.listas`)
**Objetivo:** fechar a lacuna 4 (Status, Origem, Motivo de perda, Tipos de atividade, Tags).

- **3.1 Schema.**
  - `crm_option_list`, ou `kind` direto em `crm_option`.
  - `crm_option`: `tenant_id, kind, key, label, color, position, category?, is_active`, com `unique(tenant_id, kind, key)`.
- **3.2 Seed e CHECKs.**
  - Seed das opções atuais com as mesmas chaves, via reconcile.
  - Os padrões sugeridos pela spec entram só em tenant novo, porque os existentes mantêm as chaves atuais.
  - Migration que remove os CHECKs de `status`, `fonte_lead` e `motivo_perda`.
- **3.3 Regras no back:**
  - slug imutável com sufixo em colisão;
  - não excluir opção em uso, só desativar;
  - impedir desativar a última `won` ou `lost`;
  - escrita só com opção ativa (no Zod do resolver);
  - leitura marca as inativas.
- **3.4 Tags centralizadas.** Tag nova vinda do form ou do import entra na lista automaticamente (upsert por `key`).
- **3.5 Spike de FK composta** no Neon: a decisão de adotar ou não fica registrada no documento.
- **3.6 UI.**
  - Uma subseção "Listas" com abas por `kind`: editar label, cor, ordem (drag), categoria (só Status) e ativo.
  - O selo "inativa" aparece em badges e seletores.
  - A cor da opção aparece no `OpcaoBadge` sem quebrar o contraste AA (texto com contraste calculado).

**Checklist**
- [x] Os leads existentes continuam válidos depois da migration, sem nenhum `UPDATE` em `leads` (conferido no dev: todo valor gravado tem opção).
- [x] Renomear "Perdido" não quebra a regra baseada em `category` (teste em `listas.service.test.js`).
- [x] Excluir uma opção em uso → 409; desativar → some dos seletores (`opcoes`), mas o lead antigo exibe com selo (`opcoesLista[].ativo`). O selo em si é do front.
- [x] Filtro, import e export funcionam com opção nova e com opção inativa (filtro por key; import casa key ou nome de opção ativa; export sai com o nome).

**Como ficou (back, 2026-10-15):**
- **Schema (migration 0016):** `crm_option` com `kind` direto (sem `crm_option_list`): `status`, `fonte_lead`, `motivo_perda`, `tipo_atividade`, `tag`. Colunas `key` (imutável, é o que o lead grava), `label`, `color` (`#RRGGBB`), `position`, `category` (`aberto`/`ganho`/`perdido`, obrigatória em status e proibida no resto, por CHECK) e `is_active`; `unique(tenant_id, kind, key)`, RLS e FK de tenant. Os CHECKs de `status`, `fonte_lead` e `motivo_perda` em `leads` saíram.
- **Seed (reconcile, passo `listas-padrao`):** cada lista semeada uma vez. Tenant com lead recebe as keys antigas (as dos CHECKs, mais "Negociação"); sem lead, os padrões da spec. Tipo de atividade entra com o padrão da spec pra todos. Toda tag já gravada num lead vira opção com key = label = o texto. O resolver semeia de forma preguiçosa se faltar lista.
- **Resolver:** `obterSchemaCampos` traz `listas` (por kind, com as inativas) no mesmo cache dos campos. Campo de lista (`status`, `fonteLead`, `motivoPerda`, `tags`) sai com `lista`, `opcoes` (keys ativas; `null` em tags, que é livre) e `opcoesLista` (`key, label, color, category, ativo`).
- **Regras (`listas.service.js`):** key = slug do nome, com sufixo `_2`, `_3`... em colisão; nome único por lista; não exclui opção em uso (409, sugere desativar) nem a última de uma lista semeada; sempre sobra um status ativo de `ganho` e de `perdido`; lead só grava opção ativa, a não ser a que ele já tinha (o lead atual só é lido nesse caso).
- **Tags centralizadas:** no formulário, na edição e no import, a tag casa por key, nome ou slug; texto novo vira opção nova (criada só depois de validar o lead) e o lead grava a key.
- **Rotas (`controllers/listas.controller.js`), atrás de `crm.listas`; leitura pra qualquer papel, escrita DONO/MASTER:**
  - `GET /crm/configuracoes/listas`: `{ [kind]: [{ id, kind, key, label, color, position, category, ativo, usos }] }`.
  - `POST /crm/configuracoes/listas/:tipo`: `{ label, color?, category? }` → 201.
  - `PUT /crm/configuracoes/listas/:tipo/:id`: `{ label?, color? (null limpa), category?, ativo? }`.
  - `PUT /crm/configuracoes/listas/:tipo/ordem`: `{ ids }` com todas as opções da lista.
  - `DELETE /crm/configuracoes/listas/:tipo/:id`.
- **Decisão D3 (spike no Neon, Postgres 18):** a FK composta funciona com uma coluna gerada constante (`(tenant_id, 'status', status)` → `crm_option(tenant_id, kind, key)`; barra valor fora da lista; VALIDATE em 47 ms no dev). **Não adotada:** custaria três colunas geradas em `leads`, não cobre `tags` (array) e não resolve "só opção ativa" nem "não excluir em uso", que precisam de regra na aplicação de qualquer jeito — um mecanismo só pras cinco listas é mais simples.
- **Fica pro M5:** `tipo_atividade` ainda não tem onde ser usado (sem atividades), então nunca está "em uso".

**Pronto quando:** o DONO cria uma origem nova com cor, renomeia um status e desativa um motivo de perda, e nenhum lead antigo é afetado.

### M4. Layout do lead (flag `crm.layout`)
**Objetivo:** fechar a lacuna 3 (identificador, subtítulo, destaques, seções e colunas padrão).

- **4.1 Schema.**
  - `crm_layout_config`, com uma linha por tenant: identificador, subtítulo (até 2), destaques (até 4), seções em JSONB e colunas padrão.
  - `crm_user_layout_override`, com o mesmo formato, parcial.
  - Todas as referências vão para `crm_field.id`.
- **4.2 Back.**
  - `GET` do layout efetivo, que mescla o padrão do tenant com o override do usuário.
  - `PUT` do padrão (DONO) e `PUT`/`DELETE` do override ("Voltar ao padrão").
  - **Regra de mescla:** um campo novo do padrão entra no fim da lista do usuário.
  - **Validação:** o identificador precisa ser um campo de texto permitido (Nome, Empresa, CNPJ, CPF, E-mail ou personalizado de texto).
- **4.3 Busca pelo identificador.**
  - Coluna ou expressão normalizada (só dígitos para CNPJ/CPF) entra no `busca` do filtro.
  - Índice de expressão, para buscar com ou sem pontuação.
- **4.4 Front:**
  - título, subtítulo (" · ") e chips de destaque no drawer;
  - a primeira coluna da tabela é o identificador;
  - fallback: identificador vazio → Nome → "Lead sem nome";
  - máscaras por tipo (CNPJ, telefone);
  - editor visual na subseção "Layout do lead", em que o OPERADOR edita só o override;
  - colunas padrão quando não há view salva.

**Checklist**
- [x] Teste da mescla padrão + override, incluindo um campo novo adicionado depois do override (unidade e contra o banco).
- [x] Buscar `12.345.678/0001-90` e `12345678000190` acha o mesmo lead (teste contra o banco; com 20 mil leads simulados, a busca usa `idx_leads_cnpj_digitos` e leva 0,1 ms).
- [x] O fallback do identificador é testado (função pura no front, fechado em 2026-10-16). No back, identificador oculto na ficha já cai pro Nome.
- [x] O OPERADOR não consegue alterar o padrão do tenant (403).

**Como ficou (back, 2026-10-16):**
- **Schema (migration 0017):** `crm_layout_config` (uma linha por tenant, `layout` JSONB) e `crm_user_layout_override` (por usuário, `layout` parcial + `padrao_visto`), as duas com RLS e FK. Índices de expressão `(tenant_id, regexp_replace(cnpj|cpf, '[^0-9]', '', 'g') text_pattern_ops)`.
- **Formato:** `{ identificador, subtitulo[] (até 2), destaques[] (até 4), secoes[{ nome, campos[] }] (até 12), colunas[] }`. Cada item é o `id` de um campo em `crm_field` ou uma referência fixa: `lead.valor`, `lead.responsavel`, `lead.estagio`, `lead.criadoEm` (dados do lead que não são campos configuráveis; sem elas, os destaques de exemplo da spec não seriam configuráveis). Sem FK pros ids: referência a campo inativo ou oculto some na leitura.
- **Layout inicial (sem linha no banco):** identificador Nome; subtítulo E-mail · Telefone; destaques Valor, Status, Responsável; sem seções; colunas Telefone, E-mail, Status, Origem, Valor, Responsável, Criado em.
- **Resolução (`layout.service.js`):** o layout organiza, a visibilidade do M2 esconde. Identificador, subtítulo, destaques e seções usam o contexto `detail`; colunas, o `table`. Campo da ficha fora de qualquer seção vai pra uma seção automática no fim ("Dados do lead" se não há seções, "Outros campos" se há). As colunas não repetem o identificador, que é sempre a 1ª coluna.
- **Mescla:** o override substitui só o que traz. Em subtítulo, destaques e colunas, o que o DONO acrescentar ao padrão depois do override entra no fim da lista do usuário, até o limite; o que o usuário já tinha visto e tirado não volta.
- **Validação:** identificador só Nome, Empresa, CNPJ, CPF, E-mail ou personalizado de texto; referência tem que ser campo ativo (pode estar oculto agora) ou fixa; sem repetir item numa lista nem campo em duas seções; nome de seção único; padrão exige o layout completo, override aceita parcial.
- **Busca (M4.3):** o identificador do padrão do tenant entra na `busca`. CNPJ/CPF compara só os dígitos com LIKE de prefixo (a expressão dos índices); outro identificador de texto, ILIKE. Nome e E-mail já estavam na busca.
- **Resolver:** os campos da Camada 1 e 2 de `GET /crm/leads/fields` agora trazem o `id` em `crm_field` (referência do layout).
- **Front (2026-10-16):** as views salvas guardam só filtro; `efetivo.colunas` vale pra quem ainda não escolheu colunas na tabela (escolha guardada no navegador). `lead.estagio` mostra `estagio_nome`, que vem em toda leitura e também na resposta do `PUT /crm/leads/:id`. O OPERADOR entra em Configurações › Layout do lead (com `crm.layout`); Campos e Listas seguem só pra DONO e MASTER.
- **Rotas (`controllers/layout.controller.js`), atrás de `crm.layout`:** `GET /crm/layout` e `PUT`/`DELETE /crm/layout/meu` pra qualquer papel; `PUT /crm/layout/padrao` só DONO/MASTER. Toda resposta é `{ padrao, padraoConfigurado, meu, efetivo }`.

**Pronto quando:** um tenant B2B configura CNPJ como identificador e Empresa · Cidade como subtítulo, e a tabela, o drawer e a busca refletem isso.

### M5. Arquivar e lixeira (flag `crm.arquivo`)
**Objetivo:** fechar a lacuna 5 na parte destrutiva.

- **5.1 Schema.** `leads.archived_at` e `leads.deleted_at`, com índices parciais.
- **5.2 Back.**
  - Arquivar e desarquivar.
  - "Excluir" vira soft delete, com restauração possível por 30 dias.
  - Purga definitiva por job agendado (BullMQ, diário).
  - Toda leitura, busca, export e deduplicação ignora `deleted_at`.
  - Os arquivados ficam fora do padrão, com o filtro fixo `situacao: ativos|arquivados|lixeira`.
- **5.3 Front:**
  - "Arquivar" substitui o botão vermelho de destaque;
  - "Excluir" vai para o menu "…";
  - página ou filtro de Lixeira com "Restaurar";
  - filtro "Arquivados".

**Checklist**
- [x] Teste de que nenhuma consulta de lead vaza registro com `deleted_at` (busca, detalhe, export, import/dedup e contagem) — contra o banco, em `campos.db.test.js`.
- [x] Restaurar dentro de 30 dias funciona; o job purga depois do prazo (teste com relógio falso em `arquivo.service.test.js` e, contra o banco, um lead excluído há 31 dias).
- [x] Ninguém consegue editar um lead da lixeira (404).

**Como ficou (back, 2026-10-16):**
- **Schema (migration 0018):** `leads.archived_at` e `leads.deleted_at` (TIMESTAMP em UTC, como `created_at`), com os índices parciais `idx_leads_arquivados` e `idx_leads_lixeira`. Um lead pode ter os dois: restaurar devolve ele pra onde estava (arquivado continua arquivado).
- **Situação na busca:** `situacao: ativos | arquivados | lixeira` (padrão `ativos`) em `POST /crm/leads/search`, nas views salvas e no export. `montarCondicoes` sempre começa pela condição da situação, então nenhuma consulta montada ali vê a lixeira sem pedir. A lixeira só mostra o que foi excluído há menos de 30 dias: passado o prazo, o lead já conta como apagado mesmo antes da purga. Lead da lixeira volta com `purga_em`.
- **Fora da busca:** detalhe e edição ignoram a lixeira (404); a deduplicação do import também (reimportar cria de novo), mas conta o arquivado, que continua existindo. Export da lixeira → 400.
- **Contagem de uso** (opção de lista em uso, campo com valor): continua contando lead da lixeira, porque ele pode ser restaurado.
- **Flag `crm.arquivo`:** guarda `POST /crm/leads/:id/arquivar`, `/desarquivar` e `/restaurar`, e as situações `arquivados`/`lixeira` (403 `FEATURE_NOT_ENABLED`). O `DELETE /crm/leads/:id` é lixeira sempre, com ou sem a flag (sem ela só não há tela pra restaurar). Com a flag desligada, `ativos` inclui os arquivados: o kill switch não esconde lead.
- **Purga:** `src/workers/crm.worker.js` (antes `crm-import.worker.js`; `pnpm worker:crm`) consome também a fila `crm-manutencao` e, ao subir, agenda a purga com `upsertJobScheduler` (idempotente) às 3h de Brasília. Roda em todo tenant que já contratou o CRM, mesmo cancelado; um tenant que falha não para os outros. O DELETE da purga segue as FKs de antes (CASCADE/SET NULL).
- **Permissão:** qualquer papel arquiva, exclui e restaura (como o "Excluir" de antes); restrição por papel fica pro marco de permissões.

**Pronto quando:** arquivar, restaurar e excluir funcionam pela tela, e a purga roda no worker.

**Marco da Fase 1:** área Configurações com Campos, Listas e Layout no ar; arquivo e lixeira; flags `crm.listas`, `crm.layout` e `crm.arquivo` ligadas por padrão; tabelas antigas aposentadas.

---

## FASE 2: Qualidade de dados

> **Ordem ajustada em relação à spec:** atividades e histórico vêm **antes** da inatividade, porque "atividade concluída" e "atividade agendada pausa" são os gatilhos do contador. A timeline completa na interface continua na Fase 3 (M16).

### M6. Atividades e histórico (base) (flag `crm.atividades`)
**Objetivo:** criar a entidade de atividade e o registro de mudanças, que a inatividade, a mesclagem e a timeline usam.

- **6.1 Schema.**
  - `crm_activity`: `lead_id, tipo (crm_option kind=atividade), titulo, notas, agendada_para, concluida_em, autor_id`.
  - `crm_lead_event`: tipo, autor, `diff` em JSONB e data, append-only. Avaliar reaproveitar o `audit_log` do core para eventos administrativos.
- **6.2 Back.**
  - CRUD de atividades.
  - Concluir uma atividade atualiza `ultima_interacao_em`.
  - A atualização de lead registra o diff dos campos no evento; o autor vem do token.
- **6.3 Front (mínimo).** Aba "Atividades" no drawer: registrar, concluir e listar.

**Checklist**
- [x] Concluir uma atividade e mudar o status atualizam `ultima_interacao_em`; editar um campo não atualiza (D1 fechada; teste contra o banco).
- [x] O evento guarda o antes e o depois só dos campos alterados (teste puro do diff e contra o banco). Na leitura, campo desligado ou personalizado excluído sai do diff; a permissão por campo entra quando o M13 existir.
- [x] RLS e isolamento verdes (`rls-coverage`, `fk-coverage`, `tenant-isolation`).

**Como ficou (back, 2026-10-16):**
- **Schema (migration 0019):** `crm_activity` (`tipo` = key da lista `tipo_atividade`, sem FK como as outras listas; `agendada_para`, `concluida_em`, `autor_id` com `ON DELETE SET NULL`) e `crm_lead_event` (`tipo`, `autor_id`, `diff` JSONB, `created_at`). As duas com RLS, FK pro tenant e `ON DELETE CASCADE` no lead (a purga do M5 leva junto).
- **Append-only:** trigger barra qualquer UPDATE em `crm_lead_event`, menos mudar `lead_id` (a mesclagem do M7 vai mover o histórico) e `autor_id` virar NULL (usuário removido). DELETE fica liberado porque o evento segue o lead. **Não reaproveita o `audit_log` do core:** lá o DELETE é bloqueado por trigger, o que impediria a purga, e o formato é de ação administrativa, não de diff.
- **Eventos gravados:** `criado`, `atualizado`, `arquivado`, `desarquivado`, `excluido`, `restaurado`, sempre na mesma transação da mudança e com o autor do token. São gravados com ou sem a flag; ela só libera a leitura. Arquivar o que já está arquivado não grava nada. O import ainda não grava evento (autor = sistema): fica pro M7, que refaz a deduplicação do import.
- **Diff (`historico.service.js`, função pura):** só os campos que mudaram, com antes e depois serializáveis (data em ISO, NUMERIC em número). A chave é o que não muda: `systemKey` pros campos do sistema, `valor`/`funilEstagioId`/`usuarioResponsavelId` pros dados do lead e `campoId` (`crm_field.id`) pro personalizado. O estágio guarda também o nome do momento. O UPDATE lê o lead de antes com `FOR UPDATE`, na mesma transação. Label, tipo e opções vêm do schema na leitura: renomear um campo não reescreve o histórico.
- **Interação (D1):** mudar o status atualiza `ultima_interacao_em` no próprio UPDATE (o `CASE` compara com o status de antes; status igual não conta); concluir uma atividade leva a data pra conclusão, nunca pra trás. Editar outro campo, agendar ou reabrir atividade não mexe. Quando é a regra de status que muda `ultimaInteracaoEm`, ele não entra no diff.
- **Atividades:** tipo só de opção ativa (ou o que a atividade já tinha). Criar com `concluida: true` registra algo que já aconteceu. Lead na lixeira → 404. "Em uso" do tipo de atividade agora conta as atividades (excluir opção em uso → 409). Qualquer papel cria, edita e remove; restrição por papel fica pro M13.
- **Rotas (`controllers/atividades.controller.js`), atrás de `crm.atividades`, qualquer papel:** `GET /crm/atividades/tipos` (opções da lista pro formulário, sem depender de `crm.listas`, pedido do front em 2026-10-16), `GET`/`POST /crm/leads/:id/atividades`, `PUT`/`DELETE /crm/leads/:id/atividades/:atividadeId` e `GET /crm/leads/:id/historico?pagina=&tamanho=`.

### M7. Duplicidade e mesclagem (flag `crm.duplicidade`)
**Objetivo:** detecção configurável de duplicados e uma mesclagem segura.

- **7.1 Schema.** `crm_duplicate_rule` (campos, método e ação `warn`/`block`, ativo).
- **7.2 Normalizadores puros:**
  - e-mail em minúsculas com trim;
  - telefone só com dígitos, sem +55 e com ou sem o 9 após o DDD;
  - CNPJ só com dígitos ou alfanumérico (novo formato);
  - CPF só com dígitos.

  Colunas ou índices normalizados para a busca ser rápida.
- **7.3 Aplicação:** `POST`/`PUT` de lead (`warn` devolve candidatos, `block` responde 409 com o id existente), import (o Revisar marca a linha com pular, atualizar ou criar, substituindo o dedup fixo de hoje) e API.
- **7.4 Mesclagem.**
  - `POST /crm/leads/merge` com escolha campo a campo.
  - Une atividades, tags e eventos e faz soft delete do descartado.
  - O evento de auditoria guarda o id original. Tudo numa transação.
- **7.5 Front:**
  - subseção "Duplicidade";
  - aviso e bloqueio no form;
  - dialog de mesclagem (pelo "…" e pela seleção de 2 leads).
- **Fase 2 da spec:** o "Nome + Empresa aproximado" (`pg_trgm`) fica atrás de um spike de extensão no Neon.

**Checklist**
- [x] Os normalizadores têm casos com e sem 9 e com e sem +55 (teste puro; as mesmas chaves conferidas contra as funções SQL no dev).
- [x] `warn` deixa salvar (confirmando), e `block` impede e devolve o existente pra abrir (teste contra o banco).
- [x] A mesclagem é atômica; se falhar no meio, nada muda (teste contra o banco: falha de FK depois de mover as atividades, e as atividades continuam no secundário).
- [x] O import aplica as mesmas regras do form (teste contra o banco, incluindo a linha repetida dentro da planilha).

**Como ficou (back, 2026-10-16):**
- **Decisões do usuário:** "Avisar" pede confirmação antes de salvar (409 `DUPLICATE_WARNING`; salva com `ignorarDuplicados: true`); mesclar é só DONO/MASTER.
- **Normalização no banco (migration 0020):** colunas geradas `dedup_email`, `dedup_telefone`, `dedup_cnpj`, `dedup_cpf`, com as funções IMMUTABLE `modulo_crm.chave_telefone` (só dígitos, sem 55, sem o 9 depois do DDD) e `chave_documento` (maiúsculas, só [0-9A-Z]: cobre o CNPJ alfanumérico). Índices `(tenant_id, coluna) WHERE deleted_at IS NULL`. Os normalizadores JS (`chaveTelefone`, `chaveDocumento`, `chaveEmail` em `tipos-campo.service.js`) são o espelho das funções SQL.
- **Busca do identificador (M4):** CNPJ/CPF passam a usar `dedup_cnpj`/`dedup_cpf` com prefixo; os índices de dígitos da 0017 saíram. Com isso o CNPJ alfanumérico também é encontrado.
- **Regras (`crm_duplicate_rule`):** uma por campo (`email`, `telefone`, `cnpj`, `cpf`), ação `warn`/`block`. Sem linha no banco: e-mail e telefone avisam, CNPJ e CPF desligados. Lixeira não conta, arquivado conta. O "Nome + Empresa aproximado" (D4, `pg_trgm`) não entrou: seria um campo novo de regra.
- **Formulário e API:** `POST`/`PUT /crm/leads` checam depois do resto válido. No PUT, só o que muda de verdade (pela chave normalizada), sem contar o próprio lead. `POST /crm/leads/duplicados` checa sem salvar (lista vazia com a flag desligada). Candidatos em `error.details.duplicados`: `[{ id, nome, campos: [{ campo, label }], acao }]`, até 5.
- **Import:** o validate devolve `duplicados` por linha (uma consulta pra planilha toda) e marca a linha no payload; o confirm aceita `acoes` por linha (`criar` onde bloqueia → 400). O worker confere de novo por linha, o que pega a repetição dentro da planilha; linha com bloqueio e ação `criar` é ignorada com o motivo no relatório. Sem a flag, o import usa as regras padrão (o dedup de antes, agora com e sem o 9). O import passou a gravar `criado`/`atualizado` no histórico, com quem importou de autor (pendência do M6).
- **Mesclagem (`POST /crm/leads/merge`):** uma transação só. Trava os dois leads (ordem de id), monta os dados (função pura `montarMesclagem`: escolha por campo; sem escolha, o do principal ou o do secundário se o principal estiver vazio; tags unidas; última interação a mais recente), move atividades e eventos, atualiza o principal com o evento `mesclado` (diff + `detalhes.leadDescartadoId`/`nomeDescartado`; `crm_lead_event.detalhes` é novo) e manda o secundário pra lixeira com `mesclado_em_id`. Restaurar o descartado → 409. Toda leitura do lead traz `mesclado_em_nome` junto do `mesclado_em_id` (pedido do front em 2026-10-17, pra lixeira mostrar "Mesclado em {nome}"). A FK `mesclado_em_id` é `ON DELETE CASCADE` (migration 0021): apagar o principal por qualquer caminho leva o descartado junto, então um lead mesclado nunca fica com `mesclado_em_id` nulo (com SET NULL, o descartado viraria um lead comum restaurável e vazio).
- **Rotas:** `GET`/`PUT /crm/configuracoes/duplicidade` (leitura qualquer papel, escrita DONO/MASTER) e `POST /crm/leads/merge` (DONO/MASTER), atrás de `crm.duplicidade`; `POST /crm/leads/duplicados` e o `ignorarDuplicados` não dependem da flag.

### M8. Obrigatoriedade por status e condicional (flag `crm.regras`)
**Objetivo:** "Status = Perdido exige Motivo" e regras do tipo "se A = X, B fica visível e/ou obrigatório".

- **8.1** `crm_field_rule` com `kind` (`required`, `required_from_status`, `conditional`) e `condition` em JSONB, aproveitando o mesmo vocabulário de operadores do filtro.
- **8.2** O resolver gera um Zod com `superRefine` a partir das regras e o aplica na criação, na edição (contra o lead resultante, não só contra o payload) e no import.
- **8.3** No front, as mesmas regras são avaliadas por função pura, só para UX: o campo dependente aparece ou some e o obrigatório é marcado. A validação real é no back.
- **8.4** Seed da regra `category=lost → motivo_perda obrigatório`, desligável.

**Checklist**
- [x] Teste de que uma edição parcial que muda só o status para "lost" sem motivo dá 400 (unidade e contra o banco).
- [x] O import reporta a linha que viola uma regra (validate: nos `erros` da linha; worker: atualização que violaria vai pro relatório e não grava).
- [ ] A função pura do front e o avaliador do back concordam: os casos estão em `src/modules/nucleo/crm/testing/regras.casos.json` (17 casos, o back roda todos); falta o front rodar os mesmos.

**Como ficou (back, 2026-10-17):**
- **Decisões do usuário:** "obrigatório a partir de um status" = conjunto de status e/ou categorias (não depende da ordem dos status); uma condição por regra (pra "A ou C", duas regras pro mesmo campo).
- **Schema (migration 0022):** `crm_field_rule` já existia vazia desde a 0012 (filha de `crm_field`, FK composta com o tenant); ganhou `effect`, `system_key` (unique parcial) e `updated_at`, e o CHECK de `kind` ficou só com `required_from_status` e `conditional` (o "sempre obrigatório" é o `is_required` do M2). Nomes de coluna em inglês, como a 0012.
- **Formato:** `required_from_status` → `condition = { status?, categorias? }`, efeito sempre obrigatório; `conditional` → `condition = { campoId, operador, valor? }` com os operadores do filtro (validados pelo mesmo `montarCondicoes`), `effect = { obrigatorio?, visivel? }`. O alvo é `field_id` (o `id` de `crm_field`, mesma referência do layout).
- **Avaliação (`regras-campos.service.js`, puro):** obrigatório = alguma regra com `obrigatorio` casa; oculto = o campo tem regra com `visivel` e nenhuma casa (só aparece quando...); oculto nunca é obrigatório. Contra o lead RESULTANTE: criação = payload; edição = lead atual + payload; import = a linha (validate) ou o lead mesclado (worker, ao atualizar). **Desvio do texto do plano:** em vez de gerar um Zod com `superRefine`, uma função pura de validação — mesmo efeito, no mesmo padrão de `validarObrigatoriosNaCriacao`, e é a mesma função que o front espelha.
- **Regra semeada:** "categoria perdido → Motivo da perda obrigatório" (`system_key = motivo_perda_em_perdido`), pelo passo de reconcile `regras-padrao` e de forma preguiçosa na leitura do schema. Liga/desliga, não exclui (409). Só vale com o Motivo da perda ligado (Camada 2): regra cujo alvo ou campo da condição está desligado ou excluído some.
- **Cache:** as regras moram no mesmo cache do schema (`crm:campos:<tenant>`); toda escrita de regra invalida.
- **Flag `crm.regras` desligada:** nada é aplicado, nem a regra semeada (comportamento de antes).
- **Rotas (`controllers/regras.controller.js`), atrás de `crm.regras`:** `GET /crm/configuracoes/regras` (qualquer papel — o formulário usa) e `POST`/`PUT /:id`/`DELETE /:id` (DONO/MASTER). **Ajuste do plano:** `GET /crm/leads/fields` NÃO ganhou `regras` (mudaria a resposta de lista pra objeto e quebraria o contrato); o formulário lê `GET /crm/configuracoes/regras`.

### M9. Lead esfriando (flag `crm.inatividade`)
**Objetivo:** dias até esfriar por status, com indicador, filtro, view e notificação.

- **9.1** `crm_stale_config` (opção de status → dias), com seed das sugestões e `won`/`lost` desligados.
- **9.2 Cálculo.**
  - Grava `leads.stale_since`. Um job (BullMQ, de hora em hora) recalcula, e o recálculo também acontece no evento de interação.
  - **Pausa:** uma atividade agendada no futuro pausa a contagem até a data dela.
- **9.3** Filtro fixo "Esfriando", uma view padrão do sistema e o indicador "esfriando há N dias" na tabela e no drawer.
- **9.4 Notificação in-app.**
  - Tabela `notificacoes` no core, com `GET` e marcar como lida.
  - Sino no shell do front.
  - Job diário às 8h no fuso do tenant (M0.3).

**Checklist**
- [x] Teste do cálculo com relógio falso: limite, pausa por atividade agendada e reset por interação (contra o banco, `agora` como parâmetro).
- [x] O job é idempotente e não gera notificação duplicada no mesmo dia (unique `chave_dedup` com a data local; teste contra o banco roda duas vezes).
- [x] O filtro "Esfriando" e o indicador batem com o cálculo do back (mesma expressão SQL; o front não calcula, só mostra `esfriando_desde`).

**Como ficou (back, 2026-10-17):**
- **Decisões do usuário:** calcular na leitura (sem `stale_since` gravado nem job de recálculo); resumo diário por usuário ("Você tem N leads esfriando"); os esfriando sem responsável (ou com responsável desativado) vão num resumo à parte pros DONOs ativos. D5 fechada: notificação no core.
- **Desvios do plano/spec:** (1) **nada é gravado no lead** — `esfriando_desde` sai de uma expressão SQL única (`adapters/crm-inatividade.sql.js`), usada pela leitura, pelo filtro e pelo job; mudar o relógio, os dias ou uma atividade vale na próxima leitura. (2) **Sem `crm_stale_config`**: os dias são a coluna `crm_option.stale_days` (só status; NULL = desligado), que segue o ciclo de vida da opção.
- **Regra:** base = `GREATEST(COALESCE(ultima_interacao_em, created_at), maior agendada_para de atividade em aberto)`; esfria em base + dias. Atividade agendada pausa até a data dela; vencida e não concluída conta dali. Reset = o que já mexe em `ultima_interacao_em` (status, atividade concluída — D1). Arquivado/lixeira nunca esfria.
- **Seed:** sugestões da spec (novo 1, em contato 3, qualificado 5, proposta 7, negociação 7; ganho/perdido desligados) — pela migration 0023 nos tenants existentes e pelo reconcile das listas nos novos. Status criado pelo DONO nasce desligado.
- **Flag `crm.inatividade` desligada:** a expressão nem entra na query (`esfriando_desde: null`), `esfriando: true` na busca → 403, a view do sistema some e o job pula o tenant.
- **Filtro e view:** `esfriando: true` no filtro (busca, export, views salvas). A view "Esfriando" é do sistema (`id: 'esfriando'`, `sistema: true`), não fica no banco e vem primeiro em `GET /crm/filter-views`.
- **Config:** `GET /crm/configuracoes/inatividade` (qualquer papel) e `PUT` (DONO/MASTER) com `{ status: { <key>: dias | null } }`, dias 1–365; dias em status ganho/perdido → 400.
- **Notificações (core):** tabela `public.notificacoes` (RLS + GRANT explícito ao `app_tenant`), `#core/notificacoes` (`criarNotificacoes` idempotente por `chave_dedup`) e rotas `GET /notificacoes`, `POST /notificacoes/:id/lida`, `POST /notificacoes/lidas` (só as do usuário do token).
- **Job:** `crm-manutencao`, de hora em hora (`notificar-esfriando`); em cada tenant com o CRM ativo e a flag ligada, só a partir das 8h no fuso do tenant; chave `crm.esfriando:<data local>`. O worker despacha os jobs da fila pelo nome.

### M10. Edição em massa, exportação aprimorada e primeiro nome (flag `crm.massa`)
- **10.1** Checkbox na tabela e uma barra de ações: Status, Responsável, Tags e Origem (depois, campos personalizados).
  - No back, `PATCH /crm/leads/bulk` com limite de quantidade.
  - Aplica regras, permissões e duplicidade por lead e devolve um relatório por id.
- **10.2** Export com formato `.xlsx` ou `.csv` e seletor de campos que **respeita a view atual** (filtro e colunas). O export já respeita filtro e colunas hoje; falta o CSV e herdar a view por padrão.
- **10.3** "Primeiro nome": campo do sistema derivado do Nome e editável, para personalizar mensagens.
- **10.4** Confirmar que o passo Mapear lista os campos personalizados como destino (já lista; cobrir com teste).

**Checklist**
- [x] O relatório da edição em massa traz o resultado parcial (teste com um lead atualizado, um barrado por regra do M8, um inexistente e um sem mudança).
- [x] O CSV sai no formato do Excel pt-BR (separador `;`, BOM UTF-8, vírgula decimal; teste do conteúdo). *(abrir no Excel de verdade fica pro smoke)*
- [x] O primeiro nome é derivado e editável (teste puro das regras e do import).
- [x] O passo Mapear lista os personalizados como destino (teste em `import.service.test.js`).

**Como ficou (back, 2026-10-18):**
- **Decisões do usuário:** edição em massa pra qualquer papel (como o PUT de um lead); tags por adicionar/remover; seleção por lista de ids; o primeiro nome segue o Nome enquanto não foi editado à mão.
- **Edição em massa (`PATCH /crm/leads/bulk`, atrás de `crm.massa`):** `{ ids (1–200, sem repetir), alteracoes: { status?, fonteLead?, usuarioResponsavelId? (null tira), tags?: { adicionar?, remover? } } }`, com ao menos uma alteração. Lead a lead, em sequência, pelo mesmo `atualizarLeadExistente` do PUT: opção ativa, responsável ativo, regras do M8 contra o lead resultante, histórico e `ultima_interacao_em` ao mudar o status. Só o que muda em cada lead entra; lead sem mudança sai `inalterado` (sem evento). Tags: as do lead menos as removidas (casadas por key, nome ou slug, `buscadorDeTags`) mais as adicionadas; texto novo vira tag como no formulário. Resposta 200 sempre: `{ total, atualizados, inalterados, falhas, resultados: [{ id, ok, inalterado?, erro?: { statusCode, code, message, fields? } }] }`. Erro que não é de negócio sai genérico (`INTERNAL_ERROR`), sem detalhe de banco. Cada lead tem as suas transações: não é tudo-ou-nada.
- **Export (`POST /crm/export`):** `formato: xlsx | csv` (padrão xlsx) e `colunas` opcional. Sem `colunas`, saem as da tabela do usuário: o identificador e as colunas do layout efetivo (M4). Com isso o export passou a aceitar `usuarioResponsavelId` (nome do responsável ativo; desativado sai vazio) e `createdAt`, só no export (não viram destino do import). CSV: `;`, BOM UTF-8, CRLF, vírgula decimal, data `dd/mm/aaaa` (UTC, como o .xlsx) e apóstrofo na frente de texto que começa com `= + - @` (CSV injection). **Flag `crm.massa` desligada:** `csv` → 403 e `colunas` continua obrigatória (400). "Herdar a view" é do front: ele já manda os filtros da view; o back só resolve as colunas.
- **Primeiro nome (migration 0024):** `leads.primeiro_nome` (coluna comum, editável), com backfill = a primeira palavra do nome, sem mexer em `updated_at` (trigger desligado durante o UPDATE). Campo do sistema na Camada 1 (`primeiroNome`, no fim da ordem padrão; pode ocultar, renomear e tornar obrigatório), semeado pelo reconcile. Regra em `services/primeiro-nome.service.js` (pura), usada pelo formulário e pelo import: criação sem ele → derivado; mudar o nome rederiva só se o atual ainda era o derivado do nome antigo; `null`/vazio volta ao derivado. **Desvio:** sem flag — é um campo do sistema comum, gravado sempre (como os eventos do M6).
- **Mapear (10.4):** já listava os personalizados; agora tem teste.

### M11. Tipos de campo avançados e enriquecimento por CNPJ (flag `crm.cnpj`)
- **11.1 Tipos "Depois" da spec:**
  - CPF, CNPJ (incluindo o alfanumérico) e CEP, com máscara e dígito verificador;
  - endereço;
  - usuário (lookup de membro, via `/crm/usuarios`);
  - intervalo de datas;
  - hora.
- **11.2** `crm_cnpj_cache` global (sem `tenant_id`, por ser dado público, com TTL de 30 dias). É a exceção documentada no teste de cobertura de RLS.
- **11.3 Provedor.**
  - BrasilAPI como primário e um provedor pago como opção, ambos atrás de um adapter de provedor.
  - Fila BullMQ com rate limiter por provedor.
  - O import de 5.000 linhas enfileira os CNPJs.
- **11.4** Configuração: ligar e desligar, modo manual (lupa) ou automático, mapeamento entre dado da Receita e campo, e se sobrescreve. Cada consulta gera um evento na timeline (M6).

**Checklist**
- [x] O cache evita uma segunda chamada (teste com o provedor mockado; o TTL de 30 dias é conferido na leitura).
- [x] O rate limit é respeitado: limiter do BullMQ no worker (`opcoesDoWorkerCnpj`, testado); 429 do provedor volta pra fila. *(o throttling em si é do BullMQ; conferir no smoke com Redis)*
- [x] "Não sobrescrever" é respeitado (só preenche o vazio; teste do job).
- [x] Uma falha do provedor não bloqueia salvar o lead (fila e provedor fora do ar testados; a lupa responde 503 e o formulário segue).

**Decisões do usuário (2026-10-18):** entregar em duas etapas (M11a tipos, M11b CNPJ); CPF/CNPJ/CEP nativos passam a usar os tipos novos só nas escritas novas; só BrasilAPI por enquanto (adapter pronto pra um pago); a lupa mostra os dados e o usuário aplica no formulário.

**Como ficou (M11a, back, 2026-10-18):** tipos novos, sem migration (`crm_field.type` não tem CHECK) e **sem flag** (como os tipos MVP do M2).
- **Formato gravado:**
  - `cpf`: 11 dígitos, com dígito verificador; todos iguais é recusado.
  - `cnpj`: 14 caracteres `[0-9A-Z]` (`chaveDocumento`), DV do CNPJ alfanumérico (caractere = ASCII − 48, pesos 2–9); cobre o numérico.
  - `cep`: 8 dígitos (CEP não tem DV).
  - `hora`: `HH:MM`.
  - `usuario`: uuid de usuário ativo do tenant; o service confere numa consulta só, e só se o payload tiver algum.
  - `intervalo_datas`: `{ de, ate }` em `AAAA-MM-DD`, de ≤ ate.
  - `endereco`: objeto com as partes de `PARTES_ENDERECO` (cep, logradouro, numero, complemento, bairro, cidade, uf), só as preenchidas e nessa ordem (sem diff falso no histórico).
- **Validadores e máscaras genéricos** em `#shared`: `cpfValido`/`cnpjValido` (`#shared/validators`), `formatarCpf`/`formatarCnpj`/`formatarCep` (`#shared/formatters`), constantes em `BRAZIL_DOCUMENTS`.
- **Nativos (Camada 2):** `cpf`, `cnpj` e `cep` mudaram de `texto` pros tipos novos. Formulário e PUT validam e gravam sem máscara (400 no campo); o import usa a mesma conversão por tipo. Lead antigo com máscara fica como está até ser editado.
- **Filtro:**
  - CPF/CNPJ nativos usam `dedup_cpf`/`dedup_cnpj` (já normalizadas, cobrem linha antiga); CEP compara só os dígitos.
  - Operadores: hora tem `igual`/`entre` (cast pra `time`); intervalo só `entre` (= sobreposição); endereço `contem` procura nos valores das partes (`jsonb_each_text`), não no nome das chaves; usuário tem `igual`/`e_um_dos`.
  - Objeto vazio conta como vazio.
- **Regras do M8:** o avaliador compara do mesmo jeito; 5 casos novos em `testing/regras.casos.json` (o front roda os mesmos).
- **Import:** documento em célula numérica recupera o zero da frente; hora aceita `14:30`, fração do dia do Excel ou célula de hora; período `dd/mm/aaaa - dd/mm/aaaa` (ou `a`/`até`; uma data só = um dia); usuário pelo nome (sem diferenciar maiúscula); endereço numa célula vai inteiro pro logradouro.
- **Export:** máscara de CPF/CNPJ/CEP; endereço numa linha; período `dd/mm/aaaa – dd/mm/aaaa`; usuário pelo nome.
- **Fora do escopo:** o identificador do layout continua só com personalizado de texto.

**Como ficou (M11b, back, 2026-10-18):** enriquecimento por CNPJ, atrás de `crm.cnpj`. Migration 0025 **ainda não aplicada**.
- **Schema (migration 0025):**
  - `crm_cnpj_cache`, **global**: sem `tenant_id` nem RLS, de propósito (dado público; o mesmo CNPJ em dois tenants custa uma chamada). Guarda `cnpj` (PK), `status` (`ok`/`nao_encontrado`), `dados` no formato do CRM, `provedor` e `consultado_em`. TTL de 30 dias conferido na leitura. A exceção está documentada na migration e travada em `rls-coverage.test.js` (a tabela tem que continuar sem `tenant_id`).
  - `crm_cnpj_config`: uma linha por tenant, com RLS. Guarda `ativo`, `modo` (`manual`/`automatico`), `sobrescrever` e `mapeamento` (dado da Receita → `id` do campo). Sem linha = padrão: ligado, manual, sem sobrescrever; razão social → Empresa, município → Cidade, UF, CEP, endereço → Endereço, só os campos ativos no tenant.
- **Provedor (`adapters/cnpj-brasilapi.provider.js`):**
  - Primeira chamada HTTP externa do repo: `fetch` nativo, timeout de 5 s.
  - 404 → `nao_encontrado` (vai pro cache); 429, 5xx e erro de rede → erro transitório.
  - CNPJ alfanumérico → `nao_suportado` sem chamar (a BrasilAPI só aceita numérico); não vai pro cache.
  - Um provedor pago entra como outro adapter com a mesma forma `{ nome, consultar }`.
- **Lupa (`GET /crm/cnpj/:cnpj`):**
  - Qualquer papel. Devolve `{ cnpj, status, dados, sugestao: [{ campoReceita, chave, label, camada, valor }] }`.
  - O valor da sugestão já vem no tipo do destino: endereço como objeto no tipo `endereco` e numa linha em campo de texto; telefone e CEP sem máscara. Valor que não passa no tipo fica de fora.
  - Não grava no lead: o front preenche e o usuário salva (evento `atualizado` normal). **Desvio:** a consulta manual não gera evento próprio.
  - Provedor fora do ar → 503 `EXTERNAL_SERVICE_UNAVAILABLE` (código novo em `ERROR_CODES`). DV errado → 400.
  - `ativo: false` nas configurações também desliga a lupa (403 `FORBIDDEN`, sem consultar o provedor).
  - A lupa não tem rate limit próprio (só o worker tem): uso em excesso vira 429 do provedor, que a lupa devolve como 503.
  - Cada item da `sugestao` traz também o `tipo` do campo de destino.
- **Automático (modo `automatico`):**
  - O que dispara: criar lead com CNPJ, PUT que manda `cnpj`, e import (uma leva no fim do lote). O CNPJ é o nativo da Camada 2; personalizado do tipo `cnpj` não dispara.
  - Enfileira na fila `crm-cnpj` (`jobId` tenant:lead:cnpj, 3 tentativas com espera exponencial). Erro de fila ou Redis ausente é engolido: **salvar o lead nunca falha por causa disso**.
  - Worker: `limiter` do BullMQ (padrão 3 por segundo; env `CNPJ_LIMITE_MAX`/`CNPJ_LIMITE_JANELA_MS`), um job por vez.
  - O job confere de novo flag, modo e lead (pula se o CNPJ mudou), consulta (cache primeiro) e aplica com `atualizarLead`, autor nulo e evento `enriquecido` (`detalhes: { cnpj, provedor }`).
  - Sem `sobrescrever`, só preenche campo vazio. As regras do M8 não são aplicadas aqui: é preenchimento do sistema, não edição do usuário.
  - E-mail e telefone nativos respeitam a duplicidade (M7): campo que cairia num bloqueio fica de fora, e o resto é gravado. Aviso passa, porque o sistema não tem como confirmar (mesmo critério do import com `criar`).
  - Data nativa é gravada como `Date`, como no import.
  - Erro que não é transitório vira `UnrecoverableError` (falha uma vez, sem repetir à toa).
  - `jobId` com `_`, não `:`: o BullMQ só tolera `:` em id por compatibilidade.
- **Config (`GET`/`PUT /crm/configuracoes/cnpj`):**
  - Leitura qualquer papel; escrita DONO/MASTER, com o papel conferido antes da flag.
  - O `GET` traz `camposReceita` (o que a Receita entrega e os tipos de campo que aceitam cada dado).
  - O `PUT` recusa destino inativo, de tipo incompatível ou repetido.
- **Flag desligada:** rotas 403, nada é enfileirado e o worker pula o tenant.

**Marco da Fase 2:** dados limpos na entrada (duplicidade, regras e CNPJ), a operação diária (esfriando e edição em massa) e a base de atividades e eventos.

---

## FASE 3: Gestão e diferenciais

### M12. Distribuição automática (flag `crm.distribuicao`)
- **12.1** `crm_assignment_rule` (posição, condições em JSONB, usuário ou grupo de destino, ativo) e grupos de usuários: `crm_user_group` e membros, com gestão na própria subseção.
- **12.2 Motor.**
  - A primeira regra que casar decide; um grupo distribui em round-robin.
  - Fallback para o round-robin geral ou para ficar sem responsável, conforme a configuração.
  - Respeita o responsável já preenchido.
  - Pula usuários inativos ou ausentes (`usuarios.presenca`).
  - Grava `leads.assigned_by_rule_id`.
- **12.3** Ponteiro do round-robin com `INCR` atômico no Redis (ou `SELECT … FOR UPDATE`). Aplica-se a form, import, API e canais.
- **12.4** Notificação in-app ao responsável, reaproveitando M9.4.

**Checklist:** um teste de concorrência (N criações simultâneas) mostra distribuição justa e sem colisão; a regra que atribuiu aparece no lead; o import em lote distribui de forma consistente.
- [x] Concorrência contra o banco: 30 escolhas simultâneas entre 3 usuários dão 10 para cada, e 4 leads simultâneos numa regra de grupo de 2 dão 2 para cada (`services/distribuicao.db.test.js`, `CRM_DB_TESTS=1`).
- [x] A regra que atribuiu aparece no lead (`atribuido_por_regra_id`/`_nome`) e no evento `criado` do histórico.
- [x] Import: 6 linhas com 3 vendedores dão 2 para cada, com uma notificação agrupada por pessoa (`import.service.test.js`).

**Como ficou (back, 2026-10-18):**
- **Decisões do usuário:**
  - o ponteiro do rodízio fica no banco, não no Redis;
  - a presença (`usuarios.presenca`) fica de fora, porque nada a atualiza hoje; só usuários inativos são pulados;
  - rodízio puro, sem peso;
  - o import distribui linha a linha, e a linha com responsável fica com ele;
  - notificação: uma por lead no form/API e uma agrupada por import;
  - DONO e MASTER configuram; os outros papéis só leem.
- **Quando distribui:** a flag `crm.distribuicao` precisa estar ligada **e** a config com `ativo: true`. O padrão é desligado (`crm_distribuicao_config` sem linha), e aí o criador ou quem importou continua sendo o responsável, como antes. A distribuição só vale para lead **novo** cujo payload não traz `usuarioResponsavelId`, ou cuja linha da planilha não traz a coluna Responsável. Um responsável escolhido é respeitado, mesmo o próprio criador. Edição, massa (M10) e mesclagem nunca redistribuem.
- **Regras** (`crm_assignment_rule`, migration 0026):
  - lista ordenada, com `nome`, `ativo`, `condicoes` (de 0 a 10, combinadas com E) e destino: usuário ou grupo;
  - a primeira regra ativa que casar **e** tiver destino disponível decide; usuário inativo ou grupo sem membro ativo pula para a próxima;
  - as condições usam os operadores e a validação da regra condicional do M8 e são avaliadas em memória (`avaliarCondicao`); regra cujo campo de condição sumiu não casa;
  - o motor é puro (`services/distribuicao-motor.service.js`).
- **Fallback:** `rodizio_geral` (padrão) faz rodízio entre DONO e OPERADOR ativos; o MASTER fica de fora. `sem_responsavel` grava o lead sem dono, e ele cai no resumo "sem responsável" do M9. O plano não previa a opção "o criador fica com o lead": ela só existe com a distribuição desligada.
- **Rodízio** (`crm_rodizio_ponteiro`): uma linha por (tenant, chave), com `chave` = id do grupo ou `geral`.
  - A linha guarda o último que recebeu.
  - O próximo é o primeiro candidato ativo com id maior, voltando ao início no fim. Assim, alguém entrar ou sair do grupo não bagunça a ordem.
  - A linha é travada com `FOR UPDATE`, e a escolha vem antes do INSERT do lead. Se a criação falhar depois, aquela vez é perdida (aceito).
- **Rastro:** `leads.assigned_by_rule_id` (`ON DELETE SET NULL`). A leitura devolve `atribuido_por_regra_id` e `atribuido_por_regra_nome`. O evento `criado` ganha `detalhes.distribuicao = { origem: 'regra' | 'rodizio_geral' | 'sem_responsavel', regraId?, regraNome? }`.
- **Import:** a coluna mapeável **Responsável** (pelo nome do usuário ativo, reaproveitando a conversão do tipo `usuario`) é um extra da planilha, que não existia antes. Ao atualizar um lead existente, só muda o responsável se a coluna vier preenchida.
- **Notificações** (`#core/notificacoes`): `crm.lead_atribuido`, uma por lead e não para o próprio criador, com `dados: { rota, leadId }`. `crm.leads_atribuidos`, uma por pessoa no fim do import e não para quem importou, com `dados: { rota, filtro, importJobId, total }`. Uma falha ao notificar não derruba a criação.
- **HTTP** (flag `crm.distribuicao`; escrita DONO/MASTER, com o papel conferido antes da flag):
  - `GET /crm/configuracoes/distribuicao`, para qualquer papel: `{ ativo, fallback, configurado, regras, grupos }`.
  - `PUT /crm/configuracoes/distribuicao`: manda a config inteira, e a ordem de `regras` é a de avaliação. Regra com `id` é atualizada (o `id` se mantém), sem `id` é criada, e a que não vier é apagada (os leads que ela atribuiu ficam com `NULL`).
  - `POST`/`PUT`/`DELETE /crm/configuracoes/distribuicao/grupos(/:id)` com `{ nome, membros }`. Nome repetido dá 409, e grupo destino de alguma regra também dá 409 no DELETE.
  - Limites: 50 regras, 10 condições, 30 grupos e 200 membros.

### M13. Permissão por campo (flag `crm.permissoes`)
- **13.1** `crm_field_permission` (campo, papel e acesso `edit`/`view`/`hidden`). DONO e MASTER ignoram.
- **13.2** Aplicada no **back**: leitura remove o oculto, escrita rejeita o "só ver" e o oculto, e filtro, export, import, histórico e edição em massa respeitam a regra.
- **13.3** No front, campo "só ver" desabilitado com tooltip "sem permissão"; campo oculto não aparece.

**Checklist:** o OPERADOR não consegue filtrar, exportar nem ver no histórico um campo oculto (testes de rota para cada caminho).
- [x] Contra o banco (`services/permissoes.db.test.js`): com e-mail e um personalizado ocultos e o status "só ver", o OPERADOR não lê esses campos (lead, lista, `GET /crm/leads/fields`), não filtra pelo oculto (400), não acha o lead pelo e-mail na busca textual, não vê o diff no histórico e recebe 403 ao gravar (PUT, criação, massa). O DONO vê e edita tudo.
- [x] Export e import seguem só de gestão: o OPERADOR recebe 403 (teste de rota). As rotas passam o papel do token aos services (testes de rota).

**Como ficou (back, 2026-10-26):**
- **Decisões do usuário:** campo "só ver" ou oculto no payload dá **403** e não é ignorado em silêncio. A obrigatoriedade (do campo ou de regra do M8) **não vale** para quem não pode preencher. **Só o OPERADOR** é configurável, porque DONO e MASTER ignoram. A API já recebe o papel como chave, para quando surgirem papéis novos.
- **Schema:** sem migration. A `crm_field_permission` da 0012 é usada como estava, com uma linha só para restrição (sem linha = `edit`). As permissões entram no schema de campos em cache e são invalidadas ao salvar.
- **Mecanismo:** um "schema do papel" (`services/permissoes.service.js`, `obterSchemaDoPapel`), que é o schema de campos sem os ocultos e com `acesso` em cada campo. Leitura (`formatarLead`), filtro (`camposParaFiltro`), histórico (`descritorDoDiff`) e layout já tiravam campo desligado a partir do schema, e o oculto sai pelo mesmo caminho. As rotas passam `{ papel: role }` e, sem papel (worker, job, import, export), vale o schema inteiro. Sem a flag `crm.permissoes`, ninguém é restringido.
- **Escrita** (`garantirEscritaPermitida`): roda antes do primeiro nome derivado, então só conta o que o usuário mandou. Uma chave com valor (inclusive `null`) num campo "só ver" ou oculto dá 403 `FORBIDDEN`, com cada campo em `fields`. Na edição em massa, a checagem é feita uma vez para o pedido inteiro, antes de mexer em qualquer lead.
- **Busca textual:** e-mail ou telefone oculto deixa de ser pesquisado, e o identificador do layout (M4) oculto também. Sem isso, a busca revelaria o valor.
- **Regras do M8 no schema do papel:** só ficam as que o papel cumpre, ou seja, alvo editável e condição sobre campo visível.
- **Lupa do CNPJ** (M11b): a `sugestao` só aponta para campos que o papel edita.
- **Limites da configuração:** o Nome é sempre editável (`podeRestringir: false`). E-mail e telefone não podem ser restringidos os dois juntos, porque sem um deles não dá para criar lead.
- **HTTP** (flag `crm.permissoes`, só DONO/MASTER, com o papel conferido antes da flag):
  - `GET /crm/configuracoes/permissoes` responde `{ papeis, campos: [{ id, chave, label, camada, podeRestringir, acessos: { OPERADOR } }] }`.
  - `PUT` recebe `{ OPERADOR: { [campoId]: 'edit' | 'view' | 'hidden' } }`, o mapa inteiro do papel.
  - O OPERADOR recebe o próprio acesso em `GET /crm/leads/fields`, com `acesso: 'edit' | 'view'` em cada campo; o oculto não vem.
- **Fora do M13:**
  - O aviso de duplicidade (M7) cita o nome do lead parecido e o rótulo do campo que casou, mesmo oculto, mas nunca o valor.
  - A metadata dos campos (`GET /crm/configuracoes/campos`, `/crm/field-definitions`) continua visível para todos. Ela traz rótulos, não dados.
- **Testes:** os testes unitários que montam o schema real mockam agora os adapters de regras, permissões e usuários. Antes, alguns iam ao banco de verdade sem ninguém notar (ficaram lentos e instáveis com o Neon lento). Os arquivos `*.db.test.js` usam um timeout maior.

### M14. Pontuação de leads (flag `crm.score`)
- **14.1** `crm_score_rule` (condição e pontos, podendo ser negativos) e `crm_score_band` (mínimo, máximo, rótulo e cor), com seed Frio, Morno e Quente.
- **14.2** O score fica em `leads.score`, recalculado ao salvar o lead e em job assíncrono quando as regras mudam.
- **14.3** O score vira campo do sistema: tabela, filtros, destaque e faixa colorida.
- O score de engajamento (com decaimento) fica para quando existir o omnichannel.

**Checklist:** o recálculo em lote é idempotente e mostra progresso; o filtro por faixa funciona; uma regra com campo inativo é ignorada.
- [x] Contra o banco (`services/score.db.test.js`): salvar as regras recalcula todos com o progresso gravado, e recalcular de novo dá os mesmos scores. O filtro `faixaScore` traz cada lead na sua faixa. Uma regra sobre um campo personalizado excluído deixa de contar no recálculo.
- [x] Testes puros (`score.service.test.js`): a expressão (uma parcela por regra, condições com E, regra inválida ignorada), as faixas (inclusivas, sobreposição dá 400) e o cursor do recálculo em lotes.

**Como ficou (back, 2026-10-26):**
- **Decisões do usuário:**
  - o score **reusa o campo nativo "Lead score"** (`lead_score`, Camada 2), em vez da coluna nova `leads.score` do plano. Com a flag `crm.score` ele é calculado e só leitura (`leadScore` no payload dá 400, inclusive mapeado no import); sem a flag, volta a ser manual;
  - o recálculo é **na hora, em lotes**, e não num job da fila, para funcionar sem Redis;
  - faixas semeadas: Frio até 29, Morno de 30 a 69 e Quente a partir de 70.
- **Cálculo:** uma única expressão SQL (`expressaoDoScore`), a soma de `CASE WHEN <condições da regra> THEN pontos ELSE 0 END`.
  - As condições usam a mesma tradução do filtro (`condicaoDoCampo`, extraída do `montarCondicoes`).
  - A mesma expressão serve para um lead ao salvar e para o recálculo em lote, então os dois nunca divergem. O resultado é determinístico, o que torna o recálculo idempotente.
  - Uma regra desligada, com campo de condição excluído ou desligado, sobre o próprio score, ou com condição que deixou de valer para o tipo do campo é ignorada. Ela nunca derruba o salvar.
- **Quando recalcula:**
  - ao criar e editar um lead (o que cobre a edição em massa), com o score novo já na resposta do PUT;
  - no fim do import, para todos os leads gravados;
  - na mesclagem e no enriquecimento por CNPJ;
  - em todos os leads do tenant ao salvar as regras, ou por `POST …/score/recalcular`.

  O recálculo do score não gera evento no histórico, porque não é edição de ninguém.
- **Recálculo em lote:** lotes de 500 por ordem de id (cursor = último id), incluindo arquivados e lixeira. O progresso (`total`, `processados`, `emAndamento`, `concluidoEm`) fica em `crm_score_config` e aparece no GET enquanto roda. O PUT responde no fim.
- **Faixas:** em `crm_score_band`, com `chave` (o que o filtro usa), `rotulo`, `minimo`/`maximo` inclusivos (nulo = sem limite) e `cor`. Sem linha no tenant, valem as padrão do código, sem seed no banco. Faixas sobrepostas ou com chave repetida dão 400; um buraco entre faixas é permitido.
- **Filtro:** `faixaScore: '<chave>'` na busca (`POST /crm/leads/search`), que também vale para o export. Exige a flag. O filtro numérico normal do campo Lead score continua funcionando.
- **Visibilidade:** ao salvar a configuração, o campo Lead score é ligado no detalhe, na tabela e no filtro, se estiver desligado. O formulário de criação não muda, porque o campo é só leitura. Sem isso, a resposta do lead nem traria o score.
- **Migration 0027:** `crm_score_rule`, `crm_score_band` e `crm_score_config`, com RLS, mais o índice `(tenant_id, lead_score)`.
- **HTTP** (flag `crm.score`; leitura para qualquer papel, escrita DONO/MASTER com o papel conferido antes da flag):
  - `GET /crm/configuracoes/score` responde `{ regras, faixas, faixasConfiguradas, recalculo }`.
  - `PUT` recebe `{ regras: [{ nome, ativo, pontos (inteiro, ±1000), condicoes }], faixas: [{ chave?, rotulo, minimo, maximo, cor }] }`.
  - `POST /crm/configuracoes/score/recalcular`.
  - Limites: 100 regras, 10 condições e 10 faixas.
- **Fora do M14:** o score de engajamento com decaimento, como o plano prevê. Mudanças fora das regras (excluir um campo, mudar o tipo de um campo) só refletem no próximo recálculo.

### M15. Base legal LGPD (flag `crm.lgpd`)
- **15.1** Colunas `legal_basis`, `legal_basis_at`, `origem_registro` e `marketing_opt_out_at` como campos do sistema.
- **15.2** Configuração: base legal padrão e obrigatoriedade, com um passo extra no wizard de import (base legal do lote).
- **15.3** Pedido do titular: **anonimizar** o lead, preservando estatísticas (sem PII nos eventos), com registro de auditoria.

**Checklist:** a anonimização remove PII do lead, das atividades e dos eventos; o import exige a base legal quando ela é obrigatória.

### M16. Timeline completa no drawer (flag `crm.timeline`)
- **16.1** O drawer ganha as abas Dados · Atividades · Histórico.
  - O Histórico mostra mudanças de campo com autor e data, mesclagens, enriquecimentos e atribuições, a partir de `crm_lead_event`.
- **16.2** Paginação, filtro por tipo de evento e respeito à permissão de campo.

**Marco da Fase 3:** todas as 9 subseções de Configurações entregues, e todas as flags estabilizadas e removidas do código.

---

## Revisão pós-M2 (2026-10-15)

Correções:
- **Lint de fronteira:** não checava nenhum import por alias `#...`. Resolver próprio (`eslint-resolver-imports.cjs`); o core deixou de importar `#api/modules.js` e lê os módulos de `#core/registry/modules.js` (preenchido por `buildApp`).
- **Admin:** recontratar módulo desligado (soft-disable) agora reativa a linha e reconcilia.
- **FKs de tenant (migration 0015):** 22 tabelas de módulo estavam sem FK pra `tenants` no banco de dev (drift: a 0001 usa `CREATE TABLE IF NOT EXISTS` sobre tabelas que já existiam). FK criada em todas (`NOT VALID` onde há órfão); `fk_leads_usuario_responsavel` virou `ON DELETE SET NULL`. Teste `pnpm test:fk-coverage`.
- **Campo oculto em todos os contextos** não sai na resposta, nas três camadas (antes só a Camada 2).
- **Obrigatório só conta no formulário de criação** (`exigidoNaCriacao`), no cadastro manual e no import, pras três camadas.
- **Edição antiga de personalizado** (`PUT /crm/field-definitions/:id`): nome único, obrigatório exige o formulário de criação, tipo fixo depois que algum lead tem valor. Criar também checa nome contra os campos do sistema renomeados.
- **Ordem:** `ordemPadrao` = posição no contrato (Camada 2 depois da Camada 1); reordenar em Configurações passou a valer pra Camada 1.
- **E-mail/telefone nativos** com tipo `email`/`telefone`: gravados normalizados (dígitos sem DDI; minúsculo) e comparados normalizados no filtro e na busca, inclusive linhas antigas com máscara.
- **Cache de acesso a módulo** no `#core/cache` (Redis entre instâncias), igual às flags.

Organização: regras por tipo num arquivo só (`tipos-campo.service.js`: validar, normalizar, converter célula, texto de busca); `constants.js` do CRM separado em `constants/` (o arquivo reexporta); fábricas `erroDeValidacao`/`erroNaoEncontrado`/`erroDeConflito` em `#core/errors/app-error.js`; documentação do CRM em `docs/crm/` com índice.

Pendente/decisão do usuário: órfãos no dev (2 leads, 4 estágios sem tenant; FK `NOT VALID` até limpar); juntar 0012–0015 só se a produção ainda não tiver aplicado nenhuma delas; Prettier adiado (reformataria o repositório inteiro).

## Decisões abertas (resolver no início do marco indicado)
- ~~**D1 (M6):** editar um campo reseta o contador de inatividade? A spec propõe que não.~~ **Fechada em 2026-10-16:** não reseta, como a spec propõe. Contam como interação: concluir uma atividade e mudar o status (ver M6, "Como ficou").
- **D2 (M1):** o contrato HTTP continua com `chave` e só o armazenamento usa `id`? Recomendado: sim.
- ~~**D3 (M3):** adotar ou não a FK composta, depois do spike no Neon.~~ **Fechada em 2026-10-15:** não adotada (ver M3, "Como ficou").
- **D4 (M7):** `pg_trgm` disponível no plano do Neon, para o "Nome + Empresa aproximado".
- ~~**D5 (M9/M12):** a notificação in-app fica no core (servindo outros módulos) ou no CRM?~~ **Fechada em 2026-10-17:** core (`#core/notificacoes`, ver M9, "Como ficou").
- **D6 (Kanban):** o identificador do layout vale nos cards do Kanban quando a integração existir. Fica fora deste plano.

## Verificação geral
- **Gates de cada marco** (seção Convenções) e o checklist do marco, todos marcados.
- **Teste de paridade em M1** antes de ligar a flag para qualquer tenant real.
- **Smoke test** de cada marco em branch de dev do Neon, com DONO e OPERADOR, cobrindo o caminho feliz e cada regra de bloqueio.
- **Retirada de flag:** só depois de 1 a 2 releases estáveis, com o marco seguinte já em andamento.
