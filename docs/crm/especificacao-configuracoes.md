# CRMFlow — Especificação de Configurações e Features do CRM

Oct 15, 2026 · @Nickolas

## Contexto e diagnóstico

O módulo CRM do CRMFlow deve ganhar uma área de Configurações que permita a cada tenant adaptar o lead à sua operação, sem código. Todas as features abaixo têm referência em CRMs de mercado (HubSpot, Pipedrive, Salesforce, Attio, RD Station, Agendor), listadas em Referências.

**O que já existe:** tabela de leads com busca, Filtros, Views e Colunas; importação .xlsx em 4 passos (Arquivo, Mapear, Revisar, Processar); tela Campos com campos do sistema (Visível, Obrigatório, Ordem) e campos personalizados; drawer de detalhe com seções Contato, Dados adicionais e Negócio; formulário Novo lead.

**Lacunas identificadas:**

1. Um único toggle "Visível" controla formulário, filtros e tabela ao mesmo tempo.
2. A ordem é um input numérico (hoje tudo em 0); o padrão de mercado é arrastar e soltar com "voltar ao padrão".
3. Não existe conceito de campo identificador: o título do lead é sempre o Nome, e a tabela sempre mostra Telefone.
4. Status e Origem são listas fixas, sem cor, ordem ou desativação.
5. A única ação destrutiva é Excluir; não há arquivar, mesclar nem edição em massa.
6. O drawer só mostra dados; não há histórico de atividades.

## Estrutura da área Configurações do CRM

A aba "Campos" da sidebar de nível 2 vira "Configurações", com nove subseções. Acesso de escrita: DONO (e MASTER). OPERADOR só altera o próprio override de layout (ver seção 1).

| Subseção | O que configura | Quem edita |
| --- | --- | --- |
| Layout do lead | Identificador, subtítulo, destaques, seções do drawer | DONO (padrão do tenant); OPERADOR (override pessoal) |
| Campos | Campos do sistema e personalizados, visibilidade por contexto, obrigatoriedade, condicionais, permissões | DONO |
| Listas | Status, Origem, Motivos de perda, Tipos de atividade, Tags | DONO |
| Duplicidade | Regras de correspondência e ação | DONO |
| Distribuição | Regras de atribuição de responsável | DONO |
| Inatividade | Dias até esfriar por status | DONO |
| Pontuação | Critérios de score e faixas | DONO |
| Enriquecimento | Consulta automática de CNPJ | DONO |
| Privacidade (LGPD) | Base legal padrão, obrigatoriedade | DONO |

## 1. Layout do lead

O tenant escolhe qual campo identifica o lead (Nome, Empresa, CNPJ ou CPF) e quais campos aparecem em destaque. Resolve o caso "mostrar CNPJ em vez de telefone".

**Referências:** o Attio deixa escolher o "Record text", atributo principal que identifica o registro; o Salesforce usa Compact Layouts para colocar campos-chave no cabeçalho da ficha; o Attio exibe até seis atributos como widgets no topo da ficha.

### Configurações

| Configuração | Valores | Onde aparece |
| --- | --- | --- |
| Identificador principal | 1 campo: Nome, Empresa, CNPJ, CPF, E-mail ou campo personalizado de texto | Título do drawer, 1ª coluna da tabela, resultados de busca, cards do kanban |
| Subtítulo | Até 2 campos, unidos por " · " | Abaixo do título no drawer (substitui "Dados do lead.") |
| Campos em destaque | Até 4 campos | Chips no topo do drawer (ex.: Valor, Status, Responsável) |
| Seções do drawer | Nome, ordem e campos de cada seção | Corpo do drawer |
| Colunas padrão da tabela | Lista ordenada de campos | Tabela de leads ao abrir sem view salva |

### Regras

- Se o identificador estiver vazio em um lead, cai para o Nome; se o Nome também estiver vazio, mostra "Lead sem nome".
- Campos do identificador e do subtítulo são formatados pela máscara do tipo (CNPJ como 00.000.000/0000-00, telefone como (00) 00000-0000).
- O identificador entra no índice de busca: buscar por CNPJ deve funcionar com e sem pontuação.

