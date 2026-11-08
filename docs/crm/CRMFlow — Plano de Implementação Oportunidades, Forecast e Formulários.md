# CRMFlow — Plano de Implementação: Oportunidades, Forecast e Formulários

Oct 28, 2026 · @Nickolas

## Resumo e escopo

A sprint separa **Pessoa** de **Oportunidade**, deriva o ciclo de vida lead → cliente das oportunidades, entrega o forecast ponderado e um motor de formulários com link pessoal enviado manualmente. Tudo nasce atrás de feature flag de rollout e faz parte do módulo CRM base.

**Entra nesta sprint**

| Entrega                                                          | Flag              | Trilha          |
| ---------------------------------------------------------------- | ----------------- | --------------- |
| Fundação: `entity` no `crm_field` + outbox `crm_event`           | —                 | Fase 0 (juntos) |
| Oportunidades (`crm_deal`) + ciclo de vida + agregados na pessoa | `crm.deals_v1`    | 1A              |
| Forecast ponderado + snapshots de assertividade                  | `crm.forecast_v1` | 1B              |
| Motor de formulários + anamnese com link pessoal                 | `crm.forms_v1`    | 2               |

**Fica para a sprint do bot:** envio automático de links, lembretes, notificações por WhatsApp/e-mail, NPS, régua de pós-venda, campanhas de reativação. Também ficam fora: documentos com assinatura, posição financeira, visibilidade por carteira e formulário genérico de captação.

**Premissas:** `crm_field`, `crm_option` (chave estável + `category`), resolver de schema com cache, permissão por campo e a flag `crm.campos_v2` já estão em produção. O M8 (Zod gerado + regras condicionais) vem **depois** desta sprint, para nascer já ciente da entidade.

## Como os players fazem e o que adotamos

Cada decisão abaixo parte de um padrão documentado de HubSpot, Pipedrive, Salesforce ou softwares de clínica brasileiros, com o desvio do CRMFlow justificado.

| Tema                          | Como o mercado faz                                                                                                                                                   | Decisão no CRMFlow                                                                                                                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pessoa × negócio              | HubSpot separa estágio do ciclo de vida (no contato) de estágio do negócio (no deal). Pipedrive liga cada deal a uma pessoa/organização.                             | **Pessoa** guarda identidade e ciclo de vida; **Oportunidade** guarda status, valor e previsão. N oportunidades por pessoa.                                                                    |
| Conversão lead → cliente      | Salesforce _converte_ o lead criando conta, contato e oportunidade novos. Pipedrive transfere notas e atividades do lead para o deal na conversão.                   | **Sem conversão nem cópia de registro.** A pessoa é a mesma do primeiro contato ao pós-venda; só o ciclo de vida muda. Evita histórico partido.                                                |
| Quando vira cliente           | HubSpot: cliente = pelo menos um negócio ganho; deal ganho promove automaticamente; deal novo de cliente não rebaixa para oportunidade; perda não rebaixa cliente.   | Igual: `cliente` ⇔ existe ≥ 1 oportunidade ganha ativa. Oportunidade nova ou perdida não rebaixa.                                                                                              |
| Direção do ciclo de vida      | HubSpot só move automaticamente para frente; rebaixar exige limpar o campo manualmente.                                                                              | **Derivado dos fatos, não acumulado.** Se a única oportunidade ganha for reaberta ou excluída (correção de erro), a pessoa volta a `oportunidade`/`lead`. A trilha de mudanças fica no outbox. |
| Probabilidade                 | Pipedrive: probabilidade do deal sobrepõe a do estágio; sem nenhuma, conta o valor cheio. HubSpot: padrão por estágio; a comunidade pediu muito o override por deal. | Padrão por status (`default_probability`) + override por oportunidade. Override volta ao padrão quando o status muda.                                                                          |
| Mês de cada valor no forecast | Pipedrive: aberto pela data prevista; ganho pela data em que foi ganho.                                                                                              | Igual, em fuso do tenant. Atrasadas e sem previsão em blocos próprios.                                                                                                                         |
| Anamnese digital              | Codental: link para o paciente responder; envio por WhatsApp, cópia do link ou QR; cancelar compartilhamento; respostas caem na ficha.                               | Link pessoal por pessoa+formulário, as mesmas três formas de envio, revogação, submissão imutável na ficha.                                                                                    |
| Valor jurídico da resposta    | Codental pede que o paciente assine no próprio aparelho e registra IP e localização.                                                                                 | Registramos IP, user agent, versão do termo e horário. Assinatura eletrônica formal fica para o módulo de documentos.                                                                          |

## Fase 0 — Fundação compartilhada

