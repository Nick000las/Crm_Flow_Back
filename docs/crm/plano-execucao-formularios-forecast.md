# Plano de implementação: formulários, anamnese e forecast

Base: `docs/crm/CRMFlow — Plano de Implementação Oportunidades, Forecast e Formulários.md` (28/10/2026), conferido contra o código da branch `ref/CRMxKANBAN` e o banco de dev em 07/11/2026. As trilhas 1A, 1B e 2 e os nomes de tabela são os daquele documento; aqui estão a adaptação ao projeto e os checklists.

**Primeira ação depois de aprovado:** copiar este plano para `docs/crm/plano-execucao-formularios-forecast.md`, que vira a fonte dos checklists, e citar o arquivo em `docs/crm/README.md`.

## Contexto

O documento de sugestão foi escrito antes da integração com o Kanban. Desde então, o M2.5 entregou quase toda a trilha 1A (oportunidades e ciclo de vida) com outro desenho, e o M5 passou a consumir o outbox. Falta o que o documento chama de trilha 2 (motor de formulários, com a anamnese como primeiro uso) e trilha 1B (forecast). O plano de integração deixou os dois "para depois do M5", e o M5 está fechado.

**Decisões do dono (07/11/2026):**

- **Ordem:** formulários primeiro; forecast depois, como trilha menor.
- **Uploads:** marco próprio no fim da trilha de formulários. O formulário sai primeiro sem campo de arquivo.
- **Destino das respostas:** só campos da pessoa. `entity` no `crm_field` e `custom_fields` na oportunidade ficam fora; o link guarda `deal_id` só como referência. Revisto abaixo: as perguntas próprias do formulário ficam só na resposta.
- **Motivo da perda:** campo ligado por padrão, em tenants novos e existentes (pendência do M3, vira o marco P0).

**Revisão do dono (07/11/2026, depois da FM2): o formulário como o dono o vê.** Crio um formulário padrão, escolho quais campos do CRM aparecem, e quais deles já vêm preenchidos quando o CRM tem a informação; o resto a pessoa preenche. Junto vão perguntas próprias do formulário. Gero links individuais para quem eu escolher. Isso muda o plano em quatro pontos:

- **Perguntas próprias:** criadas dentro do formulário. A resposta fica só na resposta do formulário ("Ver respostas" na ficha) e não vira campo, coluna nem filtro da pessoa. Substitui "pergunta nova vira campo personalizado" da FM1.
- **Pré-preenchimento:** o dono marca, campo a campo, quais vêm preenchidos. Campo sensível nunca vem preenchido. Substitui "sem pré-preenchimento" da FM3.
- **Valor pré-preenchido é editável:** se a pessoa mudar, grava na ficha pela política do item (`overwrite` ou `fill_if_empty`).
- **Links:** pela ficha, um por vez, como a FM2 entregou. Envio em massa fica para o plano do bot.

O que já foi feito na FM1 e na FM2 continua valendo; o novo entra no marco FM2b, antes da página pública.

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

