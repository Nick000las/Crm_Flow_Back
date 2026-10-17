# Plano: campos híbridos do CRM (Camadas 1/2/3)

> **Substituído (2026-10-15):** documento histórico; o atual é [plano-configuracoes.md](./plano-configuracoes.md) (índice em [README.md](./README.md)).
>
> **Atualização (2026-10-15):** `tenant_lead_field_definitions` e `tenant_lead_field_visibility` foram substituídas por `crm_field` + `crm_field_visibility` (migrations 0012–0014). `custom_fields` é indexado pelo `id` do campo. Ver `docs/crm/plano-configuracoes.md` (M1/M2).

**Status: implementado (2026-10-12; acesso, RBAC, responsável e edição em 2026-10-13).** Os passos 1 a 8 da seção 8 estão no código, a migration 0010 já foi aplicada e as decisões da seção 9 estão fechadas. Os estágios do funil ficam em aberto até a integração com o Kanban (seção 10). As seções 0 a 7 descrevem o desenho final. Onde a implementação divergiu da proposta original, o texto diz.

---

## 0. Estado de partida (antes desta leva)

O estado antes da implementação foi conferido em arquivo e em query.

- **`modulo_crm.leads`:** tinha `id, tenant_id, nome, telefone, valor, funil_estagio_id, usuario_responsavel_id, created_at, updated_at, custom_fields`. O `custom_fields` é JSONB e veio da migration 0008.
- **`modulo_crm.funil_estagios`:** tabela própria, e `leads.funil_estagio_id` é FK real para ela.
- **Camada 3:** já existia por completo. São a `tenant_lead_field_definitions` (migration 0008), o `leads.custom_fields` com índice GIN e o CRUD de `field-definitions`.
- **`usuario_responsavel_id`:** não tinha FK. Não havia nenhum órfão, então a constraint foi adicionada na 0009.
- **`modulo_kanban_universal`:** é um motor genérico e separado, sem ligação com `funil_estagios`. Não deve haver FK entre os dois módulos.
- **Drift encontrado:** `email` e `origem` existiam em produção sem passar por nenhuma migration. As duas estavam vazias e sem uso em código, e a 0009 removeu ambas para recriar `email` e `fonte_lead` do jeito planejado.

---

## 1. Migrations

**[0009_crm_campos_hibridos](../prisma/migrations/0009_crm_campos_hibridos/migration.sql)**

- **Camada 1:**
  - colunas `email`, `fonte_lead` (CHECK), `status` (CHECK), `tags VARCHAR[]` e `ultima_interacao_em`;
  - `telefone` passa a ser nullable;
  - nova constraint `chk_leads_email_ou_telefone`;
  - FK `usuario_responsavel_id → usuarios(id)`.
- **Camada 2:** **15 colunas**, todas nullable:
  - `empresa, cargo, cpf, cnpj, cidade, uf, cep, endereco, campanha_utm`;
  - `data_conversao, probabilidade_fechamento, data_prevista_fechamento`;
  - `motivo_perda` (CHECK), `lead_score, proximo_followup`.

  A lista original tinha 18. **`lifecycle_stage`, `industria` e `porte_empresa` ficaram de fora por decisão**: não existem como coluna nem como opção de visibilidade. Se forem necessários para um tenant, o caminho é a Camada 3 (campo customizado).
- **`tenant_lead_field_visibility`:** tabela nova com RLS. A `coluna` é validada no service contra `CAMADA_2_COLUNAS`.

**[0010_crm_filtros_import](../prisma/migrations/0010_crm_filtros_import/migration.sql)**

- **`crm_filter_views`:** views de filtro salvas por usuário, com `UNIQUE (tenant_id, usuario_id, nome)`.
- **`import_jobs`:** acompanha cada importação. Guarda status, estratégia de duplicata, `payload` com as linhas já validadas, contadores (criadas, atualizadas, ignoradas e com erro) e `relatorio_erro`.

Tudo segue o padrão de valores fechados do projeto: `CHECK (coluna IN (...))`, nunca `ENUM`. Os valores de CHECK estão espelhados em [constants.js](../src/modules/nucleo/crm/constants.js).

