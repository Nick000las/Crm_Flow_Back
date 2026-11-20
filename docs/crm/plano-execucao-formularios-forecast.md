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
- [x] Listar **respostas** da pessoa na ficha: entregue na FM4 (`GET /crm/leads/:id/formularios/respostas`).

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

- [x] `POST /public/f/:token/respostas`, com o mesmo 404 genérico e os mesmos limites da FM3. Validação contra a versão do link, com os validadores de tipo do CRM (`valorValidoParaTipo`, `normalizarValorDoTipo`): obrigatório respondido, valor do tipo, opção existente, sem chave de fora. Erro 400 em `respostas.<campoId | perguntaId>`; o link continua ativo para corrigir.
- [x] Prazo com folga: quem abriu antes de vencer envia (e recarrega a página) até 2 h depois do vencimento (`LINK_NO_PRAZO_SQL`, também na leitura da FM3).
- [x] Migration 0045, `crm_form_submission`: respostas (`{ campos, perguntas }`), SHA-256 do termo, data do aceite, `filled_by` (`titular` ou `responsavel`, com o nome dele por CHECK), IP, navegador e `write_report`. Uma por link (`UNIQUE (link_id)`). Imutável por trigger (só a FK que zera a oportunidade passa), sem `UPDATE` para o `app_tenant`, RLS e FK por tenant.
- [x] Escrita na pessoa pelo caminho da ficha (`atualizarLeadExistente`, sem autor), com `write_policy`: `overwrite` grava; `fill_if_empty` só grava se a pessoa não tinha valor, senão vai para revisão. Igual ao salvo é ignorado; vazio nunca apaga. Contato e documento que já são de outra pessoa (`encontrarDuplicados`, com as quatro regras ligadas, independente da configuração do tenant) vão para revisão. Regra do CRM que recusa a edição (400): a resposta é gravada e os campos vão para revisão. Pessoa anonimizada, arquivada ou na lixeira: 404.
- [x] Mesma transação: a edição do lead trava a pessoa e, pelos ganchos novos de `atualizarLead` (`conferir` recebe a transação; `depoisDeGravar`), trava o link, grava a resposta, fecha o link, escreve `formulario_respondido` no histórico e publica `form.submitted` (só ids). Resposta sem campo a gravar usa o mesmo travamento, pessoa antes do link. Se a pessoa mudou entre o plano e a gravação, o plano é refeito uma vez.
- [x] Ficha: lista das respostas (com a contagem do que foi gravado, ignorado e para revisão) e o detalhe, na versão que a pessoa viu, com `escrita` por campo. Campo que o papel não vê e pergunta sensível (só gestão) saem `oculto`, sem valor. IP e navegador só para a gestão.

**Aceite**

- [x] Clique duplo grava uma resposta só: três envios simultâneos, um 201 e dois 404, uma resposta no banco (`formulario-respostas.db.test.js`).
- [x] Editar o campo na ficha não muda "Ver respostas": a resposta mantém o valor declarado, a ficha mostra o novo.
- [x] O `write_report` mostra o que foi gravado, ignorado (igual, sem resposta) e mandado para revisão (valor diferente, contato de outra pessoa, regra do CRM, campo indisponível).
- [x] O banco recusa alterar uma resposta.
- [x] Gates verdes em 08/11/2026: 1154 de 1154 com banco, Redis e Kanban; lint, formato, RLS, FK, isolamento e boot real no Node. Nenhum tenant SMOKE sobrando.
- [x] 13 proteções quebradas uma a uma, todas detectadas: link respondido aceitando outra, link sem fechar, `fill_if_empty`, valor igual, contato de outra pessoa, regra do CRM, obrigatório, tipo, pergunta sensível, campo oculto, IP para o OPERADOR, folga do prazo e resposta fora da transação da edição.
- [ ] Teste na tela com dois navegadores (ficha gera o link, a página pública envia, a ficha mostra as respostas): depende das telas do front.

