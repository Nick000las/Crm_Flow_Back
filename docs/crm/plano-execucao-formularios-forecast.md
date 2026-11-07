# Plano de implementação: formulários, anamnese e forecast

Base: `docs/crm/CRMFlow — Plano de Implementação Oportunidades, Forecast e Formulários.md` (28/10/2026), conferido contra o código da branch `ref/CRMxKANBAN` e o banco de dev em 07/11/2026. As trilhas 1A, 1B e 2 e os nomes de tabela são os daquele documento; aqui estão a adaptação ao projeto e os checklists.

**Primeira ação depois de aprovado:** copiar este plano para `docs/crm/plano-execucao-formularios-forecast.md`, que vira a fonte dos checklists, e citar o arquivo em `docs/crm/README.md`.

## Contexto

O documento de sugestão foi escrito antes da integração com o Kanban. Desde então, o M2.5 entregou quase toda a trilha 1A (oportunidades e ciclo de vida) com outro desenho, e o M5 passou a consumir o outbox. Falta o que o documento chama de trilha 2 (motor de formulários, com a anamnese como primeiro uso) e trilha 1B (forecast). O plano de integração deixou os dois "para depois do M5", e o M5 está fechado.

**Decisões do dono (07/11/2026):**

- **Ordem:** formulários primeiro; forecast depois, como trilha menor.
- **Uploads:** marco próprio no fim da trilha de formulários. O formulário sai primeiro sem campo de arquivo.
- **Destino das respostas:** só campos da pessoa. `entity` no `crm_field` e `custom_fields` na oportunidade ficam fora; o link guarda `deal_id` só como referência.
- **Motivo da perda:** campo ligado por padrão, em tenants novos e existentes (pendência do M3, vira o marco P0).

## O que o código mostrou (muda o plano original)

| Achado                                                                                                                                                                                                    | Consequência                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `crm_deal`, ciclo de vida e oportunidade principal existem desde o M2.5 (migrations 0036–0040), com `pipeline_id`, sem `version` (o projeto usa `expectedUpdatedAt`) e sem contadores na pessoa.          | A trilha 1A não é refeita. A tabela "Trilha 1A" abaixo marca item por item o que está feito, o que mudou e o que sobrou.                                                                               |
| Não existe flag `crm.deals_v1` nem escrita dupla: a F5 apagou o modelo antigo.                                                                                                                            | Sem backfill, sem rollback de flag na 1A.                                                                                                                                                              |
| Categorias de status são `aberto`, `ganho` e `perdido`, não `open/won/lost`.                                                                                                                              | Forecast e regras usam os nomes do projeto.                                                                                                                                                            |
| Status pertencem a um pipeline, e há pipelines `sales` e `service`.                                                                                                                                       | Forecast só conta pipelines `sales`, com filtro por pipeline. Probabilidade padrão é por status do pipeline.                                                                                           |
| `crm_event.processed_at` é marcado pelo despacho do quadro (M5), que drena **todos** os eventos.                                                                                                          | O outbox tem hoje um consumidor só. Eventos `form.*` seriam "processados" pelo quadro e ignorados. Isso basta neste plano; o bot vai precisar de cursor próprio por consumidor (registrado em Riscos). |
| Rotas de módulo recebem `authenticateHook` e `exigirModuloAtivo` no escopo (`src/api/app.js`). Não existe rota pública de módulo.                                                                         | O contrato de módulo ganha `registerPublicRoutes` opcional, num escopo sem autenticação, com prefixo `/public`.                                                                                        |
| Não há armazenamento de arquivos, KMS, limite de requisições nem processamento de imagem. `@fastify/multipart` existe, só para importação.                                                                | Token criptografado com chave de ambiente (você gera). `@fastify/rate-limit` entra na FM3. Storage e `sharp` só na FM7.                                                                                |
| O front é SPA (Vite). As tags OG da prévia no WhatsApp vêm do `index.html` estático.                                                                                                                      | A prévia é genérica ("Formulário") e não traz o nome da clínica, o que também protege o paciente. Nada no back depende de renderizar HTML.                                                             |
| `motivoPerda` é Camada 2 com `visivelPadrao: false` (`constants/campos.js`). Com o campo desligado, `resolverRegras` descarta a regra de Perdido em silêncio. O teste do M3 ligava o campo na preparação. | Marco P0, antes de tudo.                                                                                                                                                                               |
| `tenants.fuso_horario` existe (migration 0011).                                                                                                                                                           | Forecast e validade de link usam o fuso do tenant.                                                                                                                                                     |
| Próxima migration: **0041**. 0030–0034 seguem reservadas.                                                                                                                                                 |                                                                                                                                                                                                        |