### Escopo: tenant e usuário

O Attio aplica a configuração da ficha a todos os membros; o HubSpot aplica a personalização só à visão de quem a fez. O CRMFlow terá os dois níveis:

1. **Padrão do tenant**, definido pelo DONO.
2. **Override pessoal**, opcional, com botão "Voltar ao padrão" (o HubSpot tem "Reset to system defaults").

Quando o DONO adiciona um campo ao padrão depois que um usuário personalizou, o campo novo entra no fim da lista do usuário (mesmo comportamento do HubSpot).

## 2. Campos

Cada campo passa a ter visibilidade separada por contexto, ordem por arrastar, obrigatoriedade condicional e permissão por papel.

### 2.1 Visibilidade por contexto

O toggle "Visível" vira uma matriz de quatro colunas. O Pipedrive passou a permitir escolher quais campos personalizados aparecem no detalhe do lead; o Attio tem templates que definem os campos do formulário de criação.

| Contexto | Efeito quando ligado |
| --- | --- |
| Formulário de criação | Aparece no drawer "Novo lead" |
| Ficha | Aparece no drawer de detalhe (na seção escolhida no Layout) |
| Tabela | Disponível no seletor de Colunas; coluna padrão se marcada no Layout |
| Filtros | Aparece no painel de Filtros |

Desligar um contexto não apaga dados (mantém o texto atual da tela). A ordem passa a ser drag-and-drop na lista, com "Voltar ao padrão"; o input numérico some.

### 2.2 Tipos de campo personalizado

Checklist baseado nos tipos editáveis do Pipedrive:

- **MVP:** texto curto, texto longo, número, monetário (BRL), data, opção única, múltipla escolha, telefone, e-mail, URL, sim/não.
- **Depois:** CPF, CNPJ e CEP com máscara e validação de dígito; endereço; usuário (lookup de membro do tenant); intervalo de datas; hora.
- CNPJ deve aceitar o formato alfanumérico, já suportado por integrações de mercado.

### 2.3 Obrigatoriedade

Três níveis, do mais simples ao mais avançado:

1. **Sempre obrigatório:** comportamento atual.
2. **Obrigatório a partir de um status:** como os campos obrigatórios por etapa do RD Station (lá restrito ao plano Pro, ou seja, recurso monetizável).
3. **Condicional:** "se campo A = valor X, então campo B fica visível e/ou obrigatório". O HubSpot aplica isso no formulário de criação, na ficha e na listagem, e bloqueia o salvamento sem o dependente. Caso principal: Status = Perdido exige Motivo da perda.

Validação acontece no backend (Fastify), não só no front; a importação aplica as mesmas regras e reporta linhas inválidas no passo Revisar.

### 2.4 Permissão por campo

O HubSpot permite restringir quem vê e quem edita cada propriedade, mostrando uma mensagem de falta de permissão ao passar o mouse. Lá é recurso Enterprise.

No CRMFlow, por campo e por papel: **Ver e editar**, **Só ver** ou **Oculto**. Exemplo: OPERADOR só vê Valor; Probabilidade de fechamento oculta para OPERADOR. DONO e MASTER sempre veem e editam tudo.

## 3. Listas configuráveis

Status, Origem, Motivos de perda, Tipos de atividade e Tags viram listas editáveis pelo DONO, cada uma com nome, cor, ordem e flag de ativo.

| Lista | Padrões sugeridos | Referência |
| --- | --- | --- |
| Status | Novo, Em contato, Qualificado, Proposta, Ganho, Perdido | Pipedrive: labels padrão Quente, Morno, Frio + personalizadas |
| Origem | Tráfego pago, Orgânico, Indicação, WhatsApp, Instagram, Importação, Outro | Flowlu: cadastro de fontes para medir eficácia |
| Motivos de perda | Orçamento, Escolheu concorrente, Baixo interesse, Ciclo longo, Produto incompatível, Outro | SendPulse (padrões); RD Station (motivos por funil) |
| Tipos de atividade | Ligação, WhatsApp, Reunião, E-mail, Tarefa, Visita | Pipedrive: tipos com ícone próprio |
| Tags | Livre | Já existe; ganha cor e gestão central |