**Decisões tomadas no marco (para confirmar):** pergunta sensível só aparece para a gestão (não há permissão por pergunta); duplicidade de contato vale mesmo com `crm.duplicidade` desligada; a resposta não conta como interação (`ultimaInteracaoEm` não muda).

**Handoff ao front:** `handoff-front-fm4.md`.

### FM5. Alertas

**Decisões do dono (15/11/2026):** alerta na ficha e como selo no card do quadro comercial; "visto" por usuário (cada um vê até marcar o seu); três níveis, informativo, atenção e crítico (`info`, `warning`, `critical`), e o card mostra o mais grave não visto.

- [x] Regra por formulário, no rascunho (`alertas`) e publicada com a versão (migration 0046, `crm_form_version.alert_rules`): alvo (campo ou pergunta do próprio rascunho), operador, valor, nível e texto. Mesmos operadores do filtro por tipo (`OPERADORES_POR_TIPO`); valor conferido pelo tipo do alvo (`valorDaCondicao`). Alvo removido do rascunho, operador que não vale para o tipo ou valor inválido: 400 em `rascunho.alertas.<i>.<chave>`.
- [x] Avaliada no envio da resposta (FM4), com o `avaliarCondicao` das regras do CRM, na mesma transação da resposta: cada regra que casa vira um `crm_form_alert` da pessoa (migration 0046), com a marca de sensível do alvo na versão. O alerta publica `person.updated` no outbox, para o card da pessoa ser avisado mesmo quando a resposta não grava campo.
- [x] Ficha: `GET /crm/leads/:id/formularios/alertas` (não vistos por quem pede; `?todos=true` com os vistos) e `POST .../alertas/:alertaId/visto` (por usuário, `crm_form_alert_seen`, idempotente). Quem não vê o alvo recebe o nível e o texto genérico (`TEXTO_ALERTA_GENERICO`). A regra de quem vê o quê é a mesma do "Ver respostas" (`formulario-visibilidade.service.js`).
- [x] Selo `alerta_formulario` no card do quadro comercial (`selosDoCard`), com o nível mais grave entre os alertas que quem vê o card não marcou; nunca traz o texto. Só com `crm.formularios`.

**Aceite**

- [x] OPERADOR sem acesso ao campo sensível vê o alerta genérico e não vê as respostas, nem pela API: os alertas de campo sensível e de pergunta sensível vêm genéricos, sem o texto da regra; "Ver respostas" esconde os dois valores (`formulario-alertas.db.test.js`).
- [x] Visto por usuário: o DONO marca, o alerta sai para ele e continua para o OPERADOR; o selo do card do DONO cai para o próximo nível e some depois do último.
- [x] Gates verdes em 15/11/2026: 1167 de 1167 com banco, Redis e Kanban; lint, formato, RLS, FK, isolamento e boot real no Node. Nenhum tenant SMOKE sobrando. Na primeira bateria, um teste do tempo real ficou preso 454 s numa conexão com o banco e deixou um tenant SMOKE; o arquivo passou três vezes sozinho (1,2 s), o tenant foi apagado como o teste apaga e a bateria inteira foi refeita.
- [x] 10 proteções quebradas uma a uma, todas detectadas: alvo fora do rascunho, operador × tipo, avaliação da regra, texto do sensível, visto por usuário na lista e no selo, lista ignorando o visto, nível mais grave, aviso ao card e flag no selo.
- [ ] Teste na tela com dois navegadores: depende das telas do front.

**Handoff ao front:** `handoff-front-fm5.md`.

### FM6. LGPD e ciclo de vida da pessoa