## Convenções de execução

As mesmas do plano de integração:

- **Git:** só você commita. Cada marco entrega os commits sugeridos e para.
- **Front:** não mexo em `Front/`. Cada marco termina com handoff `docs/crm/handoff-front-<marco>.md`.
- **Segredos:** chave do token, bucket e credenciais de storage são criados por você; eu só leio o nome da variável.
- **Migrations:** aditivas, RLS em tudo, FK composta por tenant, a partir da 0041.
- **Flags:** `crm.formularios` e `crm.forecast`, declaradas em `featureFlags` do CRM.
- **Gates de todo marco:** `pnpm lint`, `format:check`, `test` (com `CRM_DB_TESTS=1` e Redis), `test:rls-coverage`, `test:fk-coverage`, `test:tenant-isolation`, boot real no Node fora do vitest.
- **Testes de banco no tenant padrão:** a preparação não liga campo nem regra que o aceite depende. Esse foi o erro do M3.
- **Fechar marco:** validar item a item com evidência nova, marcar aqui e no documento do dono, e deixar `[ ]` com motivo o que não puder ser provado. Proteções quebradas de propósito antes de fechar.

---

## P0. Motivo da perda ligado por padrão (fecha a pendência do M3)

- [x] `motivoPerda` ganha `visivelPadrao: true` próprio em `CAMPOS_SISTEMA` (`constants/campos.js`), pela lista `CAMADA_2_VISIVEIS_POR_PADRAO`; os outros campos da Camada 2 continuam desligados (`campos-reconcile.service.test.js`).
- [x] Migration 0041: liga as linhas de `crm_field_visibility` de `motivoPerda` nos tenants existentes. Só é seguro porque não há produção; o comentário da migration registra isso.
- [x] Teste do M3 (`controllers/quadro-comercial.db.test.js`): tirado o `PUT` que ligava o campo na preparação. O aceite passa a valer no tenant padrão.
- [x] Conferir quem mais lia o campo desligado: tabela, filtros, export e importação seguem o schema; a ficha acha o campo por `campoDoMotivo`, que lê `/fields`. Nenhum código a mudar: o campo passa a aparecer em todos.

**Aceite**

- [x] Tenant recém-criado: mover para Perdido sem motivo dá `CAMPOS_OBRIGATORIOS` com `motivoPerda`. Provado no teste do M3 sem configurar nada e na API de um tenant SMOKE novo (a lista de regras já traz `motivoPerda`).
- [x] Na tela: o arraste até Perdido, com a rolagem automática do quadro, abre "Falta preencher para mover"; escolher o motivo e "Salvar e mover" grava `perdido` com o motivo e mostra "Card movido" (07/11/2026). Um perfil bastou: o aceite não depende de outra sessão.

- [x] Gates verdes: 1058 de 1058 em 07/11/2026, com banco, Redis e os testes de integração do Kanban (`RUN_KANBAN_INTEGRATION=1`). Lint, formato, RLS, FK, isolamento e boot real no Node.
- [x] Proteção: voltar a lista para vazia derruba 5 testes (aceite do M3, criar em Perdido, formulário de campos faltantes, permissão do motivo e o teste do reconcile).
- [x] Achado no caminho: o teste "purgar apaga as oportunidades junto" falhava sempre porque o relógio do Neon anda ~870 ms à frente desta máquina. O limite da purga no teste passou a sair do `deleted_at` gravado pelo banco. Em produção o limite é de 30 dias, e a diferença não importa.

**Handoff ao front:** o campo aparece na tabela, nos filtros e nos formulários sem configuração.

---

## Trilha 1A: o que já existe