---

## 2. RLS

As colunas novas em `leads` já ficam cobertas pela policy existente, porque o RLS é por linha.

As três tabelas novas usam a mesma receita: `ENABLE ROW LEVEL SECURITY`, a policy `tenant_isolation` e um índice com `tenant_id`. O `GRANT` para o `app_tenant` vem das *default privileges* da migration 0004.

`test:rls-coverage` e `test:tenant-isolation` passaram depois da 0010.

---

## 3. Backend: endpoints

Toda rota exige token válido e o módulo `crm` contratado pelo tenant (seção 3.1). A coluna **Papel** indica quem pode chamar; "todos" inclui OPERADOR.

| Rota | Papel | O que faz |
|---|---|---|
| `GET /crm/leads?pagina=&tamanho=` | todos | Lista paginada, no mesmo formato do `/search`: `{ itens, total, pagina, tamanho }` |
| `POST /crm/leads`, `GET/PUT/DELETE /crm/leads/:id` | todos | CRUD. O payload aceita as Camadas 1 e 2 no nível raiz, `customFields` para a Camada 3 e `usuarioResponsavelId` |
| `GET /crm/leads/fields` | todos | Lista única de campos ativos (seção 5). Nas Camadas 1 e 2, cada item traz `coluna`, o nome da propriedade no lead lido (snake_case) |
| `GET /crm/usuarios` | todos | Usuários ativos do tenant, `{ id, nome }[]`, para escolher o responsável |
| `POST /crm/leads/search` | todos | Filtro combinado com paginação (seção 6) |
| `GET /crm/field-visibility` | todos | Estado da visibilidade da Camada 2 |
| `PUT /crm/field-visibility` | DONO/MASTER | Liga, desliga e reordena os campos da Camada 2 |
| `GET /crm/field-definitions` | todos | Lista os campos da Camada 3 |
| `POST/PUT/DELETE /crm/field-definitions…` (incluindo `reorder`) | DONO/MASTER | CRUD da Camada 3 |
| `GET/POST /crm/filter-views`, `DELETE /crm/filter-views/:id` | todos | Views de filtro salvas, do usuário logado |
| `POST /crm/import/preview` | DONO/MASTER | Multipart. Devolve o cabeçalho, as primeiras linhas e os campos mapeáveis, sem gravar nada |
| `POST /crm/import/validate` | DONO/MASTER | Multipart com o arquivo e os campos `mapeamento` (JSON) e `estrategiaDuplicata`. Valida linha a linha e grava um job `pendente` |
| `POST /crm/import/:jobId/confirm` | DONO/MASTER | Enfileira o job no BullMQ. Responde 503 `QUEUE_UNAVAILABLE` se não houver Redis |
| `GET /crm/import/:jobId` | DONO/MASTER | Status e progresso, para polling |
| `POST /crm/export` | DONO/MASTER | Recebe `{ colunas, filtro? }` e devolve o `.xlsx` direto na resposta |

### 3.1. Acesso: módulo contratado e papéis

- **Módulo contratado** (MASTER_DOCUMENT §1.1.2): `#api/app.js` registra `authenticateHook` e `exigirModuloAtivo(module.key)` ([module-access.js](../src/core/tenant/module-access.js)) no escopo de **todo** módulo, antes das rotas dele.
  - Sem linha em `tenant_modules`, ou com `disabled_at` preenchido, a resposta é 403 `MODULE_NOT_ENABLED`.
  - O resultado fica em cache por processo durante 30 s. `TenantManagement` invalida o cache quando altera ou desliga os módulos de um tenant; outras instâncias convergem em até 30 s.
  - Vale também para o Kanban (`kanban_universal`). O `authenticateHook` que o módulo do Kanban ainda registra virou redundante e pode ser removido por quem cuida dele.
  - MASTER não tem bypass: ele acessa o CRM do próprio tenant como qualquer outro.
- **Papéis:** `requireRole(PAPEIS_GESTAO)` (DONO e MASTER) por rota, conforme a tabela acima. OPERADOR enxerga todos os leads do tenant; o responsável é atribuição e filtro, não restrição de acesso.