Duas migrações feitas juntas antes de dividir as trilhas: `entity` no `crm_field` e o outbox `crm_event`. São o único ponto de contato entre as trilhas 1 e 2.

### 0.1 `entity` no `crm_field`

- Coluna `entity text not null default 'person'` com check `in ('person','deal')`.
- Unicidade passa a ser `(tenant_id, entity, system_key)` para campos do sistema e `(tenant_id, entity, key)` para personalizados.
- A constante da Camada 1 ganha `entity` em cada campo do sistema. Migram para `deal`: Status, Valor, Motivo da perda, Probabilidade de fechamento, Data prevista de fechamento, Data de conversão.
- Resolver vira `getEffectiveFieldSchema(tenantId, entity)`; cache Redis com chave `crm-fields:{tenant}:{entity}:{role}`.
- `GET /crm/leads/fields` continua existindo e devolve `person` + campos `deal` marcados `via: 'principal_deal'` (ver 1A.4), para a tabela atual não quebrar.

**Edge cases**

- Campo personalizado existente: fica `person` por padrão. Se o tenant criou um campo que é de negócio (ex.: "Procedimento"), a UI de Campos ganha a ação **Mover para Oportunidade** (fase 1A), que copia valores para a oportunidade principal.
- Views salvas e filtros que referenciam campos que viraram `deal` continuam válidos pela projeção da oportunidade principal (chave estável não muda).
- Permissões e visibilidade por contexto já existentes são mantidas linha a linha; a migração só preenche `entity`.

### 0.2 Outbox `crm_event`

```
crm_event
  id uuid pk, tenant_id uuid not null          -- RLS
  type text not null                           -- deal.created | deal.status_changed | deal.won | deal.lost
                                               -- deal.reopened | deal.deleted | person.lifecycle_changed
                                               -- person.merged | form.link_created | form.submitted | form.link_revoked
  entity text, entity_id uuid
  payload jsonb not null                       -- antes/depois do que mudou, actor_id
  occurred_at timestamptz default now()
  processed_at timestamptz null
  index (tenant_id, occurred_at)
  index (processed_at) where processed_at is null
```

- Escrito **na mesma transação** da mudança, por um helper `emitEvent(tx, …)`. Nunca depois do commit.
- Nesta sprint ninguém consome além do próprio app (invalidação de cache do forecast, Socket.io). A sprint do bot pluga consumidores sem tocar no código de domínio.
- Retenção: eventos processados com mais de 90 dias podem ser movidos para armazenamento frio; não apagar antes de existir relatório de funil que dependa deles.

## Trilha 1A — Oportunidades e ciclo de vida

A pessoa passa a ter N oportunidades; o ciclo de vida (`lead` → `oportunidade` → `cliente`) é derivado delas, e a tabela atual continua igual por meio da oportunidade principal.

### 1A.1 Modelo de dados

```
crm_deal
  id uuid pk, tenant_id uuid not null
  person_id uuid not null                    -- FK composta (tenant_id, person_id) → lead(tenant_id, id)
  title text null                            -- default: "<nome da pessoa> — <data>"
  status text not null                       -- chave do crm_option (kind='status')
  status_category text not null              -- open | won | lost, copiado da opção na escrita
  amount numeric(14,2) null                  -- BRL
  probability_override smallint null         -- 0..100
  expected_close_date date null
  won_at timestamptz null, lost_at timestamptz null
  lost_reason text null                      -- chave do crm_option (kind='lost_reason')
  owner_id uuid null
  custom_fields jsonb default '{}'           -- campos entity='deal'
  version int not null default 1             -- lock otimista
  created_at, updated_at, deleted_at
  index (tenant_id, person_id) where deleted_at is null
  index (tenant_id, status_category, expected_close_date) where deleted_at is null
  index (tenant_id, won_at) where status_category = 'won' and deleted_at is null

lead  (pessoa) — colunas novas
  lifecycle_stage text not null default 'lead'   -- lead | oportunidade | cliente
  lifecycle_changed_at timestamptz
  first_won_at, last_won_at timestamptz null
  open_deals_count int not null default 0
  won_deals_count int not null default 0
  principal_deal_id uuid null
```

`status_category` é copiado para a oportunidade porque o forecast e os agregados filtram por ele a todo momento; buscar a categoria no `crm_option` em cada query custa um join desnecessário. A cópia é segura porque a categoria de uma opção em uso não pode mudar (1A.6).

### 1A.2 Regras do ciclo de vida

Uma função pura `deriveLifecycle(deals)` decide, chamada por `recomputePersonRollup(tx, personId)` em toda escrita de oportunidade:

1. Existe oportunidade `won` não excluída → `cliente`.
2. Senão, existe oportunidade `open` → `oportunidade`.
3. Senão → `lead` (inclui quem só tem oportunidades perdidas).

O recálculo **sempre lê de `crm_deal`** e reescreve todos os agregados; nunca incrementa ou decrementa. Se o estágio mudou, grava `lifecycle_changed_at` e emite `person.lifecycle_changed` com antes/depois.

&#91;embedded content: ciclo de vida · 3 estágios derivados\]

Cliente só deixa de ser cliente por correção (oportunidade ganha reaberta ou excluída); oportunidade nova ou perdida nunca o rebaixa.

`won_at`: preenchido quando o status entra em categoria `won`; limpo se sair (reabertura), com evento `deal.reopened`. `lost_at` idem para `lost`. Motivo da perda é obrigatório ao entrar em `lost` (regra já existente, agora na oportunidade).

### 1A.3 Oportunidade principal

A tabela de leads mostra Status, Valor, Responsável do negócio etc. da **oportunidade principal**, escolhida nesta ordem:

1. A aberta com maior `updated_at`.
2. Senão, a fechada (ganha ou perdida) com maior `coalesce(won_at, lost_at)`.
3. Empate → menor `id` (determinístico).

`principal_deal_id` é materializado na pessoa pelo mesmo recálculo, para a listagem fazer um único `LEFT JOIN`.

### 1A.4 Projeção na tabela atual (compatibilidade)

- Colunas de campos `deal` na tabela leem da oportunidade principal.
- **Editar Status/Valor na tabela ou no drawer** edita a oportunidade principal. Se a pessoa não tem nenhuma, a edição **cria** uma (status padrão = o escolhido).
- Pessoa com mais de uma oportunidade aberta mostra um selo `+N` ao lado do status.
- Filtros por campo `deal` na lista de pessoas = "a oportunidade principal satisfaz". Filtro "qualquer oportunidade satisfaz" fica para depois, quando existir a lista de oportunidades.
- Formulário **Novo lead**: se vier Status ou Valor, cria pessoa + oportunidade na mesma transação; senão, só a pessoa.

### 1A.5 UI nova

- Drawer da pessoa: chip de ciclo de vida no cabeçalho (`Lead` / `Em negociação` / `Cliente desde mm/aaaa`) e aba **Oportunidades** listando todas, com status, valor, previsão e responsável.
- Botão **Nova oportunidade** na ficha (é como o cliente volta a comprar sem duplicar cadastro).
- Colunas e filtros novos na tabela: Ciclo de vida, Cliente desde, Última compra, Oportunidades abertas.
- Campos: ação **Mover para Oportunidade** para campos personalizados que pertencem ao negócio.

### 1A.6 Migração e backfill

1. Ensaiar em um **branch do Neon** com cópia de produção; medir tempo e comparar contagens antes de rodar em produção.
2. Criar `crm_deal` + RLS + colunas novas na pessoa.
3. Para cada lead com Status **ou** Valor preenchido → 1 oportunidade com esses campos. Leads sem nenhum dos dois → sem oportunidade.
4. `won_at` do backfill: data da última mudança para status `won` no histórico de alterações, se existir; senão `updated_at` do lead, marcado `custom_fields.won_at_estimated = true`. O forecast mostra esses valores com aviso "data estimada".
5. Rodar `recomputePersonRollup` em lote por tenant (job BullMQ, lotes de 500, idempotente).
6. Ligar `crm.deals_v1` em escrita dupla: as colunas antigas do lead continuam sendo escritas a partir da oportunidade principal por uma release. Desligar a flag volta a leitura para as colunas antigas sem perda.
7. Após uma release estável: parar a escrita dupla, remover as colunas antigas numa migração separada.

### 1A.7 Edge cases