- [x] Migration 0043: `crm_form` (nome único por tenant sem diferenciar maiúscula, `draft` com o rascunho, `link_ttl_days` de 1 a 90, padrão 7) e `crm_form_version` (`sections`, `fields_snapshot`, `intro_text`, `consent_text` obrigatório), com RLS e FK por tenant. Imutável por trigger: `UPDATE` é recusado pelo banco (teste). O `app_tenant` também não tem `UPDATE` na tabela.
- [x] Migration 0042, `crm_field.is_sensitive`: marcado em `PUT /crm/configuracoes/campos/:id` (`sensivel`). Para o OPERADOR, sem linha de permissão, o campo é oculto, com ou sem `crm.permissoes`; com a flag, o dono pode liberá-lo (grava `edit`). Nome, contato e campos de LGPD não podem ser sensíveis. Sai das colunas padrão do export e só vai quando pedido pelo nome (`campo-sensivel.db.test.js`, `export.service.test.js`).
- [x] Configurações (`/crm/configuracoes/formularios`): listar, campos elegíveis, criar, editar (dados e rascunho), desativar e reativar, publicar e ler uma versão. Publicar copia label, tipo e opções de cada campo para `fields_snapshot` e exige ao menos um campo e o termo. Campo desligado depois de salvo bloqueia a publicação (400). Só gestão, atrás de `crm.formularios`. Duas publicações simultâneas geram versões 1 e 2 (a linha do formulário é travada).
- [x] Item do formulário: `campoId`, `obrigatorio` (do formulário, independente do campo) e `politica` (`overwrite` ou `fill_if_empty`). Padrão `fill_if_empty` para e-mail, telefone, CPF e CNPJ: CNPJ entrou junto por ser documento, como o CPF.
- [x] **Decisão do dono (07/11/2026):** o formulário é uma seleção dos campos da pessoa que o CRM já tem, cada um ligado pelo dono. Pergunta nova (ex.: "Alergias") é criada como campo personalizado em Configurações. Sem modelo de anamnese semeado. **Revisto depois da FM2:** pergunta nova também pode ser criada dentro do formulário, com a resposta só na resposta do formulário (FM2b).
- [x] Campos elegíveis: campos ligados da pessoa que a pessoa preenche. Ficam de fora os carimbados pelo sistema (responsável, score, ciclo de vida, LGPD, só leitura) e os comerciais da oportunidade (status, valor, motivo, previsão, probabilidade). A API devolve a lista de elegíveis para a tela de montar. Do sistema: nome, e-mail, telefone, empresa, cargo, CPF, CNPJ, cidade, UF, CEP e endereço (`CHAVES_SISTEMA_DO_FORMULARIO`); personalizados, menos os do tipo usuário.
- [x] Endereço entra inteiro. Escolher só partes (cidade e UF) fica para depois.

**Aceite**

- [x] Editar um formulário publicado gera versão nova, e a anterior não muda: renomear o campo e trocar o rascunho, publicar a v2 e reler a v1 dá o mesmo conteúdo, com o nome antigo (`controllers/formularios.db.test.js`).
- [x] OPERADOR não vê campo sensível na ficha: não aparece em `/fields`, não vem no lead e não é gravado (403). O export é só de gestão, então o OPERADOR nem exporta; para a gestão, o sensível fica fora das colunas padrão.
- [x] Gates verdes: 1090 de 1090 em 07/11/2026, com banco, Redis e os testes de integração do Kanban. Lint, formato, RLS, FK, isolamento e boot real no Node.
- [x] 10 proteções quebradas uma a uma, todas detectadas: elegibilidade, campo repetido, termo, comparação de rascunho, trava da publicação, padrão do sensível com e sem a flag, contato sensível, export e papel.

**Handoff ao front:** `handoff-front-fm1.md`.

### FM2. Link pessoal

- [x] Migration 0044: `crm_form_link` (`form_version_id`, `lead_id`, `deal_id` nulo, `token_hash`, `token_encrypted`, status, `expires_at`, `opened_at`, `submitted_at`, `revoked_at`, autor), com RLS e FK por tenant. Índice único parcial `(tenant_id, lead_id, form_id) WHERE status = 'active'` e único em `token_hash`. Checks deixam status e datas coerentes (revogado com `revoked_at`, respondido com `submitted_at`).
- [x] Token: 32 bytes de `crypto.randomBytes`, base64url. Busca por SHA-256. `token_encrypted` em AES-256-GCM com `FORMS_TOKEN_KEY` (você gerou; `env.js` exige 32 bytes em base64 e trata vazio como ausente). Sem a chave, a rota responde 503 `FORMS_UNAVAILABLE` e não grava nada (`token-formulario.service.test.js`, `formulario-links.db.test.js`).
- [x] `criarLinkDoFormulario(tenantId, leadId, formId, { oportunidadeId, usuarioId })`: devolve o ativo ou cria, com `ON CONFLICT` no índice parcial. Service isolado, sem depender de sessão: pronto para o bot.
- [x] Vencido é avaliado na leitura (status `expired` derivado) e, ao copiar, o vencido é fechado e outro nasce. Revogar é imediato e só vale para link ativo (409 nos outros). Fechado vira "Gerar novo" (mesmo `POST`, 201, outra URL). O link fica na versão em que nasceu: publicar a v2 não muda um ativo.
- [x] Rotas na ficha (só com `crm.formularios`, qualquer papel que vê a pessoa): formulários disponíveis, links da pessoa, copiar e revogar. Outbox: `form.link_created` e `form.link_revoked` com só ids no payload (teste confere que nem token nem hash vão). O despacho do quadro passou a avisar só eventos de oportunidade: os de formulário são confirmados sem aviso (`quadro-eventos.service.test.js`, `quadro-tempo-real.db.test.js`).
- [ ] Listar **respostas** da pessoa na ficha: fica para a FM4, que cria as submissões.