### Regras

- **Desativar, não excluir.** Opção em uso sai dos seletores mas continua no histórico e nos relatórios (Flowlu e SendPulse fazem assim). Excluir só é permitido com zero registros vinculados.
- Status tem um atributo extra `categoria`: aberto, ganho ou perdido. Relatórios e a regra "Perdido exige motivo" usam a categoria, não o nome, para o tenant poder renomear.
- Motivos de perda podem ser filtrados por funil quando o módulo de funis existir.
- Tags novas criadas no formulário entram na lista central automaticamente.

## 4. Duplicidade e mesclagem

O tenant define como um duplicado é detectado e o que acontece quando ele aparece, separando os dois conceitos como o Salesforce faz (matching rules e duplicate rules).

### Regras de correspondência

| Campo | Método | Normalização |
| --- | --- | --- |
| E-mail | Exato | Minúsculas, trim |
| Telefone | Normalizado | Só dígitos; remove +55; trata com e sem o 9 após o DDD |
| CNPJ | Exato | Só dígitos (ou alfanumérico) |
| CPF | Exato | Só dígitos |
| Nome + Empresa | Aproximado (fase 2) | pg\_trgm com limiar configurável |

O Salesforce documenta justamente o caso do telefone com e sem código do país; no Brasil o nono dígito é o caso mais comum.

### Ação

- **Avisar:** mostra os possíveis duplicados e deixa salvar.
- **Bloquear:** impede o salvamento e oferece abrir o existente.

As regras valem em todas as entradas: formulário, importação (linha marcada no passo Revisar com opção pular, atualizar ou criar), API e canais (WhatsApp, Instagram).

### Mesclar leads

Ação no menu "..." e na seleção em massa (2 leads). Como no Pipedrive, o usuário escolhe campo a campo qual valor manter; atividades, tags e histórico dos dois são unidos; o lead descartado é removido e um evento de auditoria guarda o ID original.

## 5. Distribuição de leads

Leads novos sem responsável recebem um dono automaticamente por regras ordenadas, com round-robin como fallback. É uma brecha concreta: o Agendor distribui leads só manualmente ou por planilha de importação.

### Como funciona

1. O DONO cria regras em uma lista ordenada. Cada regra tem condições (Origem, Tag, UF, campo personalizado) e um destino (um usuário ou um grupo).
2. A primeira regra que casar decide. Se o destino for um grupo, distribui em round-robin entre os membros ativos do grupo.
3. Se nenhuma regra casar, cai no round-robin geral (ou fica sem responsável, configurável).
4. O lead mostra qual regra o atribuiu, para o DONO depurar.

### Opções

- Pular usuários marcados como ausentes ou desativados.
- Peso por usuário (fase 2), para dar mais leads a quem converte mais.
- Respeitar responsável já preenchido (formulário, importação ou API) em vez de sobrescrever.
- Notificar o responsável (in-app agora; WhatsApp quando o módulo omnichannel existir).

O Salesforce permite só uma regra de atribuição ativa por vez; permitir regras por origem já supera esse limite.

**Implementação:** ponteiro do round-robin por grupo em Redis (INCR atômico) ou numa linha com `SELECT … FOR UPDATE`, para não atribuir dois leads ao mesmo vendedor em concorrência.

## 6. Inatividade (lead esfriando)

Cada status ganha um limite de dias sem interação; passou do limite, o lead é marcado como "esfriando". Referência direta: a função Rotting do Pipedrive, configurada em dias por etapa, que pinta o card de vermelho; o RD Station também mostra negociações esfriando no resumo do funil.

### Configuração

| Status | Dias até esfriar (sugestão) |
| --- | --- |
| Novo | 1 |
| Em contato | 3 |
| Qualificado | 5 |
| Proposta | 7 |
| Ganho / Perdido | Desligado |