- [x] Anonimizar (`lgpd.service.js`): apaga as respostas das perguntas próprias (todas, não só as sensíveis: não há outro lugar com esse dado) e as respostas sensíveis dos campos, mantém metadados mínimos, revoga links ativos. (15/11/2026: `anonimizarFormulariosDasPessoas` em `crm-form-ciclo.repository.js`, chamado por `anonimizarLead`. A resposta perde **todos** os valores, campos inclusive; o nome do responsável vira "Anonimizado"; IP e navegador vão a null; alertas apagados. Campo personalizado sensível deixa de sobreviver à anonimização (`personalizadosMantidos`). Ficam formulário, versão, datas, aceite e relatório de escrita. Migration 0047 libera só essas colunas, com o GUC da LGPD.)
- [x] Mesclar (`mesclagem.service.js`): links e submissões vão para o principal; dois ativos do mesmo formulário → mantém o mais recente e revoga o outro. (15/11/2026: `moverFormulariosNaMesclagem`, chamado em `mesclarLeads` de `leads.repository.js`; alertas e "visto" vão junto; a troca de pessoa na resposta imutável passa só com o GUC `app.form_mesclando`, e o banco continua recusando mudar `answers`.)
- [x] Arquivar e lixeira revogam links ativos; purga apaga em cascata. (15/11/2026: `definirArquivamento` e `moverParaLixeira`; desarquivar e restaurar não reativam o link; purga provada sem sobra de link, resposta ou alerta.)
- [x] Menor de idade: `filled_by` e nome do responsável obrigatório quando é o responsável. (Entregue na FM4: CHECK em `crm_form_submission` e `nomeResponsavel` obrigatório no schema do envio; sem validação de idade, quem preenche se declara.)
- [ ] **Parada do dono:** termo de aceite, fluxo de menor e política de exclusão validados com jurídico antes de ligar a flag em tenant real. (Aberto: depende do jurídico. Atenção à guarda de prontuário: hoje a anonimização apaga **todos** os valores da resposta.)

**Aceite:** depois de anonimizar, nenhuma resposta sensível sobra em `crm_form_submission`, nos campos ou no outbox. ✅ (15/11/2026: `formulario-ciclo.db.test.js` procura o segredo em submissões, leads, eventos da pessoa e outbox; 6/6 testes, 10/10 sabotagens detectadas, bateria completa 1173 testes, cobertura de RLS/FK e isolamento verdes, boot OK, zero tenant SMOKE.)

### FM7. Uploads: fora deste plano

**Decisão do dono (19/11/2026):** uploads saem do plano e vão para "Fica de fora". O formulário fica sem campo de arquivo. Quando o bucket existir, entram num plano próprio, com o que estava previsto aqui: tipo `upload`, URL pré-assinada para um prefixo temporário, 10 MB e 5 arquivos por campo, JPEG/PNG/HEIC/PDF conferidos pelo conteúdo, EXIF removido com `sharp`, leitura por URL assinada de 5 min, e LGPD e purga apagando os arquivos.

---

## Trilha de forecast (flag `crm.forecast`)

**Decisões do dono (19/11/2026):**

- **Data prevista e Probabilidade ligam com a flag:** os dois campos continuam desligados por padrão (Camada 2). Ligar `crm.forecast` num tenant liga os dois. Desligar a flag não desliga os campos. Se o dono desligar um campo depois, o forecast avisa.
- **Ordem:** FC1 → FC2 → FC3 → FC4, com parada e handoff ao fim de cada um.

O que já existe e não muda: `crm_deal.probability_override` (0–100), `expected_close_date DATE` e `won_at TIMESTAMP` (UTC), com os índices `idx_crm_deal_previsao` e `idx_crm_deal_ganhas` (0037). Não há coluna nova em `crm_deal`.

### FC1. Probabilidade padrão por status