**Aceite**

- [x] Copiar duas vezes devolve o mesmo link: mesma `url`, 201 e depois 200 (`formulario-links.db.test.js`).
- [x] Duas chamadas simultâneas geram um link só: `Promise.all` de dois `POST`, mesma `url`, uma linha ativa no banco.
- [x] Link revogado não abre: no banco o revogado sai de ativo e o próximo copiar gera outro token; na rota pública da FM3, o token revogado responde o mesmo 404 de um token inventado (`formulario-publico.db.test.js`).
- [x] Gates verdes em 07/11/2026, com banco, Redis e os testes de integração do Kanban: lint, formato, RLS, FK, isolamento e boot real no Node.
- [x] 9 proteções quebradas uma a uma, todas detectadas: `ON CONFLICT`, token reaproveitado, troca do vencido, status derivado, pessoa anonimizada, oportunidade de outra pessoa, formulário sem versão, evento do link e estado ao revogar. Mais uma no despacho: aviso para evento que não é de oportunidade.

**Handoff ao front:** `handoff-front-fm2.md`.

### FM2b. Perguntas próprias e pré-preenchimento

Fecha a revisão do dono. Sem migration: rascunho e versão já guardam as seções em jsonb.

- [x] Item do tipo `pergunta` no rascunho, ao lado do item `campo`, escolhido pela chave `pergunta`: id próprio (gerado pelo servidor quando falta e mantido quando o front o devolve), rótulo, ajuda opcional, tipo, opções, `obrigatorio` e `sensivel`. Tipos: `TIPOS_PERGUNTA`, os do CRM menos `usuario` e `endereco`. Seleção exige de 1 a 50 opções, sem repetir; outro tipo não aceita opções. Erros apontam o lugar exato (`rascunho.secoes.<s>.itens.<i>.pergunta.<chave>`).
- [x] Pergunta não cria nem altera `crm_field`: o teste conta os campos do tenant antes e depois de publicar.
- [x] `sensivel` na pergunta, padrão desligado, guardado na versão. O efeito (esconder a resposta, alerta genérico) vem na FM4 e na FM5.
- [x] Item `campo` ganha `preencher` (padrão desligado). Campo sensível não pode vir preenchido: 400 em `...itens.<i>.preencher` ao salvar e ao publicar, inclusive se o campo virou sensível depois de salvo. Campos elegíveis trazem `podePreencher`.
- [x] A versão guarda `preencher` e as perguntas nas seções; a pergunta não entra em `fields_snapshot`. Versão no formato da FM1 é lida com `preencher: false` (`comPadroes`), e `alteracoesNaoPublicadas` não acusa diferença por isso.
- [x] Handoff com o formato novo do rascunho: `handoff-front-fm2b.md`.

**Aceite**

- [x] Formulário com campos e perguntas próprias publica, e a versão relida traz os dois, na ordem do rascunho (`controllers/formularios.db.test.js`).
- [x] Publicar com `preencher` em campo sensível é 400 no item.
- [x] Publicar um formulário com perguntas não muda a lista de campos do CRM.
- [x] A versão no formato da FM1 continua lida igual: inserida direto no banco no formato antigo e relida pela API.
- [x] Gates verdes em 07/11/2026: 1122 de 1122 com banco, Redis e Kanban; lint, formato, RLS, FK, isolamento e boot real no Node. Nenhum tenant SMOKE sobrando.
- [x] 10 proteções quebradas uma a uma, 9 detectadas: pré-preencher sensível, `podePreencher`, retrato sem pergunta, padrão da versão antiga, id mantido, opções, pergunta repetida, escolha do schema e tipo `usuario`. A que passou (versão tratar pergunta como campo) só acrescenta `campo: undefined`, que o JSON descarta: a resposta é igual, então não é uma proteção.