### O que reseta o contador

Atualiza `ultima_interacao`: atividade concluída, nota adicionada, mensagem enviada ou recebida no WhatsApp/Instagram, mudança de status. Edição de campos não conta (decisão a validar).

O Pipedrive ignora atividades futuras, então um negócio com reunião marcada longe ainda apodrece. Decisão proposta: **atividade agendada pausa o contador até a data dela**.

### Na interface

- Indicador na linha da tabela e no drawer ("esfriando há 4 dias").
- Filtro pronto "Esfriando" e uma view padrão.
- Notificação diária ao responsável (job BullMQ às 8h no fuso do tenant).

## 7. Pontuação de leads

Cada lead recebe um score numérico calculado por regras do DONO, exibido como faixa colorida. O HubSpot separa score de fit (perfil, não decai) e de engajamento (ações, decai) e usa faixas com rótulos coloridos.

### MVP: só fit

- Regras no formato "se campo X operador Y, então +N pontos" (N pode ser negativo). Ex.: Origem = Indicação +20; UF = SC +10; Valor > 5.000 +15; Cargo vazio −5.
- Faixas configuráveis: Frio (0–29), Morno (30–59), Quente (60+), com cor.
- Score vira campo do sistema: aparece na tabela, nos filtros e pode ser identificador de destaque.
- Ao mudar as regras, recalcula todos os leads em job assíncrono (o HubSpot também reavalia tudo automaticamente).

### Fase 2: engajamento

Pontos por eventos (mensagem respondida, reunião realizada, link aberto) com decaimento, quando o módulo omnichannel gerar esses eventos. Score total = fit + engajamento, com limite por grupo.

## 8. Enriquecimento por CNPJ

Ao informar um CNPJ, o sistema busca dados públicos da Receita Federal e preenche razão social, nome fantasia, endereço, CNAE e situação cadastral. No CRM da Senior isso é uma opção nas configurações do sistema; na Bitrix24 e no Odoo existe via apps e módulos de terceiros.

### Configuração

- Ligar/desligar a consulta (desligado esconde o botão de lupa no campo).
- Modo: **manual** (botão ao lado do CNPJ) ou **automático** (ao salvar um lead com CNPJ, inclusive na importação).
- Mapeamento: qual dado da Receita preenche qual campo do CRM, e se sobrescreve valor já preenchido.

### Implementação

- Provedor com fallback: BrasilAPI (aberta) como primário; provedor pago (ex.: SERPRO) como opção para volume. O ReceitaWS gratuito permite 3 consultas por minuto, o que inviabiliza importação em lote sem fila.
- Fila BullMQ com rate limiter por provedor; importações de 5.000 linhas enfileiram os CNPJs e enriquecem em segundo plano.
- Cache por CNPJ (ex.: 30 dias) compartilhado entre tenants, já que o dado é público.
- Cada consulta registra um evento na timeline do lead.

## 9. LGPD: base legal

Todo lead passa a registrar a base legal do tratamento de dados, com data e origem. A LGPD exige base legal para qualquer operação com dado pessoal, e o RD Station já permite atribuí-la no cadastro manual e na importação.

### Campos do sistema

| Campo | Valores |
| --- | --- |
| Base legal | Consentimento, Legítimo interesse, Execução de contrato, Obrigação legal, Outra |
| Data da base legal | Data/hora |
| Origem do registro | Formulário, importação, WhatsApp, manual, API |
| Opt-out de marketing | Sim/não, com data |

### Configuração

- Base legal padrão para leads criados manualmente.
- Tornar a base legal obrigatória (no formulário e na importação).
- Passo extra no wizard de importação: atribuir base legal ao lote inteiro.

### Por que é diferencial

Combina com o posicionamento anti-lock-in/portabilidade do CRMFlow: exportação completa e registro de base legal formam um pacote "LGPD de verdade" vendável. Pedido de exclusão do titular deve anonimizar o lead, preservando estatísticas.

## Melhorias na tela de leads