| Item do documento           | Estado                                                                                                                                                        | Onde                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 1A.1 `crm_deal`             | feito, com `pipeline_id` e `archived_at`; sem `version`, `custom_fields` e `deleted_batch_id` (lixeira usa o mesmo `deleted_at`)                              | 0037                                |
| 1A.1 colunas da pessoa      | `lifecycle_stage`, `lifecycle_changed_at`, `principal_deal_id` feitas; contadores e `first_won_at`/`last_won_at` não (calculados na leitura, decisão do M2.5) | 0037                                |
| 1A.2 ciclo de vida derivado | feito (F-3)                                                                                                                                                   | `oportunidade-transicao.service.js` |
| 1A.3 oportunidade principal | feito, com regra diferente (F-2: aberta mais recente em `sales`)                                                                                              | idem                                |
| 1A.4 projeção na tabela     | feita (F4/F5), sem selo `+N`                                                                                                                                  | `FONTE_LEADS`                       |
| 1A.5 UI                     | aba Oportunidades e Nova oportunidade feitas; colunas Ciclo de vida, Cliente desde, Última compra e Oportunidades abertas **não**                             | —                                   |
| 1A.6 migração e backfill    | não se aplica (sem dados)                                                                                                                                     | —                                   |
| 1A.7 edge cases             | mesclar, lixeira, categoria em uso (409), concorrência (`expectedUpdatedAt`) feitos                                                                           | M2.5 F4                             |
| 0.1 `entity` no `crm_field` | fora (decisão do dono)                                                                                                                                        | —                                   |
| 0.2 outbox                  | feito; consumido pelo M5                                                                                                                                      | 0037, M5                            |

As quatro colunas da 1A.5 que faltam entram na FC2, calculadas na leitura (`MIN/MAX(won_at)` e contagem), sem contador na pessoa.

---

## Trilha de formulários (flag `crm.formularios`)

### FM1. Formulário e versões

- [ ] Migration: `crm_form` (nome, descrição, ativo, `current_version_id`, `link_ttl_days` padrão 7) e `crm_form_version` (imutável depois de publicada: `sections`, `fields_snapshot`, `intro_text`, `consent_text`), com RLS.
- [ ] `crm_field.is_sensitive`: campo sensível nasce oculto para OPERADOR (`permissoes.service.js`) e sai do export por padrão (`export.service.js`).
- [ ] Configurações: criar, editar rascunho, publicar, desativar. Publicar copia label, tipo e opções de cada campo para `fields_snapshot`. Publicar com campo inativo ou fora da pessoa é 400. Escrita só de gestão.
- [ ] Item do formulário: `field_id`, `obrigatorio` (do formulário, independente do campo) e `write_policy` (`overwrite` ou `fill_if_empty`; padrão `fill_if_empty` para e-mail, telefone e CPF).
- [ ] Modelo inicial "Anamnese" semeado desligado pelo `reconciliarTenant`, só com campos que o tenant tem. **A confirmar com você no início do marco:** quais perguntas e quais campos novos a anamnese padrão cria.

**Aceite:** editar um formulário publicado gera versão nova, e a anterior não muda; OPERADOR não vê campo sensível na ficha nem no export.

### FM2. Link pessoal

- [ ] Migration: `crm_form_link` (`form_version_id`, `lead_id`, `deal_id` nulo, `token_hash`, `token_encrypted`, status, `expires_at`, `opened_at`, `revoked_at`) e índice único parcial `(tenant_id, lead_id, form_id) WHERE status = 'active'`.
- [ ] Token: 32 bytes de `crypto.randomBytes`, base64url. Busca por SHA-256. `token_encrypted` em AES-256-GCM com chave de ambiente `FORMS_TOKEN_KEY` (você gera; validada em `env.js`), só para "copiar de novo" devolver o mesmo link.
- [ ] `criarLinkDoFormulario(tenantId, leadId, formId, dealId?)`: devolve o ativo ou cria, com `ON CONFLICT` no índice parcial. Service isolado, pronto para o bot chamar.
- [ ] Expirado é avaliado na leitura. Revogar é imediato. Fechado vira "Gerar novo".
- [ ] Rotas na ficha: listar links e respostas da pessoa, copiar, revogar. Outbox: `form.link_created` e `form.link_revoked`, só com ids.

**Aceite:** copiar duas vezes devolve o mesmo link; duas chamadas simultâneas geram um link só; link revogado não abre.

### FM3. Página pública