- [x] Migration 0048: `crm_option.default_probability SMALLINT`, 0–100, só em status. CHECK `chk_crm_option_probabilidade_status`: ganho = 100, perdido = 0, aberto não nulo, outras listas nulo. **Mudou do plano:** quem preenche é um trigger (`crm_option_probabilidade_padrao`), não cada caminho de escrita. Ele cobre o seed das listas, o pipeline novo, o status criado em Configurações e a troca de categoria. Ganho e perdido são forçados a 100 e 0; aberto sem valor recebe a sugestão pela chave (novo 10, em_contato 20, qualificado 40, proposta 60, negociacao 80) ou 10. Os status existentes foram preenchidos pelo próprio trigger, sem mexer em `updated_at`.
- [x] `PROBABILIDADE_PADRAO` em `constants/listas.js` (`FIXA`, `SUGERIDA`, `ABERTO_SEM_SUGESTAO`) espelha o trigger, para a validação e os testes. O teste de banco confere que o banco segue a constante. `inserirOpcoes` e `atualizarOpcao` gravam `probabilidadePadrao` quando ele vem.
- [x] Status (e toda opção) devolve `probabilidadePadrao` (`RETORNO_OPCAO_SQL`). Criar e editar aceitam o campo (inteiro 0–100, só gestão: as rotas já eram `apenasGestao`). Ganho e perdido com outro valor dão 400 em `probabilidadePadrao` (`validarProbabilidadePadrao`), também quando a categoria muda junto. Em outra lista, o campo também dá 400. **Mudou do plano:** o status que volta a ser aberto recebe a sugestão em vez de exigir o valor; se o valor vier junto, vale o mandado.
- [x] Função pura `probabilidadeEfetiva(override, padrao)`. A oportunidade devolve `probabilidadeEfetiva`: a leitura traz `probabilidade_padrao` do status por subconsulta (`probabilidadeDoStatusSql`). Some junto com `probabilidadeFechamento` quando o campo é desligado ou oculto (`SAIDA_DOS_CAMPOS_DA_OPORTUNIDADE`).
- [x] Override volta ao padrão: `planejarStatus` zera `probability_override` quando o status muda (também entre dois status da mesma categoria) e devolve `probabilidadeRedefinida`. A probabilidade mandada junto vence: no `PUT` do lead (`planejarEdicaoDoLead`), no `PATCH .../status` (o corpo aceita `probabilidadeFechamento`) e no mover (`campos.probabilidadeFechamento`). As regras do M8 avaliam a probabilidade já depois da mudança.
- [x] `avisos` (`PROBABILIDADE_REDEFINIDA`, com `anterior`) no `PATCH .../status`, no resultado do mover do quadro e no `PUT` do lead; sempre uma lista. O aviso traz o valor anterior, então quem não vê Probabilidade recebe a lista vazia. **Mudou do plano:** o `PUT` da oportunidade não muda status, então não tem aviso.
- [x] Flag `crm.forecast` em `CRM_FEATURES`.
- [x] Gancho `Module.aoLigarFeatures(tenantId, chaves)` em `src/core/types/module.js`, validado em `assertModule` e documentado em `MODULE_CONTRACT.md`. `atualizarFeaturesTenant` lê as flags ligadas antes e, depois do commit, chama `avisarFeaturesLigadas` (`#core/tenant/reconcile.js`) só com as que acabaram de ligar. É best-effort: o erro é logado e a flag fica ligada. O CRM (`aoLigarFeaturesDoCrm`, `forecast-flag.service.js`) liga Data prevista e Probabilidade em todos os contextos (`CAMPOS_DO_FORECAST`).

**Aceite**

- [x] Mudar o status de uma oportunidade com override limpa o override, e a resposta avisa com o valor anterior. Status e probabilidade juntos mantêm a mandada, sem aviso. Vale no `PATCH`, no `PUT` do lead e no mover (`controllers/forecast-probabilidade.db.test.js`, 11 testes).
- [x] Ganho e perdido não aceitam outro valor (400 na API; o banco força 100 e 0). Um `UPDATE` direto que zera a probabilidade de um aberto volta com a sugestão, e outra lista com probabilidade é recusada pelo CHECK.
- [x] Num tenant novo, sem ligar nada na preparação, Data prevista e Probabilidade nascem desligadas. Ligar `crm.forecast` por `atualizarFeaturesTenant` liga as duas, e desligar a flag as mantém. Religar a flag liga de novo um campo que o dono tinha desligado; manter a flag ligada não toca nele.
- [x] Gates verdes em 19/11/2026: 1191 de 1191 com banco e os testes de integração do Kanban, cache em memória (4 pulados, os que exigem Redis). Com Redis (`REDIS_URL`), os testes da FC1 e os de banco passam; ver o achado sobre cache abaixo. Lint, formato (`--end-of-line auto`), RLS, FK, isolamento e boot real no Node (`/health` 200; rota do CRM sem token 401). Nenhum tenant SMOKE sobrando.
- [x] 11 proteções quebradas uma a uma, todas detectadas: volta ao padrão, probabilidade mandada vencendo, aviso só para quem vê, ganho e perdido fixos na API, flag ligando os campos, só as flags novas, `probabilidadePadrao` na opção, efetiva usando o override, aviso no `PUT` do lead, efetiva sumindo com o campo e aviso no mover.