Seis melhorias fora de Configurações, cada uma ligada a uma lacuna do diagnóstico.

| Melhoria | Detalhe | Referência |
| --- | --- | --- |
| Arquivar | "Excluir" sai do destaque vermelho; entra "Arquivar" (some da lista ativa, filtro "Arquivados"). Excluídos ficam 30 dias na lixeira com restaurar | Pipedrive: arquivar e restaurar leads |
| Mesclar | Ver seção 4 | Pipedrive |
| Edição em massa | Checkbox na tabela; alterar Status, Responsável, Tags, Origem; depois campos personalizados | Pipedrive começou só pelos campos padrão |
| Exportação com escolha de campos | Exportar abre seletor de campos e formato (.xlsx/.csv), respeitando a view atual | Reclamação de usuário do RD Station |
| Nome e sobrenome | Campo Nome continua; adicionar Primeiro nome derivado (editável) para personalizar mensagens | Pedido de usuário do RD Station |
| Timeline no drawer | Drawer ganha abas: Dados · Atividades · Histórico (mudanças de campo com autor e data) | Attio e HubSpot: ficha com abas |

Na importação, confirmar que o passo Mapear lista campos personalizados como destino, como o Pipedrive faz.

## Modelagem de dados

Todas as tabelas abaixo carregam `tenant_id` e ficam sob as políticas de RLS existentes. Nomes são proposta; ajustar ao schema do MASTER\_DOCUMENT.

| Tabela | Colunas principais | Observação |
| --- | --- | --- |
| `crm_layout_config` | tenant\_id (PK), identifier\_field\_id, subtitle\_field\_ids\[\], highlight\_field\_ids\[\], sections jsonb, default\_columns\[\] | 1 linha por tenant |
| `crm_user_layout_override` | tenant\_id, user\_id, mesmo formato parcial em jsonb | Ausente = usa padrão do tenant |
| `crm_field` | id, tenant\_id, key, label, type, is\_system, options jsonb, position, is\_active | Unifica campos do sistema e personalizados |
| `crm_field_visibility` | field\_id, context (create\_form, detail, table, filter), visible | Contexto como linha, não coluna: novo contexto sem migração |
| `crm_field_rule` | id, field\_id, kind (required, required\_from\_status, conditional), condition jsonb | Validado no backend e na importação |
| `crm_field_permission` | field\_id, role, access (edit, view, hidden) | DONO/MASTER ignoram |
| `crm_option_list` / `crm_option` | list kind; option: label, color, position, category, is\_active | Status, Origem, Motivo de perda, Tipo de atividade, Tag |
| `crm_duplicate_rule` | id, fields jsonb, method, action (warn, block), is\_active |  |
| `crm_assignment_rule` | id, position, conditions jsonb, target\_user\_id ou target\_group\_id, is\_active | Ponteiro round-robin em Redis |
| `crm_stale_config` | status\_option\_id, days |  |
| `crm_score_rule` / `crm_score_band` | regra: condition jsonb, points; faixa: min, max, label, color | Score materializado em `lead.score` |
| `crm_cnpj_cache` | cnpj (PK), payload jsonb, fetched\_at | Global, sem tenant (dado público) |

No `lead`: adicionar `archived_at`, `deleted_at`, `score`, `stale_since`, `assigned_by_rule_id`, `legal_basis`, `legal_basis_at`, `marketing_opt_out_at`. Valores de campos personalizados continuam no formato atual (EAV ou jsonb), com índice GIN se for jsonb para os filtros.

## Roadmap e prioridades

Três fases, ordenadas por impacto no uso diário e dependência técnica. Cada fase depende da anterior porque `crm_field` e `crm_option` são a base de quase tudo.

1. **Fase 1 — Fundação de configuração**
   - Tabela `crm_field` unificada e visibilidade por contexto (seção 2.1)
   - Ordenação por arrastar
   - Layout do lead: identificador, subtítulo, destaques, colunas padrão (seção 1)
   - Listas configuráveis com desativação (seção 3)
   - Arquivar e lixeira