| Situação                                            | Comportamento                                                                                                                                                    |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Oportunidade ganha é reaberta por engano            | `won_at` limpo, evento `deal.reopened`, ciclo de vida recalculado (pode voltar a `oportunidade`).                                                                |
| Única oportunidade ganha é excluída                 | Soft delete; recálculo → pessoa volta a `lead` ou `oportunidade`. Restaurar refaz o recálculo.                                                                   |
| Cliente abre oportunidade nova e perde              | Continua `cliente` (padrão HubSpot).                                                                                                                             |
| Duas pessoas mescladas (duplicidade)                | Oportunidades das duas passam para a sobrevivente; principal e agregados recalculados; evento `person.merged`.                                                   |
| Pessoa arquivada ou excluída                        | Oportunidades seguem o mesmo soft delete; somem do forecast. Restaurar a pessoa restaura as que foram excluídas junto (marcadas com o mesmo `deleted_batch_id`). |
| Tenant tenta mudar a `category` de um status em uso | Bloqueado. Para mudar, cria opção nova e move as oportunidades (ação em massa). Evita reclassificar o forecast histórico em silêncio.                            |
| Duas pessoas editam a mesma oportunidade            | Lock otimista por `version`; a segunda recebe 409 com o estado atual para reaplicar.                                                                             |
| Importação com pessoa já existente (duplicidade)    | Opção no passo Mapear: atualizar a oportunidade aberta principal (padrão) ou criar nova. Sem oportunidade aberta → cria.                                         |
| Oportunidade sem valor                              | Permitida; conta no número de oportunidades, não soma em R$.                                                                                                     |
| Responsável da pessoa ≠ da oportunidade             | Oportunidade nova herda o responsável da pessoa; depois são independentes.                                                                                       |
| Socket.io                                           | Mudança em oportunidade emite `crm:person:updated` com o `person_id`, para a linha da tabela atualizar.                                                          |
| Export                                              | Exporta a pessoa com as colunas da oportunidade principal (igual à tabela). Export de oportunidades fica para quando houver a lista de oportunidades.            |

### 1A.8 Critérios de aceite

- [ ] Backfill em branch do Neon: nº de oportunidades = nº de leads com status ou valor; soma de valores idêntica antes/depois.
- [ ] Tabela de leads idêntica para o usuário com a flag ligada (mesmos valores, mesmos filtros salvos).
- [ ] Ganhar uma oportunidade torna a pessoa `cliente` e grava `first_won_at`; reabrir reverte.
- [ ] Teste de RLS: tenant A não lê nem escreve `crm_deal` do tenant B, inclusive via `person_id` forjado.
- [ ] Desligar `crm.deals_v1` não perde dado e a tabela volta às colunas antigas.

## Trilha 1B — Forecast

O forecast mostra, por mês, o realizado (ganhas pela data de ganho) e o ponderado das abertas (valor × probabilidade pela data prevista), com blocos explícitos para atrasadas e sem previsão. Depende da 1A.

### 1B.1 Probabilidade efetiva

```latex
p_{\text{efetiva}} = \begin{cases} \text{probability\_override} & \text{se preenchido} \\ \text{default\_probability do status} & \text{senão} \end{cases}
```

- `crm_option` (kind `status`) ganha `default_probability smallint`. Categoria `won` = 100 e `lost` = 0, fixos e não editáveis.
- Sugestão de padrões no seed, editáveis pelo DONO: Novo 10, Em contato 20, Qualificado 40, Proposta 60, Negociação 80.
- Opção `open` sem `default_probability` definido: o backend exige o valor ao salvar; o seed preenche os existentes. Assim nunca cai no comportamento do Pipedrive de contar o valor cheio por falta de probabilidade.
- **Override volta ao padrão quando o status muda**, com aviso na UI. Um override esquecido de uma etapa anterior é a principal fonte de forecast inflado.

### 1B.2 O que cada número significa

| Número          | Regra                                   | Data que posiciona no mês       |
| --------------- | --------------------------------------- | ------------------------------- |
| Realizado       | Soma de `amount` das `won`              | `won_at` no fuso do tenant      |
| Ponderado       | Σ `amount × p_efetiva / 100` das `open` | `expected_close_date`           |
| Melhor caso     | Σ `amount` das `open`                   | `expected_close_date`           |
| Previsto do mês | Realizado + Ponderado do mês            | —                               |
| Atrasadas       | `open` com `expected_close_date` < hoje | Bloco à parte, fora dos meses   |
| Sem previsão    | `open` sem `expected_close_date`        | Bloco à parte                   |
| Sem valor       | `open` sem `amount`                     | Só contagem, aviso de qualidade |

Horizonte padrão: mês atual + 3 meses à frente + 3 meses para trás (realizado). Agrupamentos: total, por responsável da oportunidade, por status.

### 1B.3 Cálculo e desempenho

- Uma query agregada sobre `crm_deal` com os índices da 1A.1; `date_trunc('month', won_at AT TIME ZONE <tz do tenant>)`. Sem tabela materializada nesta sprint.
- Cache Redis de 60 s por `(tenant, filtros, role)`, invalidado por qualquer evento `deal.*` do outbox.
- Respeita permissão por campo: quem não vê Valor vê só contagens; quem não vê Probabilidade vê o ponderado mas não o percentual por oportunidade.

### 1B.4 Assertividade (snapshots)