**Achados**

- Os arquivos do repositório estão em CRLF no disco (`core.autocrlf=true`), e o `.prettierrc.json` pede LF. Assim, `pnpm format:check` acusa todos os arquivos, inclusive os não tocados. O gate de formato desta entrega foi `prettier --check --end-of-line auto .`, que confere o estilo e ignora o fim de linha.
- Na bateria com Redis de verdade, três testes de unidade de cache (`module-access`, `field-definitions`, a rota de inatividade) às vezes falham, porque arquivos em paralelo dividem as mesmas chaves (`tenant-1`). Sozinhos, passam. Não é da FC1, mas vale isolar as chaves por arquivo.

**Handoff ao front:** `handoff-front-fc1.md`.

### FC2. Consulta e API do forecast

**Decisões do dono (19/11/2026):** oportunidade de pessoa anonimizada **entra** no forecast (é venda real; a lista mostra o nome anonimizado), revendo "não anonimizadas" do plano; **todos os papéis** abrem o forecast, com as restrições de pipeline e de Valor.

**Como foi feito (orquestração, decisão do dono):** especificação e revisão com Opus; consulta, service, permissões, cache e rotas com Opus em esforço médio; testes de aceite, teste de carga e handoff com Sonnet; um caso de teste mecânico com Haiku. Gates e proteções conferidos por quem coordena.

- [x] `adapters/crm-forecast.repository.js`: uma consulta agregada sob RLS (`consultaAgregada`), com `GROUPING SETS` quando há agrupamento, somas e ponderado no banco (`round(sum(amount × probabilidade / 100), 2)`, devolvidos em texto) e previsto também no SQL. Escopo: pipelines `sales` ativos e visíveis ao papel; oportunidade e pessoa fora do arquivo e da lixeira. Probabilidade efetiva `COALESCE(probability_override, default_probability)`.
  - Realizado pelo mês de `(won_at AT TIME ZONE 'UTC') AT TIME ZONE <fuso>`; ponderado e melhor caso pelo mês da data prevista, de hoje em diante (hoje no fuso do tenant).
  - Cada oportunidade cai numa faixa só: um mês, Atrasadas, **Antes do período** (acrescentado: abertas de hoje em diante antes do mês `de`, quando o período começa no futuro; sem ele, sumiam), Sem previsão ou Além do horizonte. Sem valor conta à parte.
- [x] `GET /crm/forecast` (`forecast.controller.js`, `forecast.service.js`, `forecast.schema.js`): `de`/`ate` (padrão 3 para trás e 3 para frente; até 24 meses), `pipelineId` (404 se não é vendas, ativo e visível), `responsavelId`, `agrupar=total|responsavel|status`. `status` exige `pipelineId` e, acrescentado, que o papel veja o campo Status. Devolve `fuso`, `hoje`, `periodo`, `meses` (todos, mesmo sem dado), `blocos`, `grupos`, `veValor`, `veProbabilidade`, `camposDesligados` e `vazio`. `vazio` ignora os filtros de pipeline e responsável.
- [x] `GET /crm/forecast/oportunidades` (um mês com `tipo`, ou um bloco), paginada com `pagina`/`tamanho`, a convenção do módulo. `POST /crm/forecast/data-prevista`: até 200 ids, um a um pelo `editarOportunidade` (histórico e outbox de cada um); 403 antes de gravar quem não edita Data prevista; `ignoradas` com `NAO_ENCONTRADA`, `NAO_ABERTA` ou o `code` do erro.
- [x] Acesso igual ao do quadro: pipeline oculto fora dos totais; sem Valor, todo R$ `null` (contagens ficam), inclusive em grupos e blocos; a lista tira as chaves que o papel não vê. A máscara é aplicada depois do cache.
- [x] Cache de 60 s (`lerComCache`), chave `crm:forecast:<tenant>:<marca>:<hash dos filtros, ocultos, hoje e fuso>`. A marca é o último evento do outbox do tenant e a última mudança de status, lidos antes do agregado: escrita em oportunidade ou na probabilidade padrão troca a chave sem gancho depois do commit.
- [x] Tenant sem oportunidade de vendas: `vazio: true`, com a resposta inteira em zeros.