2. **Fase 2 — Qualidade de dados**
   - Duplicidade e mesclagem (seção 4)
   - Enriquecimento por CNPJ (seção 8)
   - Obrigatoriedade por status e condicional (seção 2.3)
   - Lead esfriando (seção 6)
   - Edição em massa e exportação com escolha de campos
3. **Fase 3 — Gestão e diferenciais**
   - Distribuição automática (seção 5)
   - Permissão por campo (seção 2.4)
   - Pontuação de leads (seção 7)
   - Base legal LGPD (seção 9)
   - Timeline de atividades no drawer

**Candidatos a plano pago:** obrigatoriedade por status, permissão por campo, distribuição com regras e score (todos são recursos de planos superiores em RD Station e HubSpot).

## Referências

- [HubSpot — Customize the properties shown on records](https://knowledge.hubspot.com/object-settings/customize-properties-in-record-sections)
- [HubSpot — Restrict view/edit access for properties](https://knowledge.hubspot.com/properties/restrict-view-edit-access-for-properties)
- [HubSpot — Understand the lead scoring tool](https://knowledge.hubspot.com/scoring/understand-the-lead-scoring-tool)
- [HubSpot Community — Field dependencies / conditional property logic](https://community.hubspot.com/t5/HubSpot-Ideas/Field-Dependencies-for-Contact-Properties/idi-p/8942)
- [Pipedrive — Leads Inbox](https://support.pipedrive.com/en/article/leads-inbox)
- [Pipedrive — Custom fields nos Leads](https://community.pipedrive.com/discussion/8526/new-leads-inbox-now-allows-editing-the-values-of-all-supported-custom-fields)
- [Pipedrive — The Rotting feature](https://support.pipedrive.com/en/article/the-rotting-feature)
- [Pipedrive — Creating custom activity types](https://support.pipedrive.com/article/creating-custom-activity-types)
- [Salesforce Trailhead — Matching rules e duplicate rules](https://trailhead.salesforce.com/sales_admin/sales_admin_duplicate_management/sales_admin_duplicate_management_unit_2)
- [Salesforce — Working with Compact Layouts](https://developer.salesforce.com/docs/atlas.en-us.218.0.salesforce1appadmin.meta/salesforce1appadmin/s1_admin_guide_compact_layouts_intro.htm)
- [Attio — Create and manage custom objects (Record text)](https://attio.com/help/reference/managing-your-data/objects/create-and-manage-custom-objects.md)
- [Attio — Configure record pages](https://attio.com/help/reference/managing-your-data/records/configure-record-pages)
- [RD Station — Campos obrigatórios por etapa](https://www.rdstation.com/crm/campos-obrigatorios-por-etapa)
- [RD Station — Novidades abril 2025 (motivos de perda por funil)](https://www.rdstation.com/blog/vendas/novidades-de-abril-rd-station-crm)
- [RD Station — LGPD e base legal](https://www.rdstation.com/protecao-de-dados/rd-station-e-lgpd/)
- [B2B Stack — Avaliações do RD Station CRM](https://www.b2bstack.com.br/product/rd-station-crm/avaliacoes?page=168)
- [Agendor — Lead routing](https://www.agendor.com.br/blog/lead-routing/)
- [Senior CRM — Busca de dados por CNPJ](https://documentacao.senior.com.br/crm-xt/manual-do-usuario/contas/crm-x-monoempresa/busca-cnpj-base-de-dados)
- [Bitrix24 — CNPJ Lookup](https://www.bitrix24.in/apps/app/tlj_tech.cnpj_lookup_for_bitrix24/)
- [Odoo OCA — CRM CNPJ Search](https://odoo-community.org/shop/brazilian-localization-crm-cnpj-search-716183)
- [SendPulse — Motivos de perda](https://sendpulse.com/br/knowledge-base/crm/deals/closed-deals-reasons)
- [Flowlu — Motivos de perda e fontes](https://www.flowlu.com/pt/help/articles/804-805-809--motivos-de-perda-e-fontes/)