- Job semanal (segunda, 06:00 no fuso do tenant) grava em `crm_forecast_snapshot (tenant_id, month, owner_id null, weighted, best_case, realized, open_count, taken_at)` para o mês atual e os 3 seguintes.
- Ao fechar um mês, o painel compara o **ponderado do primeiro snapshot do mês** com o realizado: `assertividade = realizado / ponderado`. Mês sem snapshot (início do uso) mostra "sem dados ainda".
- Mudar as probabilidades padrão altera o forecast futuro, não os snapshots passados: o histórico mostra o que se previa na época.

### 1B.5 UI

- Página **Forecast** no CRM: gráfico de barras por mês (realizado + ponderado empilhados, melhor caso como marcador), tabela de oportunidades do mês selecionado, blocos Atrasadas e Sem previsão com ação em massa "atualizar data prevista".
- Meta mensal simples por tenant (um valor por mês) é **opcional** nesta sprint; se entrar, aparece como linha no gráfico.
- Valores com `won_at_estimated` (backfill) aparecem com ícone de aviso.

### 1B.6 Edge cases

| Situação                                             | Comportamento                                                                                |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Ganha às 23:30 do último dia do mês (UTC já é dia 1) | Agrupa pelo fuso do tenant (`America/Sao_Paulo` padrão): conta no mês certo.                 |
| Data prevista no passado e ainda aberta              | Bloco Atrasadas; não infla meses passados nem o atual.                                       |
| Oportunidade ganha sem valor                         | Conta na quantidade de ganhas, R$ 0 no realizado, aviso de qualidade.                        |
| Probabilidade padrão alterada                        | Forecast recalcula na hora (cache invalidado); snapshots antigos intactos.                   |
| Oportunidade reaberta                                | Sai do realizado do mês em que foi ganha; volta ao ponderado. Snapshot daquele mês não muda. |
| Pessoa ou oportunidade excluída                      | Sai do cálculo; restaurada, volta.                                                           |
| Tenant sem nenhuma oportunidade                      | Estado vazio com chamada para criar a primeira, não um gráfico zerado.                       |
| Valores em centavos                                  | `numeric(14,2)` no banco; soma no banco, nunca em float no Node.                             |

### 1B.7 Critérios de aceite

- [ ] Ponderado de um mês bate com a soma manual em planilha para um tenant de teste com 20 oportunidades.
- [ ] Oportunidade ganha na virada do mês cai no mês correto no fuso do tenant.
- [ ] Override é limpo ao mudar status e o usuário é avisado.
- [ ] OPERADOR sem permissão de Valor não vê nenhum R$ no forecast nem na resposta da API.

## Trilha 2 — Motor de formulários

Um motor genérico de formulários com link pessoal (uma pessoa + um formulário), enviado manualmente; a anamnese é o primeiro formulário configurado nele. Não depende da 1A, só da Fase 0.

### 2.1 Modelo de dados

```
crm_form
  id, tenant_id, name, description, is_active, current_version_id
  link_ttl_days smallint default 7

crm_form_version                        -- imutável depois de publicada
  id, form_id, version int, published_at
  sections jsonb    -- [{title, items:[{field_id, required, write_policy}]}]
  fields_snapshot jsonb -- label, tipo e opções de cada campo NO momento da publicação
  intro_text, consent_text

crm_form_link
  id, tenant_id, form_id, form_version_id, person_id, deal_id null
  token_hash bytea unique, token_encrypted bytea
  status text       -- active | submitted | expired | revoked
  expires_at, opened_at null, created_by, created_at, submitted_at, revoked_at
  unique (person_id, form_id) where status = 'active'

crm_form_submission                     -- imutável
  id, tenant_id, form_link_id, person_id, deal_id null, form_version_id
  answers jsonb, consent_text_hash, consent_accepted_at
  filled_by text    -- titular | responsavel
  guardian_name text null
  ip inet, user_agent text, submitted_at
  write_report jsonb -- o que foi gravado, ignorado ou mandado para revisão
```

`crm_field` ganha o tipo **upload** e a flag **`is_sensitive`**. Campos sensíveis nascem com permissão "Oculto" para OPERADOR e ficam fora do export por padrão.

### 2.2 Ciclo de vida do link

1. Recepção clica **Copiar link** na seção Formulários da ficha → `createFormLink(personId, formId, dealId?)` devolve o link ativo existente ou cria um. O índice único parcial garante um ativo por pessoa+formulário mesmo com cliques simultâneos.
2. Formas de envio (iguais às do Codental): copiar para a área de transferência; **Abrir no WhatsApp** com `https://wa.me/55<telefone>?text=<mensagem com o link>`; **QR Code** para preencher no tablet da recepção.
3. Status: `active` → `submitted` (respondido) · `expired` (passou de `expires_at`, avaliado na leitura) · `revoked` (recepção cancelou). Fechado → botão vira **Gerar novo**.
4. Revogação de link ativo é imediata; o link antigo mostra "Link inválido, peça um novo à clínica".