- [ ] `Module.registerPublicRoutes` em `src/core/types/module.js`, registrado em `app.js` num escopo sem `authenticateHook`, prefixo `/public`. Documentar em `MODULE_CONTRACT.md`.
- [ ] Token → tenant pelo cliente admin, com consulta só por `token_hash` (padrão de `feature-flags.js`); o resto com `getTenantClient`. Confere módulo contratado e flag do tenant do link.
- [ ] `GET /public/f/:token`: snapshot da versão, primeiro nome, telefone mascarado, pré-preenchimento só de campos não sensíveis. Não muda estado. `POST /public/f/:token/aberto` marca `opened_at`.
- [ ] Cabeçalhos: `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, `Cache-Control: no-store`.
- [ ] `@fastify/rate-limit` com store Redis, por IP e por token. Logs da rota pública sem token e sem respostas, só `form_link_id`.
- [ ] Token inválido, expirado, revogado ou já respondido: mesma resposta 404 genérica (não revela qual).

**Aceite:** token de um tenant nunca lê dado de outro (teste de isolamento na rota pública); `GET` repetido não marca o link como aberto.

### FM4. Envio da resposta

- [ ] Uma transação: `SELECT … FOR UPDATE` no link, confere status e validade (tolerância de 2 h se `opened_at` < `expires_at`), valida contra o snapshot com os validadores de tipo que o CRM já usa (CPF, CEP, opções).
- [ ] `crm_form_submission` imutável: respostas, hash do termo, aceite, `filled_by`, `guardian_name`, IP, user agent e `write_report`.
- [ ] Gravar na pessoa pelo caminho do lead (`atualizarLeadExistente` ou a parte dele que não exige usuário), com `write_policy`. Valor de contato que pertence a outra pessoa (`encontrarDuplicados`) vai para revisão, não grava. Pessoa anonimizada ou na lixeira: recusa.
- [ ] Histórico na timeline da pessoa e `form.submitted` no outbox, na mesma transação. Link vira `submitted`.
- [ ] Ficha: `GET` das respostas de uma submissão, respeitando campo sensível.

**Aceite:** clique duplo grava uma resposta só; editar o campo na ficha não muda "Ver respostas"; o `write_report` mostra o que foi gravado, ignorado e mandado para revisão.

### FM5. Alertas

- [ ] Regra por formulário: "campo X = valor → alerta nível N, texto T", avaliada no envio.
- [ ] Alerta no topo da ficha até "visto" por quem tem acesso. Quem não vê o campo sensível recebe só o texto genérico.
- [ ] Selo de alerta no card do quadro comercial pelo `selos` que o card já tem. **A confirmar com você no início do marco.**

**Aceite:** OPERADOR sem acesso ao campo sensível vê o alerta genérico e não vê as respostas, nem pela API.

### FM6. LGPD e ciclo de vida da pessoa

- [ ] Anonimizar (`lgpd.service.js`): apaga respostas sensíveis das submissões e dos campos, mantém metadados mínimos, revoga links ativos.
- [ ] Mesclar (`mesclagem.service.js`): links e submissões vão para o principal; dois ativos do mesmo formulário → mantém o mais recente e revoga o outro.
- [ ] Arquivar e lixeira revogam links ativos; purga apaga em cascata.
- [ ] Menor de idade: `filled_by` e nome do responsável obrigatório quando é o responsável.
- [ ] **Parada do dono:** termo de aceite, fluxo de menor e política de exclusão validados com jurídico antes de ligar a flag em tenant real.

**Aceite:** depois de anonimizar, nenhuma resposta sensível sobra em `crm_form_submission`, nos campos ou no outbox.

### FM7. Uploads (marco próprio)

- [ ] **Você:** bucket S3-compatível (ex.: Cloudflare R2) e credenciais no `.env`.
- [ ] Tipo de campo `upload`. `POST /public/f/:token/uploads` devolve URL pré-assinada para prefixo temporário. Limites: 10 MB, 5 por campo, JPEG/PNG/HEIC/PDF conferido pelo conteúdo.
- [ ] No envio: reprocessar imagem sem EXIF (`sharp`), mover para o prefixo definitivo. Temporários órfãos: regra de ciclo de vida do bucket (24 h).
- [ ] Leitura só por URL assinada de 5 min. LGPD e purga apagam os arquivos.

**Aceite:** foto enviada chega sem EXIF; arquivo de outro tenant não abre nem com a chave.

---

## Trilha de forecast (flag `crm.forecast`)

### FC1. Probabilidade padrão

- [ ] Migration: `crm_option.default_probability`. Ganho 100 e perdido 0, fixos; status aberto exige valor. Seed e reconcile preenchem: Novo 10, Em contato 20, Qualificado 40, Proposta 60, Negociação 80.
- [ ] Override volta ao padrão quando o status muda (`planejarStatus` em `oportunidade-transicao.service.js`), e a resposta avisa.
- [ ] Configurações de status editam o padrão (só gestão).

**Aceite:** mudar o status limpa o override e avisa.

### FC2. Consulta e API

- [ ] Uma consulta agregada sobre `crm_deal`, só pipelines `sales`: realizado por `won_at` no fuso do tenant, ponderado e melhor caso por data prevista, blocos Atrasadas, Sem previsão e Sem valor. Soma no banco.
- [ ] Horizonte padrão: 3 meses para trás e 3 para frente. Agrupar por total, responsável da oportunidade e status. Filtro por pipeline.
- [ ] Mesmas regras de acesso do quadro: visibilidade por pipeline (D4) e permissão de Valor (quem não vê só recebe contagens, também na API).
- [ ] Cache de 60 s por tenant, filtros e papel, invalidado na escrita de oportunidade.
- [ ] Colunas da 1A.5 na tabela de leads: Ciclo de vida, Cliente desde, Última compra e Oportunidades abertas, calculadas na leitura.

**Aceite:** ponderado de um mês bate com a planilha para 20 oportunidades; ganha às 23:30 do último dia do mês em São Paulo cai no mês certo; p95 da consulta abaixo de 500 ms com 20 mil oportunidades.

### FC3. Assertividade

- [ ] Migration: `crm_forecast_snapshot`. Job semanal no `crm.worker.js` (segunda, 06:00 no fuso do tenant) para o mês atual e os 3 seguintes.
- [ ] Assertividade do mês fechado = realizado / ponderado do primeiro snapshot do mês.

**Aceite:** mudar a probabilidade padrão muda o forecast e não muda os snapshots.

---

## Fica de fora

| Item                                                           | Quando                                               |
| -------------------------------------------------------------- | ---------------------------------------------------- |
| `entity` no `crm_field`, campos personalizados na oportunidade | quando um formulário precisar gravar na oportunidade |
| Envio automático, lembretes, WhatsApp, NPS, régua de pós-venda | plano do bot                                         |
| Cursor do outbox por consumidor                                | plano do bot                                         |
| Segunda venda (D6)                                             | depois desta trilha, ou junto, se você preferir      |
| Meta mensal no forecast                                        | quando houver pedido                                 |
| Selo `+N` de oportunidades abertas na tabela                   | quando houver pedido                                 |

## Ordem e paradas

1. P0 (motivo da perda) e a tela do aceite do M3.
2. FM1 → FM2 → FM3 → FM4 → FM5 → FM6. Parada do jurídico antes de ligar em tenant real.
3. FM7 (uploads), depois que você criar o bucket.
4. FC1 → FC2 → FC3.
5. Piloto: tenant interno, depois um tenant real por uma semana, só então todos.

## Riscos

- **Vazamento de dado de saúde pelo link:** token de alta entropia só com hash no banco, nada sensível pré-preenchido, prévia genérica, rota pública sem token nos logs, rate limit.
- **Outbox com um consumidor só:** o quadro marca os eventos `form.*` como processados. Aceitável agora; o bot precisa de cursor próprio antes de consumir.
- **Rota pública é superfície nova:** escopo separado, sem reaproveitar `authenticateHook`, com teste de isolamento por tenant antes de qualquer outro aceite da FM3.
- **Escrita na pessoa fora do usuário:** a submissão passa pelas mesmas regras do lead (duplicidade, anonimizado, histórico); o que não couber vai para revisão, não é gravado em silêncio.
- **Teste que configura o que o aceite deveria provar:** testes de banco rodam no tenant padrão.
- **Forecast inflado por probabilidade otimista:** override volta ao padrão na mudança de status; a assertividade expõe o viés.

## Verificação

Em cada marco: gates verdes, aceite executado contra o banco de dev com tenant SMOKE e limpeza no fim (conferir zero tenant `smoke-`), proteções quebradas de propósito, boot real no Node. Na FM3 e na FM4, teste na tela com dois navegadores (como no M5): ficha gera o link, página pública responde, a ficha mostra as respostas. Marcar este plano e o documento do dono, e entregar o handoff.