- **Menu do front:** `GET /auth/me` devolve `modulosAtivos: string[]` (módulos sem `disabled_at`), lidos do banco a cada chamada, porque não viajam no JWT. O front usa isso só para esconder do menu o que não foi contratado; quem bloqueia de verdade é o `exigirModuloAtivo`.

### 3.2. Responsável pelo lead

- **Na criação:** sem `usuarioResponsavelId`, o responsável é quem criou o lead. No import, é quem importou.
- **Validação:** um responsável informado é conferido em `usuarios` do **mesmo tenant** e precisa estar `ativo` ([usuarios.repository.js](../src/modules/nucleo/crm/adapters/usuarios.repository.js)). Isso é necessário porque a FK sozinha aceitaria um usuário de outro tenant.
- **Na edição:** `usuarioResponsavelId: null` remove o responsável.
- **Leitura:** `usuario_responsavel_id` volta em todas as leituras de lead.
- **Valores NUMERIC:** `valor`, `probabilidade_fechamento` e `lead_score` chegam como **string** no JSON (é assim que o Prisma serializa `Decimal`). O cliente converte para número ao exibir e editar.

### 3.3. Edição: omitir mantém, `null` limpa

`PUT /crm/leads/:id` monta um SET dinâmico (`montarAtribuicoes` em [leads.repository.js](../src/modules/nucleo/crm/adapters/leads.repository.js)):
- campo **omitido** mantém o valor;
- campo **`null`** limpa a coluna (exceto `nome` e `funilEstagioId`);
- em `customFields`, chave com valor faz merge e chave `null` é removida do JSONB.

O nome de coluna vem só de um mapa fechado, como no filtro.

O service bloqueia, com 400:
- limpar o único contato que restou (e-mail ou telefone);
- limpar um campo obrigatório, seja da Camada 2 visível ou da Camada 3.

---

## 4. Leitura combinando as 3 camadas

As Camadas 1 e 2 são colunas da mesma tabela e a Camada 3 está em `custom_fields`, então uma query só traz tudo. O filtro é aplicado na **resposta**: `formatarLead` ([leads.service.js](../src/modules/nucleo/crm/services/leads.service.js)) remove do JSON as colunas da Camada 2 com `visivel: false`. O dado de um campo desligado não sai na resposta HTTP.

A lista de colunas de leitura é uma constante única (`COLUNAS_LEITURA` em [leads.repository.js](../src/modules/nucleo/crm/adapters/leads.repository.js)), compartilhada pela lista, pelo detalhe e pela busca.

---

## 5. Endpoint único de campos ativos (aprovado)

`GET /crm/leads/fields` devolve `{ chave, label, tipo, camada, obrigatorio, ordem, opcoes? }[]`, com:
- a Camada 1 fixa (`CAMPOS_CAMADA_1`);
- a Camada 2 visível, com metadado de `CAMADA_2_METADADOS`;
- a Camada 3, com as definições do tenant.

A mesma lista (`listarCamposDoTenant`) é a fonte única para o formulário, o filtro, o mapeamento do import e as colunas do export. As chaves das Camadas 1 e 2 são camelCase, as mesmas do payload de lead.

O import e o export aceitam ainda dois extras que não são campos de formulário: `valor` e `funilEstagio` (o estágio pelo nome). Estão em `CAMPOS_EXTRAS_PLANILHA`.

---

## 6. Filtro

`POST /crm/leads/search` recebe `{ busca?, funilEstagioId?, usuarioResponsavelId?, valorMin?, valorMax?, criadoDe?, criadoAte?, filtros?: [{ chave, operador, valor? }], paginacao? }` e devolve `{ itens, total, pagina, tamanho }`.

**Operadores:** `igual`, `contem`, `entre` (com `{ de?, ate? }`), `e_um_dos`, `vazio` e `nao_vazio`. A compatibilidade com o tipo do campo vem de `OPERADORES_POR_TIPO`.