**Token:** 32 bytes de `crypto.randomBytes`, base64url (\~43 caracteres). Busca sempre por `token_hash` (SHA-256). `token_encrypted` (AES-256-GCM, chave de dados protegida pelo AWS KMS) existe só para o "copiar de novo" devolver o mesmo link. Nunca ID sequencial nem UUID como token.

### 2.3 Página pública

- Rota `GET /public/f/:token`: uma função `SECURITY DEFINER` resolve `token_hash` → `tenant_id`, `person_id`; o resto roda com o contexto do tenant setado, mantendo o RLS.
- Mostra o tema Camaleão do tenant, "Olá, Jorge" e telefone mascarado. Pré-preenche só campos **não** sensíveis.
- Renderiza a partir de `fields_snapshot` da versão do link, não do `crm_field` atual: o paciente vê exatamente o que foi publicado.
- Rascunho salvo só no `localStorage` do aparelho, nunca no servidor.
- Cabeçalhos: `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, `Cache-Control: no-store`, CSP sem scripts de terceiros (nada de analytics na página que carrega dado de saúde).
- Rate limit por IP e por token.

### 2.4 Envio da resposta

Uma transação:

1. `SELECT … FOR UPDATE` no link; confere `active` e validade.
2. Valida respostas contra a versão (obrigatórios do formulário, tipo, opções do snapshot, CPF/CEP).
3. Grava `crm_form_submission` com aceite, IP, user agent e o hash do termo aceito.
4. Aplica nos campos da pessoa conforme `write_policy` de cada item:
   - `overwrite` (padrão para perguntas de anamnese): a declaração mais recente vale.
   - `fill_if_empty` (padrão para e-mail, telefone, CPF): grava só se vazio; se divergir, vai para **revisão** no `write_report`.
   - Valor de contato que já pertence a **outra** pessoa (regra de duplicidade): não grava, vai para revisão.
5. Marca o link `submitted`, emite `form.submitted` no outbox.
6. Avalia regras de alerta; após o commit, notifica via Socket.io.

### 2.5 Uploads

- `POST /public/f/:token/uploads` devolve URL pré-assinada para o storage; o arquivo vai para um prefixo temporário.
- Limites: 10 MB por arquivo, 5 por campo, só imagem (JPEG/PNG/HEIC) e PDF, tipo conferido pelo conteúdo, não pela extensão.
- Imagens são reprocessadas no servidor para **remover EXIF**, que pode conter a localização GPS da casa do paciente.
- No envio, os arquivos referenciados saem do prefixo temporário para o definitivo; uma regra de ciclo de vida do storage apaga os temporários órfãos após 24 h.
- Leitura sempre por URL assinada de curta duração (5 min), nunca link público permanente.

### 2.6 Alertas

- Regra por formulário: "se campo X = valor, alerta de nível N com texto T".
- Quem pode ver o campo sensível vê o alerta completo. OPERADOR sem acesso vê "Há um alerta clínico — consulte o profissional responsável", sem o conteúdo.
- Alerta fica no topo do drawer até ser marcado como visto por quem tem acesso.

### 2.7 LGPD

- Dado de saúde é dado pessoal sensível (art. 11). O termo de aceite é específico, destacado e versionado; o hash do texto aceito fica na submissão.
- Menor de idade: o formulário pergunta quem preenche; se responsável, exige nome do responsável (art. 14 pede consentimento de um dos pais ou responsável). **Validar o fluxo com jurídico.**
- Pedido de exclusão do titular: anonimiza respostas sensíveis da submissão e dos campos e apaga os uploads, mantendo metadados mínimos. Regras de guarda de prontuário podem se aplicar a clínicas: **validar com jurídico antes de liberar a exclusão total**.

### 2.8 Edge cases

| Situação                                                   | Comportamento                                                                                                                                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WhatsApp gera prévia do link (robô abre a URL)             | O GET não muda estado. `opened_at` só é marcado por uma chamada do JavaScript da página. Tags OG genéricas ("Formulário — \<nome da clínica>"), **nunca o nome do paciente**, que apareceria na prévia da conversa. |
| Link enviado para o contato errado                         | Revogar + gerar novo. Página não mostra dado além do primeiro nome.                                                                                                                                                 |
| Formulário editado com link já enviado                     | Edição publica versão nova; o link continua na versão em que foi criado.                                                                                                                                            |
| Campo do formulário desativado no CRM depois da publicação | A resposta fica na submissão; a gravação no campo é ignorada e registrada no `write_report`. Publicar versão nova com campo inativo é bloqueado.                                                                    |
| Opção de lista desativada depois da publicação             | Aceita, pois está no snapshot da versão; o campo grava a chave e a ficha mostra o selo "inativa". Exceção explícita à regra "escrita só aceita opções ativas".                                                      |
| Link expira enquanto o paciente preenche                   | Se `opened_at` < `expires_at`, aceita o envio até 2 h depois (tolerância). Senão, mensagem pedindo novo link; o rascunho local fica preservado.                                                                     |
| Clique duplo / duas abas                                   | `FOR UPDATE` + checagem de status: a segunda recebe "já enviado".                                                                                                                                                   |
| Pessoas mescladas                                          | Links e submissões migram para a sobrevivente; links ativos duplicados → mantém o mais recente, revoga o outro.                                                                                                     |
| Pessoa arquivada ou excluída                               | Links ativos revogados automaticamente.                                                                                                                                                                             |
| Paciente sem telefone na ficha                             | Botão Abrir no WhatsApp desabilitado; Copiar e QR continuam.                                                                                                                                                        |
| Tablet da recepção (QR)                                    | Modo recepção: ao enviar, a página limpa o `localStorage` e volta à tela inicial, para o próximo paciente não ver nada.                                                                                             |

### 2.9 Critérios de aceite

- [x] Copiar duas vezes devolve o mesmo link; duas recepcionistas ao mesmo tempo geram um link só. (FM2, 07/11/2026: `formulario-links.db.test.js`)
- [x] Token de um tenant nunca acessa dados de outro (teste de RLS na rota pública). (FM3, 08/11/2026: `formulario-publico.db.test.js`)
- [ ] Prévia do link no WhatsApp não mostra nome do paciente e não marca o link como aberto. (FM3: no back, `GET` não marca abertura, só o `POST /aberto`; falta provar a prévia, que vem do `index.html` do front)
- [ ] Foto enviada chega sem EXIF.
- [ ] Submissão é imutável: editar o campo na ficha não altera "Ver respostas".
- [ ] OPERADOR sem acesso a campos sensíveis vê o alerta genérico e não vê as respostas.

## Rollout, testes e observabilidade

Cada trilha liga primeiro no tenant interno, depois em um tenant piloto (uma clínica real), depois em todos; nenhuma flag fica ligada para todos antes de uma semana estável no piloto.

**Ordem de execução**

1. Fase 0 (juntos): `entity` no `crm_field`, outbox.
2. Em paralelo:
   - Trilha 1: 1A modelo → backfill no branch do Neon → projeção → UI → flag; depois 1B probabilidade padrão → query → painel → snapshots.
   - Trilha 2: `is_sensitive` + upload → formulário e versões → link e token → página pública → envio → alertas → seção na ficha.
3. Piloto com as três flags; correções.
4. Remoção da escrita dupla (1A.6, passo 7) só depois do piloto estável.

**Testes que não podem faltar**

- Unitários de funções puras: `deriveLifecycle`, escolha da oportunidade principal, probabilidade efetiva, `write_policy` do formulário.
- Propriedade: para qualquer sequência aleatória de mudanças de status, os agregados da pessoa sempre batem com um recálculo do zero.
- Integração com RLS real (role não privilegiada do Neon): isolamento entre tenants em `crm_deal`, `crm_form_link` e na rota pública.
- Concorrência: dois `createFormLink` simultâneos; dois envios do mesmo link; duas edições da mesma oportunidade.
- Fuso: oportunidade ganha às 23:30 de 31/10 em São Paulo cai em outubro.

**Observabilidade**

| Métrica                                                                      | Alerta quando                                           |
| ---------------------------------------------------------------------------- | ------------------------------------------------------- |
| Divergência entre agregados da pessoa e recálculo (job diário de amostragem) | Qualquer divergência                                    |
| Eventos do outbox sem processar há mais de 10 min (quando houver consumidor) | > 0                                                     |
| Tempo da query do forecast (p95)                                             | > 500 ms                                                |
| Taxa de resposta de links (respondidos / gerados em 7 dias)                  | Acompanhamento, sem alerta                              |
| 4xx na rota pública por IP                                                   | Pico acima do rate limit (possível varredura de tokens) |

Logs da rota pública **nunca** registram o token nem as respostas; registram só o `form_link_id`.

## Riscos e mitigação

O maior risco é o backfill da 1A gerar oportunidades ou datas erradas e o forecast nascer desacreditado; o ensaio no branch do Neon e o aviso de data estimada são a mitigação principal.

| Risco                                                            | Impacto                            | Mitigação                                                                                                                          |
| ---------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Backfill cria oportunidades erradas ou datas de ganho inventadas | Forecast e "Cliente desde" errados | Ensaio em branch do Neon com conferência de contagens e somas; `won_at_estimated` exibido na UI.                                   |
| Agregados da pessoa divergem de `crm_deal`                       | Ciclo de vida e filtros errados    | Recálculo sempre do zero; job diário de amostragem que alerta divergência.                                                         |
| Tabela atual muda de comportamento com a flag                    | Regressão percebida pelo cliente   | Projeção da oportunidade principal + escrita dupla por uma release; teste de paridade de filtros salvos.                           |
| Forecast inflado por probabilidades otimistas                    | DONO perde confiança               | Override reseta na mudança de status; assertividade mensal expõe o viés.                                                           |
| Vazamento de dado de saúde pelo link                             | Incidente de LGPD                  | Token de alta entropia, hash no banco, nada sensível pré-preenchido, prévia OG genérica, sem scripts de terceiros, logs sem token. |
| Base legal e guarda de anamnese mal definidas                    | Risco jurídico para a clínica      | Validar termo, fluxo de menor e política de exclusão com jurídico antes de ligar `crm.forms_v1` no piloto.                         |
| M8 construído antes da `entity`                                  | Regras condicionais refeitas       | M8 só começa depois da Fase 0 e da 1A.                                                                                             |

## Preparação para a sprint do bot

Nada desta sprint precisa ser refeito quando chegar o motor de mensagens; ele consome quatro pontos de extensão já prontos.

| Ponto pronto agora                                               | Quem vai consumir                                                                 |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `createFormLink(personId, formId, dealId?)` como service isolado | Envio automático do link de anamnese e do NPS por template de WhatsApp            |
| Evento `deal.won` no outbox                                      | Régua de pós-venda (D+1, D+7, NPS em D+30)                                        |
| `person.lifecycle_changed`, `last_won_at`, `open_deals_count`    | Campanha contínua de reativação ("clientes sem compra há 180 dias")               |
| `form.submitted` + regras de alerta                              | Notificação do profissional por WhatsApp/e-mail; lembrete para quem não respondeu |
| Motor de formulários genérico                                    | Formulário de NPS e formulário de captação (link genérico)                        |

## Referências

- [HubSpot — Use lifecycle stages](https://knowledge.hubspot.com/records/use-lifecycle-stages?MKT=V81)
- [Vantagepoint — Lifecycle stages vs deal stages no HubSpot](https://vantagepoint.io/blog/hs/lifecycle-stages-vs-deal-stages)
- [Sybill — HubSpot lifecycle stages](https://www.sybill.ai/blogs/hubspot-lifecycle-stages)
- [Sybill — HubSpot deal stages e probabilidades](https://www.sybill.ai/blogs/hubspot-deal-stages)
- [HubSpot — Set up the forecast tool](https://knowledge.hubspot.com/forecast/set-up-the-forecast-tool?device=c)
- [HubSpot Community — Weighted pipeline forecasting (override por deal)](https://community.hubspot.com/t/weighted-pipeline-forecasting/32044)
- [Salesforce — convertLead()](https://developer.salesforce.com/docs/atlas.en-us.api.meta/api/sforce_api_calls_convertlead.htm)
- [Pipedrive — Leads vs deals](https://support.pipedrive.com/en/article/leads-vs-deals)
- [Pipedrive — Probability in Pipedrive](https://support.pipedrive.com/hc/en/articles/115005663465)
- [Pipedrive — Forecast view](https://support.pipedrive.com/article/the-forecast-view-revenue-projection)
- [Pipedrive — Revenue forecast report](https://support.pipedrive.com/en/article/insights-reports-revenue-forecast)
- [Codental — Enviar a anamnese para o paciente responder](https://intercom.help/codental/pt-BR/articles/10269091-como-enviar-a-anamnese-para-o-paciente-responder)
- [Codental — Link para o paciente preencher o cadastro](https://intercom.help/codental/pt-BR/articles/12674099-como-enviar-o-link-para-o-paciente-preencher-o-proprio-cadastro-no-codental)
- [Codental — Como o paciente preenche cadastro e anamnese](https://intercom.help/codental/pt-BR/articles/12675771-como-o-paciente-preenche-o-proprio-cadastro-e-anamnese-no-codental)