**Aceite**

- [x] Ponderado, melhor caso e quantidade de 20 abertas (centavos, metade com override, metade com o padrão de quatro status) batem com a conta em centavos (`controllers/forecast.db.test.js`, 19 testes).
- [x] Ganha em 01/11 02:30 UTC (31/10 23:30 em São Paulo) cai em outubro; 03:30 UTC cai em novembro.
- [x] OPERADOR sem Valor: nenhum valor em reais na resposta, que é varrida por inteiro, nem na lista; contagens mantidas. OPERADOR não vê pipeline oculto, nem nos totais, e o `pipelineId` dele dá 404.
- [x] Reabrir, excluir e restaurar mudam o pedido seguinte; mudar a probabilidade padrão também. Oportunidade arquivada e pessoa arquivada ficam fora; pessoa anonimizada continua no realizado.
- [x] p95 de 433 ms (mediana 410 ms, máximo 486 ms) em 30 pedidos sem cache, com 20 mil oportunidades (`controllers/forecast-carga.db.test.js`, só com `CRM_CARGA=1`). A consulta em si leva cerca de 51 ms no banco (`EXPLAIN ANALYZE`: `idx_crm_deal_quadro_status` e `HashAggregate` com `GROUPING SETS`). O resto do tempo são as idas e vindas ao Neon de cada pedido.
- [x] Gates verdes em 19/11/2026: 1227 de 1227 com banco e os testes de integração do Kanban, cache em memória (8 pulados: 4 exigem Redis e 4 são o teste de carga, que só roda com `CRM_CARGA=1`). Lint, formato (`--end-of-line auto`), RLS, FK, isolamento e boot real no Node (`/health` 200; `/crm/forecast` sem token 401). Nenhum tenant SMOKE sobrando.
- [x] 13 proteções quebradas uma a uma, todas detectadas: fuso no realizado, pipeline oculto, máscara de valor, atrasadas, antes do período, override na efetiva, marca do cache, 403 antes de gravar, só abertas na ação em massa, oportunidade arquivada, pessoa arquivada, lista por papel e `vazio`. A de arquivada passou na primeira rodada e ganhou um caso de teste.

**Achados**

- O pedido gasta a maior parte do tempo em idas ao banco (fuso, marca, schema do papel, pipelines, agregado), não na consulta. Se o p95 subir em produção, o primeiro ganho é juntar fuso e marca numa consulta só.
- Depois de uma carga em massa num tenant novo, o Postgres pode escolher um plano ruim até o próximo `ANALYZE` (183 ms em vez de 51 ms no teste de carga). O autovacuum resolve; numa importação grande, vale rodar `ANALYZE`.
- Criar a pessoa já cria uma oportunidade em Novo (F-1). Teste de forecast que cria pessoa pela API precisa contar com ela; o helper do teste apaga essa oportunidade.

**Handoff ao front:** `handoff-front-fc2.md`, com a divisão do trabalho do front entre agentes.

### FC3. Snapshots e assertividade