**Montagem do SQL** ([lead-filter.service.js](../src/modules/nucleo/crm/services/lead-filter.service.js)): o SQL é montado com `Prisma.sql`/`Prisma.join`, nunca por concatenação.
- **Camadas 1 e 2:** o nome da coluna sai só dos mapas fechados `CAMADA_1_CAMPOS` e `CAMADA_2_CAMPOS`.
- **Camada 3:** a chave entra como parâmetro em `custom_fields->>$1`.
- **Igualdade e seleção na Camada 3:** usam `@>`, que é o caso que o GIN acelera. Texto parcial e faixa numérica ou de data não usam o GIN. É o caveat já registrado no [plano anterior §2.4](./plano-campos-filtros-import-export.md#24-caveat-honesto-sobre-o-índice-gin-checkpoint-do-roteiro-ajustado).
- **Cast de número e data na Camada 3:** é protegido (`jsonb_typeof` ou regex). Um valor órfão de outro tipo vira `NULL` em vez de derrubar a query.

**Campos inativos:** uma chave fora dos campos ativos, incluindo uma coluna da Camada 2 desligada, dá 400. Não dá para filtrar por um campo invisível.

**Views salvas:** guardam o mesmo body, sem paginação. Para aplicar uma view, o cliente reenvia esse body para o `/search`. O filtro é validado quando a view é salva e de novo quando é aplicada.

---

## 7. Import/export

**Import (assíncrono, BullMQ)**

1. **preview:** só lê a planilha.
2. **validate:** valida o mapeamento.
   - Toda coluna precisa existir na planilha.
   - Toda chave precisa ser um campo ativo, e nenhum campo pode aparecer duas vezes.
   - Os campos obrigatórios precisam estar mapeados, assim como e-mail ou telefone.

   Depois converte cada linha:
   - opções casam sem diferenciar maiúsculas;
   - datas aceitam `dd/mm/aaaa` ou ISO;
   - números aceitam `1.234,50`.

   Os erros de **todas** as linhas são acumulados e apontam o número real da linha no Excel. Só as linhas válidas vão para o `payload` do job.
3. **confirm:** faz uma transição condicional `pendente → processando`, para que duas confirmações não enfileirem o job duas vezes, e então enfileira. Se a fila falhar, o job volta para `pendente`.
4. **worker** ([src/workers/crm.worker.js](../../src/workers/crm.worker.js), `pnpm worker:crm`): processo separado do HTTP. Chama `processarImportacao`.
   - **Deduplicação:** procura por e-mail (sem diferenciar maiúsculas) e, se não achar, por telefone comparando só os dígitos.
   - **Estratégias:**
     - `pular` não toca no lead existente;
     - `atualizar` faz merge (`COALESCE`) sem mover o lead de estágio;
     - `criar` sempre cria.
   - **Erros:** um erro numa linha vai para `relatorio_erro` sem derrubar o job. O progresso é gravado a cada 50 linhas.
   - **Estágio padrão:** quando a coluna de estágio não é mapeada, o lead novo vai para o primeiro estágio por `order`, ou fica com `null` se o tenant não tiver estágio.

Limites: arquivo `.xlsx` de até 10 MB, até 5.000 linhas e uma única aba (a primeira).

**Export (síncrono):** `POST /crm/export` reaproveita o filtro da busca e gera o `.xlsx` com as colunas na ordem pedida, usando os rótulos de `/fields`. Fica limitado a 10.000 leads. Acima disso a resposta é 400, pedindo para refinar o filtro. Não há storage de arquivo: o binário vai na própria resposta.

---

## 8. Ordem de implementação

1. ✅ Decisões da seção 9.
2. ✅ Migration 0009: Camadas 1 e 2, FK, `tenant_lead_field_visibility`.
3. ✅ CRUD de visibilidade: `field-visibility.{repository,service,controller,schema}.js`.
4. ✅ Leads estendidos para as Camadas 1 e 2 e leitura filtrada por visibilidade: `leads.{repository,service,controller,schema}.js`.
5. ✅ `GET /crm/leads/fields`: `listarCamposDoTenant` em `leads.service.js`.
6. ✅ Filtro e views salvas:
   - `lead-filter.service.js`;
   - `leads-search.schema.js`;
   - `filter-views.{repository,service,controller,schema}.js`;
   - migration 0010.
7. ✅ Import e export:
   - `planilha.service.js`;
   - `import.service.js` e `export.service.js`;
   - `import-jobs.repository.js`, `import-queue.repository.js` e `funil-estagios.repository.js`;
   - `import-export.{controller,schema}.js`;
   - `#core/queue/connection.js`;
   - worker.

8. ✅ Acesso e edição:
   - módulo contratado (`#core/tenant/module-access.js` + `#api/app.js`);
   - RBAC por rota;
   - responsável pelo lead;
   - SET dinâmico no PUT;
   - paginação de `GET /crm/leads`.

Os testes unitários de cada service estão em `services/*.test.js`. Os testes de rota (autenticação, módulo, RBAC, validação na borda) estão em [crm.routes.test.js](../src/modules/nucleo/crm/controllers/crm.routes.test.js).

Desde o passo 8, `GET /crm/leads` devolve `{ itens, total, pagina, tamanho }` em vez de um array. Isso é uma **mudança de contrato para o frontend**.

---

## 9. Decisões tomadas

- **`estagio_funil`:** o modelo atual foi mantido (`funil_estagio_id` como FK para `funil_estagios`). Não virou valor fixo.
- **Nomenclatura:** os nomes atuais foram mantidos (`valor`, `usuario_responsavel_id`, `created_at`). Nada foi renomeado.
- **Valores de seleção:** são os CHECKs da 0009, espelhados em `constants.js` (`FONTE_LEAD_VALORES`, `STATUS_LEAD_VALORES`, `MOTIVO_PERDA_VALORES`).
- **Obrigatoriedade da Camada 1:** `nome` é obrigatório e é preciso **e-mail ou telefone** (pelo menos um dos dois). A regra fica em três lugares: no `refine` do Zod, no service e no CHECK do banco.
- **Camada 2:** ficou com 15 campos, sem `lifecycle_stage`/`industria`/`porte_empresa`.
- **Endpoint único de campos ativos:** aprovado (seção 5).
- **Dado órfão:** desligar um campo da Camada 2, ou remover uma definição da Camada 3, não apaga dado. É a mesma filosofia da Parte 1.4 do plano anterior.
- **Import:** assíncrono com BullMQ, Redis e worker separado. A tabela é `import_jobs`, só para import.
- **Export:** síncrono, com download direto na rota e sem storage.
- **Views salvas:** incluídas nesta entrega.
- **Papéis:** só DONO e MASTER mexem em configuração (campos e visibilidade) e em import/export. OPERADOR faz o CRUD de leads, a busca e as views.
- **Visibilidade de leads:** OPERADOR vê todos os leads do tenant.
- **Responsável padrão:** quem criou o lead (no import, quem importou).
- **Listagem:** `GET /crm/leads` paginado por query string.
- **Estágios do funil:** ficam em aberto até a integração com o Kanban.

---

## 10. Pendências operacionais (fora do código)

- **Provisionar Redis e definir `REDIS_URL`**, tanto no servidor HTTP quanto no worker. Sem isso, a confirmação de import responde 503. O resto do CRM funciona normalmente.
- **Subir o worker em produção** como um segundo processo (`pnpm worker:crm`).
- **Rodar `EXPLAIN ANALYZE` dos filtros com volume real**, para confirmar o GIN nos filtros de containment da Camada 3 (plano anterior, §2.4).
- **Contratar os módulos dos tenants:** em 2026-10-13, nenhum tenant tinha linha em `tenant_modules`. Com a validação da seção 3.1, `/crm/*` e o Kanban respondem 403 até um MASTER contratar os módulos (`PUT /admin/tenants/:id/modules`).
- **Estágios do funil (em aberto, dependem do Kanban):** não há CRUD de `funil_estagios`, e `system_stage` e `limite_vacuo_horas` não são usados. Desde 2026-10-14, `funilEstagioId` é **opcional** em `POST /crm/leads`, e o lead pode nascer sem estágio. A criação também passou a aceitar `valor`. A decisão sai junto com a integração com `modulo_kanban_universal` (`board_type: crm_leads`, MASTER_DOCUMENT §1.1/§4.2).
