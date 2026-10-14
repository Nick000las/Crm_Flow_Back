# Plano de implementação — CRM: Campos Customizados, Filtros e Import/Export

> **Status (2026-10-12): implementado.** O estado final, as decisões tomadas e as
> divergências em relação a este plano estão em
> [plano-crm-campos-hibridos.md](./plano-crm-campos-hibridos.md). Principais
> diferenças: export síncrono com download direto na rota (sem `data_jobs` nem
> storage); a tabela de jobs virou `import_jobs`, só para import; e `origem`
> passou a se chamar `fonte_lead`.

Baseado no roteiro fornecido (Sprint 6 estendido / 6-B). Este documento traduz
o roteiro pra decisões concretas de arquitetura **dentro das convenções já
estabelecidas neste repositório** (`MODULE_CONTRACT.md`, `.claude/rules/multi-tenant.md`),
apontando exatamente onde cada peça entra na estrutura de módulo existente.

Só plano — nenhum código foi escrito. Ordem de leitura sugerida: seção 0
(estado real do módulo hoje, importante pra calibrar expectativa), depois
Partes 1→2→3 na mesma ordem de dependência que o roteiro já definiu certo.

---

## 0. Estado real do módulo `crm` hoje (ponto de partida)

Antes de planejar em cima, vale alinhar o que existe de fato — o roteiro
presume "CRM base sobre o motor de Kanban" pronto; na prática:

- `modulo_crm` schema tem só duas tabelas: `funil_estagios` e `leads`
  ([`schema.prisma.part`](../src/modules/nucleo/crm/prisma/schema.prisma.part)).
  `leads` não tem `status`, `tags`, `origem`, nem `updated_at` mantido por
  trigger — campos que o roteiro assume existir na Parte 2 (filtros de
  campo fixo) **não existem ainda**.
- Só dois endpoints: `GET /crm/leads` (lista tudo, sem paginação/filtro) e
  `POST /crm/leads` (cria). Não existe `PUT`/`DELETE` de lead.