- [ ] Migration 0049: `crm_forecast_snapshot` (semana local, mês, ponderado, melhor caso, realizado, contagens e os mesmos números por responsável em JSONB). Um por tenant, semana e mês. Imutável, com RLS e FK por tenant.
- [ ] Job `snapshot-forecast` de hora em hora no `crm.worker.js`: por tenant com a flag, a partir de segunda 06:00 no fuso, se a semana ainda não tem snapshot, grava o mês atual e os 3 seguintes com a consulta da FC2. Worker parado recupera na próxima hora.
- [ ] `GET /crm/forecast/assertividade`: mês fechado = realizado / previsto do primeiro snapshot do mês (realizado no snapshot + ponderado no snapshot). **Desvio do documento do dono:** lá é só o ponderado, mas o primeiro snapshot sai até o dia 7, e o já ganho até ali ficaria fora. Mês sem snapshot: "sem dados ainda".

**Aceite**

- [ ] Mudar a probabilidade padrão muda o forecast e não muda os snapshots.
- [ ] Rodar o job duas vezes na semana grava uma vez; antes de segunda 06:00 no fuso, não grava.
- [ ] Gates verdes, proteções quebradas, boot real com o worker, zero tenant SMOKE.

### FC4. Colunas do ciclo de vida na tabela de leads (1A.5)

Independe da flag.

- [ ] Ciclo de vida, Cliente desde (`MIN(won_at)`), Última compra (`MAX(won_at)`) e Oportunidades abertas, calculadas na leitura no molde de `crm-inatividade.sql.js`, sem as excluídas e sem os pipelines ocultos do papel.
- [ ] Filtros: ciclo de vida (um dos), cliente desde e última compra (entre datas), oportunidades abertas (mínimo e máximo).

**Aceite**

- [ ] Ganhar a primeira preenche "Cliente desde"; ganhar outra mexe só em "Última compra"; reabrir a única ganha limpa as duas e o ciclo volta.
- [ ] Gates verdes, proteções quebradas, boot real, zero tenant SMOKE.

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
| FM7, uploads no formulário                                     | quando o bucket existir, num plano próprio           |
| Lista e export de oportunidades                                | quando houver pedido                                 |
| Snapshot e assertividade por pipeline                          | quando houver mais de um pipeline de vendas em uso   |

## Ordem e paradas

1. P0 (motivo da perda) e a tela do aceite do M3.
2. FM1 → FM2 → FM2b → FM3 → FM4 → FM5 → FM6. Parada do jurídico antes de ligar em tenant real.
3. FC1 → FC2 → FC3 → FC4.
4. Piloto: tenant interno, depois um tenant real por uma semana, só então todos.

## Riscos

- **Vazamento de dado pelo link:** com o pré-preenchimento, um link encaminhado mostra os campos que o dono marcou. Defesas: o dono escolhe campo a campo, sensível nunca vem preenchido (conferido na hora da leitura), token de alta entropia só com hash no banco, validade curta, revogação, prévia genérica, rota pública sem token nos logs, rate limit.
- **Outbox com um consumidor só:** o quadro marca os eventos `form.*` como processados. Aceitável agora; o bot precisa de cursor próprio antes de consumir.
- **Rota pública é superfície nova:** escopo separado, sem reaproveitar `authenticateHook`, com teste de isolamento por tenant antes de qualquer outro aceite da FM3.
- **Escrita na pessoa fora do usuário:** a submissão passa pelas mesmas regras do lead (duplicidade, anonimizado, histórico); o que não couber vai para revisão, não é gravado em silêncio.
- **Teste que configura o que o aceite deveria provar:** testes de banco rodam no tenant padrão.
- **Forecast inflado por probabilidade otimista:** override volta ao padrão na mudança de status; a assertividade expõe o viés.

## Verificação

Em cada marco: gates verdes, aceite executado contra o banco de dev com tenant SMOKE e limpeza no fim (conferir zero tenant `smoke-`), proteções quebradas de propósito, boot real no Node. Na FM3 e na FM4, teste na tela com dois navegadores (como no M5): ficha gera o link, página pública responde, a ficha mostra as respostas. Marcar este plano e o documento do dono, e entregar o handoff.