**Handoff ao front:** `handoff-front-fm2b.md`.

### FM3. Página pública

- [x] `Module.registerPublicRoutes` em `src/core/types/module.js` (validado por `assertModule`), registrado em `app.js` num escopo próprio, sem `authenticateHook` nem `exigirModuloAtivo`, com prefixo `/public`. Documentado em `MODULE_CONTRACT.md`.
- [x] Token → tenant pelo cliente admin, com consulta só por `token_hash` e só devolvendo o `tenant_id`; o resto com `getTenantClient`, sob RLS. Confere módulo contratado, flag `crm.formularios` e status do tenant (suspenso ou cancelado não abre).
- [x] `GET /public/f/:token`: versão, nome do formulário, primeiro nome e prazo. Campo com `preencher` traz o valor atual da pessoa, lido na hora, só se o campo continua elegível e não é sensível nesse momento. Nada interno sai (política, chave, camada, marca de sensível). Não muda estado. `POST /public/f/:token/aberto` marca `opened_at` uma vez só.
- [x] Cabeçalhos em todo `/public`: `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`.
- [x] `@fastify/rate-limit` 11.2.1 (a 11.2.2 tinha menos de duas semanas), com Redis quando há `REDIS_URL`: 120 por minuto por IP em todo `/public` e 30 por minuto por link (chave = hash do token). 429 com `RATE_LIMITED` e `Retry-After`. Redis fora do ar não derruba a página (`skipOnError`).
- [x] Log: a URL de `/public` sai como `/public/f/[oculto]` (serializador do app); a rota loga só `formLinkId`. Teste confere que nem o token nem o nome da pessoa aparecem no log.
- [x] Token mal formado, inexistente, vencido, revogado, respondido, de formulário desativado, de pessoa arquivada ou na lixeira, com flag ou empresa desligada: o mesmo 404, com o mesmo corpo.

**Aceite**

- [x] Token de um tenant nunca lê dado de outro: dois tenants, cada token traz só a sua pessoa e o seu formulário, e o link de um não existe sob o RLS do outro.
- [x] `GET` repetido não marca o link como aberto; o `POST /aberto` marca, e repetir não muda a data.
- [x] Campo marcado como sensível depois de publicar não vem preenchido.
- [x] Link revogado não abre (fecha o aceite da FM2).
- [x] Gates verdes em 08/11/2026: 1138 de 1138 com banco, Redis e Kanban; lint, formato, RLS, FK, isolamento e boot real no Node (a rota pública responde com o limite ativo). Nenhum tenant SMOKE sobrando.
- [x] 13 proteções quebradas uma a uma, todas detectadas: empresa suspensa, revogado, vencido, formulário desativado, pessoa arquivada, flag, sensível preenchido, marca de sensível exposta, `GET` marcando abertura, data de abertura trocada, limite por link, `no-store` e token no log.
- [ ] Teste na tela com dois navegadores (ficha gera o link, a página pública abre): depende da página `/f/:token` no front.

**Achados**

- O `rateLimit()` de rota do plugin é pulado quando já há o limite global: o plugin marca o pedido. O limite por link usa `createRateLimit()` com checagem manual.
- Sem Redis, a store em memória do plugin bloqueia todos os pedidos que chegam ao mesmo tempo, mesmo os primeiros (erra para o lado seguro). Com Redis a contagem é atômica. Os testes de limite rodam em sequência.
- O app não usa `trustProxy`: atrás de um proxy, o limite por IP conta o IP do proxy. Antes de produção, ligar `trustProxy` com o endereço do proxy.

**Handoff ao front:** `handoff-front-fm3.md`.

### FM4. Envio da resposta