- "Noisy Rollback" / resolução de conflito concorrente do Kanban, citada no
  roteiro como já resolvida, está descrita só como comentário em
  [`board.service.js`](../src/modules/nucleo/kanban-universal/services/board.service.js#L14-L16)
  ("acontece na camada de evento/socket que consome este service") — essa
  camada de socket não existe **nesta branch** ainda. Divisão de trabalho:
  CRM (este plano) é responsabilidade de quem escreve este documento;
  Kanban (incluindo essa peça) é do colega, em branch própria — não é uma
  lacuna deste plano, só um lembrete de que Parte 2/3 daqui não podem
  assumir que o socket já existe até as branches convergirem (nenhuma
  parte deste roteiro de CRM depende dele de qualquer forma — é observação,
  não bloqueio).
- Nenhuma infraestrutura de fila (`bullmq`/`ioredis`), upload multipart
  (`@fastify/multipart`) ou parsing de planilha (`exceljs`/`xlsx`) está
  instalada — a Parte 3 do roteiro depende de tudo isso do zero.

**Não é bloqueador da Parte 1** (campos customizados só toca `leads` +
tabela nova, não depende de status/tags/socket). É bloqueador real da
Parte 2 (alguns filtros de campo fixo listados não têm coluna pra filtrar
ainda) e da Parte 3 (infra de fila/upload inexistente). Ver seção 4.

---

## 1. Parte 1 — Campos Customizados

### 1.1 Schema (`schema.prisma.part`, expandir o arquivo existente)

```sql
CREATE TABLE modulo_crm.tenant_lead_field_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  chave VARCHAR NOT NULL,
  label VARCHAR NOT NULL,
  tipo VARCHAR NOT NULL CHECK (tipo IN ('texto','numero','data','booleano','selecao','selecao_multipla')),
  opcoes JSONB,             -- só usado quando tipo IN ('selecao','selecao_multipla')
  obrigatorio BOOLEAN NOT NULL DEFAULT false,
  ordem INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (tenant_id, chave)
);

ALTER TABLE modulo_crm.tenant_lead_field_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modulo_crm.tenant_lead_field_definitions
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE INDEX idx_lead_field_definitions_tenant_ordem
  ON modulo_crm.tenant_lead_field_definitions(tenant_id, ordem);

ALTER TABLE modulo_crm.leads ADD COLUMN custom_fields JSONB NOT NULL DEFAULT '{}';
CREATE INDEX idx_leads_custom_fields_gin ON modulo_crm.leads USING GIN (custom_fields);
```

Segue à risca o modelo obrigatório do `MODULE_CONTRACT.md` §5 (mesmo
`tenant_id` + RLS + policy de `funil_estagios`/`leads`). `UNIQUE (tenant_id,
chave)` já é a garantia de banco pro checkpoint de "dois campos com mesmo
label" — o backend só antecipa isso pra devolver erro amigável (1.3).

### 1.2 Camadas (`adapters/` → `services/` → `controllers/`)

Novos arquivos, mesmo padrão de `leads.*`:

- `adapters/field-definitions.repository.js` — `buscarDefinicoesPorTenant`,
  `criarDefinicao`, `atualizarDefinicao`, `reordenarDefinicoes`,
  `removerDefinicao`. Tudo via `getTenantClient` + `$queryRaw` tagged
  template, `WHERE tenant_id = ...` explícito (contrato §4).
- `services/field-definitions.service.js` — regra de negócio pura: gera
  `chave` a partir do `label` (1.3), valida unicidade *antes* do insert
  pra erro amigável, valida `opcoes` só quando `tipo` é de seleção.
- `controllers/field-definitions.controller.js` — registra
  `GET/POST/PUT/DELETE /crm/field-definitions[/:id]` +
  `PUT /crm/field-definitions/reorder`. Zod na borda.

Justifica criar `schemas/` (opcional pelo contrato, vale a partir de ~3
schemas — este módulo passa a ter vários: definição de campo, filtro,
import) — ver 1.5 e seção 4.3.

### 1.3 Geração de `chave` (slug)

Função pura nova em `#shared/text/slugify.js` (não é específica de CRM —
mora em `shared/` porque é utilitário genérico, mesmo critério já usado
pra `formatarTelefoneBR`). Minúsculo, sem acento, espaço → `_`, remove
tudo que não for `[a-z0-9_]`, colapsa `_` repetido. `service` chama isso,
tenta o insert, e se cair em `P2002` (constraint `UNIQUE (tenant_id,
chave)`) devolve erro `VALIDATION_ERROR` com `fields.label` — mas a
checagem prévia (`SELECT ... WHERE chave = ...`) evita bater na constraint
crua na maioria dos casos, e o catch de `P2002` é a rede de segurança pra
corrida (dois requests simultâneos com o mesmo label).

### 1.4 Remoção não apaga dado (decisão do roteiro, já correta)

`DELETE /crm/field-definitions/:id` remove só a linha de
`tenant_lead_field_definitions`. `leads.custom_fields` não é tocado — dado
órfão fica no JSONB. Documentar isso na resposta 200 do DELETE
(`{ removido: true, aviso: 'Dados já preenchidos com esta chave continuam salvos nos leads existentes.' }`)
em vez de só um `204`, pra UI poder mostrar o aviso sem precisar hardcodar
o texto.

### 1.5 Formulário dinâmico de lead — contrato de API, não frontend

Este plano é backend, mas a Parte 1 só "fecha" quando o formulário lê
exclusivamente de `GET /crm/field-definitions` — nenhum campo customizado
pode ser hardcoded no componente (mesma lição já aplicada na conversa
sobre `modulosContratados`: uma única fonte de verdade, nunca lista
paralela). Vale repetir esse ponto no prompt que for pro frontend quando
chegar a hora.

`leads.repository.js`/`leads.service.js` existentes precisam aceitar
`custom_fields` no `criarLead`/novo `atualizarLead` — validação de
`obrigatorio`/`tipo` acontece no `service`, contra as definições vigentes
buscadas do banco (nunca confiar em validação só do cliente).

---

## 2. Parte 2 — Filtros

### 2.1 Pré-requisito real: colunas fixas que faltam

O roteiro pede filtro por "estágio, responsável, origem, faixa de valor,
intervalo de data, status, tags, busca full-text". Hoje `leads` só tem
`funil_estagio_id`, `usuario_responsavel_id`, `valor`, `created_at`. **Não
existem** `origem`, `status`, `tags`. Duas opções, decisão do usuário:

- (a) Adicionar essas colunas a `leads` agora, como parte desta entrega
  (migration extra na Parte 2, `ALTER TABLE modulo_crm.leads ADD COLUMN
  origem VARCHAR, ADD COLUMN status VARCHAR, ADD COLUMN tags VARCHAR[]`).
- (b) Cortar esses três filtros do escopo desta entrega e reduzir a lista
  de filtros fixos ao que já existe (estágio, responsável, faixa de valor,
  intervalo de data) + full-text em `nome`.

Recomendo (a) — é uma migration pequena e sem isso a Parte 2 do roteiro
não fecha por completo — mas é uma decisão de escopo, não técnica, então
fica registrada aqui em vez de decidida sozinha.

### 2.2 Endpoint de busca

`POST /crm/leads/search` (não `GET` — o filtro combinado, especialmente
com campos customizados, não cabe bem em query string e o roteiro já
antecipa isso ao falar de "filtro combinando campo fixo + customizado").
Body: `{ filtrosFixos: {...}, filtrosCustomizados: [{ chave, operador, valor }], paginacao: { pagina, tamanho } }`.

Camadas: `services/lead-filter.service.js` traduz o body validado (Zod) em
uma lista de fragmentos SQL parametrizados; `adapters/leads.repository.js`
ganha `buscarLeadsComFiltro(tenantId, fragmentos)` que monta a query final.

### 2.3 Construção segura da query dinâmica

**Nunca concatenar string** (o próprio roteiro já marca isso como ponto a
evitar, e é regra não-negociável do `MODULE_CONTRACT.md` §4). O Prisma
Client já expõe o mecanismo certo pra isso: `Prisma.sql` (fragmento
parametrizado) + `Prisma.join` (concatena fragmentos com um separador,
ainda parametrizado). Esboço:

```js
import { Prisma } from '@prisma/client';

const condicoes = [Prisma.sql`tenant_id = ${tenantId}::uuid`]; // sempre presente, defesa em profundidade

if (filtrosFixos.estagioId) {
  condicoes.push(Prisma.sql`funil_estagio_id = ${filtrosFixos.estagioId}::uuid`);
}
if (filtrosFixos.valorMin != null) {
  condicoes.push(Prisma.sql`valor >= ${filtrosFixos.valorMin}`);
}
for (const { chave, operador, valor } of filtrosCustomizados) {
  // operador já validado por Zod contra um enum fechado antes de chegar aqui —
  // nunca interpolar o operador cru na string SQL.
  if (operador === 'contem') {
    condicoes.push(Prisma.sql`custom_fields->>${chave} ILIKE ${'%' + valor + '%'}`);
  }
  if (operador === 'e_um_dos') {
    condicoes.push(Prisma.sql`custom_fields @> ${JSON.stringify({ [chave]: valor })}::jsonb`);
  }
  // numero/data: cast explícito, ver caveat de índice em 2.4
}

const where = Prisma.join(condicoes, ' AND ');
tx.$queryRaw`SELECT * FROM modulo_crm.leads WHERE ${where} ORDER BY created_at DESC LIMIT ${tamanho} OFFSET ${offset}`;
```

`chave` e `valor` continuam interpolados via tagged template (parametrizado
pelo Prisma) mesmo dentro de `Prisma.sql` — só o **operador** (que decide
qual fragmento SQL gerar) precisa vir de um enum Zod fechado, nunca texto
livre do cliente indo pro SQL.

### 2.4 Caveat honesto sobre o índice GIN (checkpoint do roteiro, ajustado)

O roteiro pede confirmar via `EXPLAIN ANALYZE` que o índice GIN é usado.
Isso é verdade só pra uma parte dos filtros:

- **Igualdade/seleção/booleano** (`custom_fields @> '{"chave":"valor"}'`):
  GIN acelera de verdade — é containment, o caso clássico que o operador
  `@>` foi feito pra resolver com índice.
- **Texto "contém"** (`->>'chave' ILIKE '%x%'`) e **faixa numérica/data**
  (`(custom_fields->>'chave')::numeric BETWEEN a AND b`): um GIN comum na
  coluna JSONB **não acelera isso** — não existe expressão de índice
  genérica pra "qualquer chave dinâmica, convertida pra número, em
  intervalo" sem saber as chaves de antemão. Vai rodar sequential/bitmap
  scan.

Isso não é lacuna do plano — é exatamente o motivo do roteiro já listar
"promoção de campo customizado pra coluna nativa" como fora de escopo:
esse é o caminho certo pra fazer texto/número/data em campo customizado
serem tão rápidos quanto campo fixo, e foi conscientemente adiado. Ajuste
recomendado no checkpoint: rodar `EXPLAIN ANALYZE` separadamente pros dois
grupos, confirmar índice usado no primeiro, e registrar o segundo como
sequential scan aceito nesta fase (documentar, não esconder).

### 2.5 Views salvas

```sql
CREATE TABLE modulo_crm.crm_filter_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL,
  nome VARCHAR NOT NULL,
  filtros_jsonb JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- RLS + policy + índice tenant_id, mesmo padrão de sempre.
```

`GET/POST/DELETE /crm/filter-views` — CRUD simples, sem novidade
arquitetural em relação ao resto do módulo.

---

## 3. Parte 3 — Importação/Exportação

Esta é a parte que exige infraestrutura nova (nenhuma peça abaixo existe
hoje no projeto). Tratar como um passo prévio explícito, não misturado
silenciosamente no meio do desenvolvimento.

### 3.1 Infraestrutura nova necessária

| Peça | Hoje | Decisão proposta |
|---|---|---|
| Fila de jobs | inexistente | `bullmq` + `ioredis` (novas deps) |
| Broker Redis | inexistente | Variável `REDIS_URL` nova em `env.js`/`.env.example`. Provedor gerenciado fica a critério do usuário — Upstash é uma opção natural já que apareceu antes no projeto (plano do tema Camaleão do frontend), mas é decisão de infra/custo, não técnica, então não decido aqui. |
| Upload multipart | inexistente | `@fastify/multipart` |
| Parse de planilha | inexistente | `exceljs` — mais ativamente mantido e com API de streaming (importa pra planilha grande sem carregar tudo em memória de uma vez); `xlsx`/SheetJS (community edition) teve advisories de ReDoS/prototype pollution não corrigidas há tempo. Recomendo `exceljs`, mas é o roteiro quem deixou as duas em aberto. |
| Processo do worker | inexistente | Novo entrypoint `src/workers/crm-data-jobs.worker.js`, processo separado do servidor HTTP (`node src/workers/crm-data-jobs.worker.js`) — mesmo racional de `src/api/server.js` ser o entrypoint HTTP: um worker de fila é outro tipo de entrypoint, não fica dentro de um módulo. Rodar como processo próprio (não dentro do processo do Fastify) é o padrão de mercado pra job worker — evita que um travamento de processamento de planilha afete requisições HTTP, e escala independente. |

Consequência de arquitetura: `eslint.config.js` precisa de um novo tipo em
`boundaries/elements` — `{ type: 'worker', pattern: 'src/workers/**' }` —
com uma regra `{ from: 'worker', allow: ['core', 'shared', 'module'] }`
(mesmo nível de acesso que `api` já tem hoje). Sem isso o lint bloqueia o
worker de importar o `service` do módulo CRM.

Onde a fila é definida: dentro de `adapters/data-jobs.repository.js` do
próprio módulo CRM (não um `queue/` novo — o `MODULE_CONTRACT.md` §2 não
lista essa pasta entre as permitidas; enfileirar um job é, na prática, uma
operação de acesso a um sistema externo de dado, o mesmo papel que
`adapters/` já cumpre pro Postgres — cabe junto). A conexão Redis
compartilhada (`ioredis` client) mora em `#core/queue/connection.js`,
porque é infraestrutura cross-cutting, não exclusiva do CRM — mesmo
critério de `#core/db/tenantClient.js`.

### 3.2 Tabela de acompanhamento de job

Mesmo padrão de generalização já usado neste projeto pra
`codigos_verificacao` (uma tabela, discriminada por `tipo`, em vez de duas
tabelas quase-idênticas):

```sql
CREATE TABLE modulo_crm.data_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL,
  tipo VARCHAR NOT NULL CHECK (tipo IN ('import','export')),
  status VARCHAR NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente','processando','concluido','falhou')),
  mapeamento_jsonb JSONB,          -- só import: de-para coluna→campo
  estrategia_duplicata VARCHAR,    -- só import: 'pular'|'atualizar'|'criar'
  colunas_exportar JSONB,          -- só export: lista de campos escolhidos, na ordem
  payload_jsonb JSONB,             -- import: linhas já validadas, prontas pro worker consumir
  total_linhas INTEGER,
  linhas_processadas INTEGER NOT NULL DEFAULT 0,
  linhas_com_erro INTEGER NOT NULL DEFAULT 0,
  relatorio_erro_jsonb JSONB,      -- lista de { linha, motivo }, só as com erro
  arquivo_resultado_url VARCHAR,   -- só export: onde baixar o .xlsx pronto
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  concluido_em TIMESTAMP
);
-- RLS + policy + índice (tenant_id, status), mesmo padrão de sempre.
```

`payload_jsonb` guardando as linhas já validadas (em vez de reprocessar o
arquivo no worker, ou depender de um storage de arquivo que o projeto não
tem) mantém tudo dentro do Postgres já existente — decisão pragmática, sem
introduzir S3/blob storage só pra isso. Funciona bem pra volume de
milhares de linhas (o caso de uso real de um CRM); se algum dia o volume
justificar object storage de verdade, é revisão futura, não desta entrega
— mesmo espírito do roteiro já adiar Data Warehouse.

`arquivo_resultado_url` do export tem a mesma pergunta em aberto: sem
storage de arquivo (S3 ou similar), "link de download quando pronto" não
tem onde apontar. Fica registrado como decisão pendente do usuário (seção
5) — não dá pra resolver só com Postgres, diferente do import.

### 3.3 Fluxo de importação (endpoints)

- `POST /crm/import/preview` — recebe o arquivo (`@fastify/multipart`),
  faz parse, devolve as primeiras N linhas cruas + nomes das colunas
  encontradas. **Não grava nada.**
- `GET /crm/field-definitions` (já existe da Parte 1) — a tela de
  mapeamento reaproveita esse endpoint, nunca duplica a lista de campos.
- `POST /crm/import/validate` — body: arquivo (ou referência a ele, se
  guardado temporariamente) + mapeamento + estratégia de duplicata.
  `services/import.service.js` roda a validação linha a linha (tipo
  compatível com `tipo` da definição, obrigatórios preenchidos, valor de
  `selecao` bate com uma das `opcoes` cadastradas), sem gravar nada, e
  devolve o relatório completo. Se tudo ok, devolve um payload pronto pro
  próximo passo confirmar (guardado em memória do cliente até o submit
  final, ou já persistido como `data_jobs` com `status: 'pendente'` — mais
  seguro persistir, evita perder o trabalho de validação se o usuário
  fechar a aba).
- `POST /crm/import/:jobId/confirm` — só aqui o job é de fato enfileirado
  no BullMQ (`adapters/data-jobs.repository.js` grava `status:
  'processando'` e chama `queue.add(...)`). Nunca processa a planilha no
  próprio request, mesmo pequena — regra explícita do roteiro.
- `GET /crm/import/:jobId` — status/progresso (`linhas_processadas` de
  `total_linhas`), pra UI fazer polling ou o front assinar algum canal
  (sem socket.io no projeto ainda, polling simples é a opção realista sem
  infraestrutura nova adicional).

O **worker** (`src/workers/crm-data-jobs.worker.js`) consome a fila, chama
`services/import.service.js#processarImportacao(jobId)`, que por sua vez
usa `adapters/leads.repository.js`/`adapters/data-jobs.repository.js` —
mesma disciplina de camadas do resto do módulo, só que acionada por um
evento de fila em vez de uma rota HTTP (o worker cumpre o mesmo papel que
um `controller` cumpre pra HTTP: ponto de entrada fino que delega pro
`service`).

Dentro do processamento, por linha: aplica dedup (busca por CPF ou
e-mail+telefone conforme configurado) e a estratégia escolhida
(pular/atualizar/criar), incrementa `linhas_processadas`, acumula erro em
`relatorio_erro_jsonb` se algo inesperado falhar numa linha específica sem
derrubar o job inteiro.

### 3.4 Fluxo de exportação

- `POST /crm/export` — body: colunas escolhidas (fixas + `chave` de
  customizados, na ordem escolhida) + filtro opcional (reaproveita
  `lead-filter.service.js` da Parte 2 — exportar "os leads filtrados" é o
  caso de uso real, vale já nascer integrado). Cria `data_jobs` com `tipo:
  'export'`, enfileira.
- Worker gera o `.xlsx` (`exceljs`) só com as colunas pedidas, na ordem
  pedida — usa `field-definitions` pra rotular colunas customizadas.
- Onde salvar o arquivo gerado pra virar link de download: decisão em
  aberto, ver 3.2 e seção 5.

---

## 4. Sequenciamento recomendado

Confirma a ordem que o próprio roteiro já propôs, com um ajuste: infra de
fila entra **antes** da Parte 3 em si, como seu próprio marco.

1. **Parte 1 completa** (schema + CRUD de definições + `leads` aceitando
   `custom_fields`) — sem dependência de nada novo, pode começar já.
2. **Decisão de escopo da seção 2.1** (adicionar `origem`/`status`/`tags`
   ou cortar do filtro) — resolver antes de começar a Parte 2 de verdade.
3. **Parte 2** (filtro + views salvas) — depende só da Parte 1 pronta.
4. **Marco de infra**: instalar/configurar `bullmq`, `ioredis`,
   `@fastify/multipart`, `exceljs`, `REDIS_URL`, atualizar
   `eslint.config.js` (tipo `worker`) — trabalho de setup, sem lógica de
   negócio ainda, testável isoladamente com uma fila/worker de exemplo
   trivial antes de plugar a lógica real de import.
5. **Parte 3** — só depois do marco de infra existir de verdade.

Cada parte é PR-sizeable por si só; a Parte 3 provavelmente ainda vale
quebrar em "import" e "export" como PRs separados dado o tamanho.

---

## 5. Decisões em aberto (do usuário, não técnicas)

- **Escopo de `origem`/`status`/`tags`** em `leads` (seção 2.1) — incluir
  agora ou cortar do filtro nesta entrega.
- **Provedor de Redis** (Upstash, Redis gerenciado da própria plataforma
  de deploy, etc.) — decisão de infra/custo.
- **Onde roda o worker em produção**: processo separado dedicado (padrão
  recomendado) — precisa de um segundo serviço/dyno/container no deploy,
  não só o processo HTTP atual.
- **Storage do `.xlsx` de export** — sem isso resolvido, "link de
  download" não tem implementação possível. Opções: bucket S3-compatible
  (Cloudflare R2, Backblaze B2, AWS S3), ou servir o arquivo binário
  direto de uma rota autenticada que lê de uma coluna `bytea`/base64 no
  próprio Postgres (funciona pra volume baixo, sem storage novo, mas não
  escala tão bem quanto um bucket de verdade).
- **`exceljs` vs `xlsx`/SheetJS** — recomendação dada em 3.1, decisão final
  é do usuário.

---

## 6. Critério de pronto (mapeado do roteiro pros artefatos reais)

- [x] `tenant_lead_field_definitions` com RLS, CRUD completo, `chave`
  slugificada e validada antes do insert.
- [x] `leads.custom_fields` + GIN, formulário de lead 100% dinâmico
  (nenhum campo customizado hardcoded no componente).
- [x] `test:rls-coverage` + `test:tenant-isolation` passando depois de
  cada mudança de schema (Partes 1, 2 e 3 mexem em schema).
- [x] `POST /crm/leads/search` combinando fixo + customizado, com
  `EXPLAIN ANALYZE` separado por tipo de filtro (2.4) — GIN confirmado
  pros containment/igualdade, sequential scan aceito e documentado pra
  texto/número/data em campo customizado. *(Endpoint pronto; o `EXPLAIN
  ANALYZE` com volume real continua pendente, porque hoje não há leads em
  produção.)*
- [x] Views salvas reaplicando filtro exato.
- [x] Import assíncrono via BullMQ desde o primeiro commit — nunca
  processado no request, mesmo planilha pequena. Relatório de erro por
  linha, sem commit parcial silencioso.
- [x] 3 estratégias de duplicata testadas (pular/atualizar/criar).
- [x] Export configurável por coluna, ~~assíncrono~~ síncrono (decisão: download direto na rota, sem storage), decisão de storage
  resolvida (seção 5) antes de começar essa fatia.
- [x] `npm run lint` passando com o novo tipo `worker` reconhecido pelo
  `eslint-plugin-boundaries`.
- [ ] Fora de escopo, igual o roteiro já registrou: Data Warehouse, grupos
  AND/OR complexos, promoção de campo customizado pra coluna nativa
  (é literalmente o que resolveria o caveat da seção 2.4 — fica marcado
  como o motivo técnico concreto pra essa entrada existir na lista).