- [ ] Uma transação: `SELECT … FOR UPDATE` no link, confere status e validade (tolerância de 2 h se `opened_at` < `expires_at`), valida contra o snapshot com os validadores de tipo que o CRM já usa (CPF, CEP, opções).
- [ ] `crm_form_submission` imutável: respostas, hash do termo, aceite, `filled_by`, `guardian_name`, IP, user agent e `write_report`.
- [ ] Gravar na pessoa pelo caminho do lead (`atualizarLeadExistente` ou a parte dele que não exige usuário), com `write_policy`. Valor de contato que pertence a outra pessoa (`encontrarDuplicados`) vai para revisão, não grava. Pessoa anonimizada ou na lixeira: recusa.
- [ ] Campo pré-preenchido que a pessoa não mudou: o `write_report` marca como mantido e nada é gravado. Mudou: grava pela política do item. Respostas das perguntas próprias ficam só na submissão, validadas pelo tipo da pergunta.
- [ ] Histórico na timeline da pessoa e `form.submitted` no outbox, na mesma transação. Link vira `submitted`.
- [ ] Ficha: lista das respostas da pessoa (pendente da FM2) e `GET` de uma submissão, com campos e perguntas. Campo e pergunta sensíveis só para quem vê sensível.

**Aceite:** clique duplo grava uma resposta só; editar o campo na ficha não muda "Ver respostas"; o `write_report` mostra o que foi gravado, ignorado e mandado para revisão.

### FM5. Alertas

- [ ] Regra por formulário: "campo ou pergunta X = valor → alerta nível N, texto T", avaliada no envio.
- [ ] Alerta no topo da ficha até "visto" por quem tem acesso. Quem não vê o campo sensível recebe só o texto genérico.
- [ ] Selo de alerta no card do quadro comercial pelo `selos` que o card já tem. **A confirmar com você no início do marco.**

**Aceite:** OPERADOR sem acesso ao campo sensível vê o alerta genérico e não vê as respostas, nem pela API.

### FM6. LGPD e ciclo de vida da pessoa

- [ ] Anonimizar (`lgpd.service.js`): apaga as respostas das perguntas próprias (todas, não só as sensíveis: não há outro lugar com esse dado) e as respostas sensíveis dos campos, mantém metadados mínimos, revoga links ativos.
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
| Gerar links em massa pela tabela de leads                      | plano do bot                                         |
| Cursor do outbox por consumidor                                | plano do bot                                         |
| Segunda venda (D6)                                             | depois desta trilha, ou junto, se você preferir      |
| Meta mensal no forecast                                        | quando houver pedido                                 |
| Selo `+N` de oportunidades abertas na tabela                   | quando houver pedido                                 |

## Ordem e paradas

1. P0 (motivo da perda) e a tela do aceite do M3.
2. FM1 → FM2 → FM2b → FM3 → FM4 → FM5 → FM6. Parada do jurídico antes de ligar em tenant real.
3. FM7 (uploads), depois que você criar o bucket.
4. FC1 → FC2 → FC3.
5. Piloto: tenant interno, depois um tenant real por uma semana, só então todos.

## Riscos

- **Vazamento de dado pelo link:** com o pré-preenchimento, um link encaminhado mostra os campos que o dono marcou. Defesas: o dono escolhe campo a campo, sensível nunca vem preenchido (conferido na hora da leitura), token de alta entropia só com hash no banco, validade curta, revogação, prévia genérica, rota pública sem token nos logs, rate limit.
- **Outbox com um consumidor só:** o quadro marca os eventos `form.*` como processados. Aceitável agora; o bot precisa de cursor próprio antes de consumir.
- **Rota pública é superfície nova:** escopo separado, sem reaproveitar `authenticateHook`, com teste de isolamento por tenant antes de qualquer outro aceite da FM3.
- **Escrita na pessoa fora do usuário:** a submissão passa pelas mesmas regras do lead (duplicidade, anonimizado, histórico); o que não couber vai para revisão, não é gravado em silêncio.
- **Teste que configura o que o aceite deveria provar:** testes de banco rodam no tenant padrão.
- **Forecast inflado por probabilidade otimista:** override volta ao padrão na mudança de status; a assertividade expõe o viés.

## Verificação

Em cada marco: gates verdes, aceite executado contra o banco de dev com tenant SMOKE e limpeza no fim (conferir zero tenant `smoke-`), proteções quebradas de propósito, boot real no Node. Na FM3 e na FM4, teste na tela com dois navegadores (como no M5): ficha gera o link, página pública responde, a ficha mostra as respostas. Marcar este plano e o documento do dono, e entregar o handoff.
