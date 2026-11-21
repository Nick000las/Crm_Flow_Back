# CRMFlow: visão geral do produto

> Estado em 21/11/2026. Resumo dos arquivos desta pasta, que descrevem o que está no código do back. Em caso de dúvida, vale o arquivo da área, e acima dele o código.

## O que é o CRMFlow hoje

O CRMFlow é um SaaS B2B multi-tenant: cada empresa cliente (tenant) tem seus dados isolados pelo próprio banco de dados e usa apenas os módulos contratados. Hoje estão entregues três blocos. O primeiro é a **plataforma**: login por convite, MFA por e-mail, papéis, isolamento entre empresas, módulos e flags por empresa, painel MASTER, notificações, páginas públicas, filas e tempo real. O segundo é o **CRM**: pessoas e campos configuráveis, oportunidades em até 5 pipelines, busca e dados em massa, qualidade de dados, histórico e LGPD, quadro comercial, formulários e forecast. O terceiro é o **Kanban Universal**, mantido por outro desenvolvedor, com quadros de equipe e quadros de entidade, que é onde aparece o quadro comercial do CRM. Agendamento, pagamento in-chat e as verticais existem só como esqueleto. A cobrança da mensalidade ainda não existe: o status da empresa é só um registro. A visão de longo prazo (atendimento omnichannel, IA, n8n, verticais) está em [MASTER_DOCUMENT](../MASTER_DOCUMENT.md), que é roadmap e não descreve o estado atual.

## Papéis e modelo de acesso

| Papel    | Quem é                          | Alcance resumido                                                             |
| -------- | ------------------------------- | ---------------------------------------------------------------------------- |
| MASTER   | Equipe da plataforma            | Painel `/admin/*` (empresas, módulos, flags); nos módulos, conta como gestão |
| DONO     | Dono do negócio do cliente      | Gestão: escreve a configuração do CRM e gere os quadros do Kanban            |
| OPERADOR | Usuário comum                   | Trabalho do dia a dia, dentro do que a gestão libera                         |
| Gestão   | DONO e MASTER (`PAPEIS_GESTAO`) | Em geral, a escrita de configuração é só da gestão e a leitura é de todos    |

O acesso é decidido em camadas. Cada camada só restringe a anterior.

| Camada                       | Quem decide | Efeito                                                                                                       | Onde está                                                     |
| ---------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| 1. Módulo contratado         | MASTER      | Sem o módulo, 403 `MODULE_NOT_ENABLED` no servidor                                                           | [Plataforma](plataforma.md)                                   |
| 2. Flag por funcionalidade   | MASTER      | Liberação gradual e kill switch, não cobrança; desligada, 403 `FEATURE_NOT_ENABLED`                          | [Plataforma](plataforma.md)                                   |
| 3. Papel                     | Fixo (RBAC) | Conferido antes da flag: o operador recebe sempre o mesmo 403 nas rotas de gestão                            | [Plataforma](plataforma.md)                                   |
| 4. Permissão por campo       | DONO        | Só para o OPERADOR: editar, só ver ou oculto; campo sensível nasce oculto (`crm.permissoes`)                 | [Pessoas e campos](crm-pessoas-e-campos.md)                   |
| 5. Visibilidade por pipeline | DONO        | O OPERADOR não vê os pipelines ocultos em nenhum lugar: quadro, tabela, ficha, busca, totais e forecast (D4) | [Oportunidades e pipelines](crm-oportunidades-e-pipelines.md) |

No Kanban há ainda a equipe de cada quadro, com editor ou leitor por participante ([Kanban](kanban.md)).

## Mapa das major features

| Área                      | O que entrega                                                                                 | Back                                                               | Front                                                                             | Flags principais                                                                                    | Arquivo                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Plataforma                | Login, MFA, papéis, RLS, módulos e flags, painel MASTER, sino, `/public`, filas               | pronto; parcial em admin (sem cobrança) e workers (fora do deploy) | sem handoff (contrato no código); páginas públicas com handoff (FM3)              | sempre ligado                                                                                       | [plataforma.md](plataforma.md)                                       |
| Kanban Universal          | Quadros, equipe, cards, comentários, e-mails, tempo real, quadros de entidade, vínculo        | pronto                                                             | documentado em `kanban-implementado`; aba Projetos com tela pendente              | `kanban_universal.quadros_entidade`, `kanban_universal.vinculo_entidade`                            | [kanban.md](kanban.md)                                               |
| Pessoas e campos          | Cadastro, campos em 3 camadas, 18 tipos, regras, listas, layout, permissões por campo         | pronto                                                             | quase tudo sem handoff (contrato no plano de Configurações); sensível com handoff | `crm.regras`, `crm.listas`, `crm.layout`, `crm.permissoes`                                          | [crm-pessoas-e-campos.md](crm-pessoas-e-campos.md)                   |
| Busca e dados em massa    | Busca e filtros, filtros do ciclo, views salvas, edição em massa, import e export             | pronto                                                             | sem handoff, exceto os filtros do ciclo (FC4)                                     | `crm.massa`; usa `crm.arquivo`, `crm.inatividade`, `crm.score`                                      | [crm-busca-e-dados-em-massa.md](crm-busca-e-dados-em-massa.md)       |
| Qualidade e produtividade | Duplicidade e mesclagem, CNPJ, score, distribuição, esfriando, atividades                     | pronto; follow-up é só campo                                       | sem handoff (contrato no plano de Configurações)                                  | `crm.duplicidade`, `crm.cnpj`, `crm.score`, `crm.distribuicao`, `crm.inatividade`, `crm.atividades` | [crm-qualidade-e-produtividade.md](crm-qualidade-e-produtividade.md) |
| Histórico, arquivo e LGPD | Histórico e timeline, arquivo e lixeira, base legal, opt-out, anonimização                    | pronto; opt-out só registra                                        | sem handoff, exceto oportunidade (M3) e efeitos em formulários (FM6)              | `crm.atividades`, `crm.timeline`, `crm.arquivo`, `crm.lgpd`                                         | [crm-historico-arquivo-e-lgpd.md](crm-historico-arquivo-e-lgpd.md)   |
| Oportunidades e pipelines | Oportunidades, principal, ciclo de vida, pipelines, atendimento automático, D4, outbox        | pronto                                                             | handoff entregue                                                                  | sempre ligado (a regra do motivo da perda depende de `crm.regras`)                                  | [crm-oportunidades-e-pipelines.md](crm-oportunidades-e-pipelines.md) |
| Quadro comercial          | Oportunidades como cards por pipeline, mover com regras, filtros, ordem, tempo real           | pronto; desempenho da abertura em aberto                           | handoff entregue; aviso `saiuDoFiltro` e medição na tela pendentes                | `crm.quadro_comercial` + `kanban_universal.quadros_entidade`                                        | [crm-quadro-comercial.md](crm-quadro-comercial.md)                   |
| Formulários               | Formulários versionados, link pessoal, página pública, resposta na ficha, termo, alertas      | pronto; parada do jurídico antes de tenant real                    | handoff entregue                                                                  | `crm.formularios`                                                                                   | [crm-formularios.md](crm-formularios.md)                             |
| Forecast                  | Probabilidade padrão, previsão mensal, blocos, lista, ação em massa, snapshots, assertividade | pronto                                                             | handoff entregue                                                                  | `crm.forecast`                                                                                      | [crm-forecast.md](crm-forecast.md)                                   |

## Flags

Todas são de rollout e kill switch, ligadas por empresa pelo MASTER. Não são cobrança. Ficam **sempre ligados, sem flag**: campos e visibilidade, tipos de campo, pipelines e oportunidades, filtros e views, import e export básicos, primeiro nome e os carimbos de LGPD.

| Chave                               | O que liga                                                                              | Arquivo                                                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `crm.listas`                        | Tela de listas configuráveis (status, origem, motivo da perda, tipo de atividade, tags) | [Pessoas e campos](crm-pessoas-e-campos.md)                                                                 |
| `crm.layout`                        | Layout da ficha e da tabela, padrão da empresa e "meu layout"                           | [Pessoas e campos](crm-pessoas-e-campos.md)                                                                 |
| `crm.regras`                        | Regras de obrigatoriedade, inclusive "motivo da perda obrigatório em Perdido"           | [Pessoas e campos](crm-pessoas-e-campos.md), [Oportunidades](crm-oportunidades-e-pipelines.md)              |
| `crm.permissoes`                    | Permissões por campo do operador e liberação de campo sensível                          | [Pessoas e campos](crm-pessoas-e-campos.md)                                                                 |
| `crm.massa`                         | Edição em massa, export em `.csv` e colunas padrão do export                            | [Busca e dados em massa](crm-busca-e-dados-em-massa.md)                                                     |
| `crm.duplicidade`                   | Regras de duplicidade da empresa e mesclagem                                            | [Qualidade e produtividade](crm-qualidade-e-produtividade.md)                                               |
| `crm.cnpj`                          | Enriquecimento por CNPJ (lupa e automático)                                             | [Qualidade e produtividade](crm-qualidade-e-produtividade.md)                                               |
| `crm.score`                         | Lead score calculado por regras, faixas e filtro por faixa                              | [Qualidade e produtividade](crm-qualidade-e-produtividade.md)                                               |
| `crm.distribuicao`                  | Distribuição automática de leads e seus avisos                                          | [Qualidade e produtividade](crm-qualidade-e-produtividade.md)                                               |
| `crm.inatividade`                   | Lead esfriando: informação, filtro, view do sistema, selo e resumo diário               | [Qualidade e produtividade](crm-qualidade-e-produtividade.md)                                               |
| `crm.atividades`                    | Atividades do lead e leitura do histórico                                               | [Qualidade e produtividade](crm-qualidade-e-produtividade.md), [Histórico](crm-historico-arquivo-e-lgpd.md) |
| `crm.timeline`                      | Filtro do histórico por categoria                                                       | [Histórico, arquivo e LGPD](crm-historico-arquivo-e-lgpd.md)                                                |
| `crm.arquivo`                       | Arquivar, restaurar da lixeira e filtro de situação                                     | [Histórico, arquivo e LGPD](crm-historico-arquivo-e-lgpd.md)                                                |
| `crm.lgpd`                          | Configuração de LGPD, base legal do lote no import e anonimização                       | [Histórico, arquivo e LGPD](crm-historico-arquivo-e-lgpd.md)                                                |
| `crm.quadro_comercial`              | Quadro comercial (precisa também de `kanban_universal.quadros_entidade`)                | [Quadro comercial](crm-quadro-comercial.md)                                                                 |
| `crm.formularios`                   | Formulários, links, página pública, respostas e alertas                                 | [Formulários](crm-formularios.md)                                                                           |
| `crm.forecast`                      | Forecast, snapshots e assertividade; ao ligar, liga Data prevista e Probabilidade       | [Forecast](crm-forecast.md)                                                                                 |
| `kanban_universal.quadros_entidade` | Quadros publicados por outros módulos no Kanban (hoje o quadro comercial)               | [Kanban](kanban.md), [Quadro comercial](crm-quadro-comercial.md)                                            |
| `kanban_universal.vinculo_entidade` | Vínculo de card de projeto com pessoa do CRM e aba Projetos na ficha                    | [Kanban](kanban.md), [Quadro comercial](crm-quadro-comercial.md)                                            |

Os nomes `crm.deals_v1`, `forms_v1` e `forecast_v1`, que aparecem nos planos antigos, não existem.

## Números-chave

| Item                                     | Limite                                                   | Arquivo                                                                  |
| ---------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------ |
| Pipelines por empresa                    | 5, contando Vendas e Atendimento (constante fixa)        | [Oportunidades](crm-oportunidades-e-pipelines.md)                        |
| Formulários por empresa                  | 50 (20 seções e 100 itens cada; 30 alertas)              | [Formulários](crm-formularios.md)                                        |
| Validade do link de formulário           | padrão 7 dias, de 1 a 90                                 | [Formulários](crm-formularios.md)                                        |
| Importação                               | só `.xlsx`, até 10 MB e 5.000 linhas                     | [Busca e dados em massa](crm-busca-e-dados-em-massa.md)                  |
| Exportação                               | até 10.000 pessoas por arquivo, gerado na hora           | [Busca e dados em massa](crm-busca-e-dados-em-massa.md)                  |
| Edição em massa                          | 1 a 200 pessoas por pedido                               | [Busca e dados em massa](crm-busca-e-dados-em-massa.md)                  |
| Busca                                    | até 20 filtros; página padrão 50, máximo 200             | [Busca e dados em massa](crm-busca-e-dados-em-massa.md)                  |
| Lixeira                                  | 30 dias; purga diária às 3h de Brasília                  | [Histórico, arquivo e LGPD](crm-historico-arquivo-e-lgpd.md)             |
| Forecast                                 | até 24 meses; ação em massa de data prevista em até 200  | [Forecast](crm-forecast.md)                                              |
| Snapshot do forecast                     | semanal, segunda a partir das 6h locais                  | [Forecast](crm-forecast.md)                                              |
| Regras de obrigatoriedade                | 100 por empresa                                          | [Pessoas e campos](crm-pessoas-e-campos.md)                              |
| Score                                    | 100 regras, 10 condições por regra, 10 faixas            | [Qualidade e produtividade](crm-qualidade-e-produtividade.md)            |
| Distribuição                             | 50 regras, 30 grupos, 200 membros por grupo              | [Qualidade e produtividade](crm-qualidade-e-produtividade.md)            |
| Esfriando                                | 1 a 365 dias por status aberto (só do pipeline padrão)   | [Qualidade e produtividade](crm-qualidade-e-produtividade.md)            |
| Cache de CNPJ                            | 30 dias, global entre empresas                           | [Qualidade e produtividade](crm-qualidade-e-produtividade.md)            |
| Páginas públicas                         | 120 pedidos por minuto por IP; 30 por minuto por link    | [Plataforma](plataforma.md), [Formulários](crm-formularios.md)           |
| Sessão                                   | acesso de 15 minutos; renovação de 7 dias                | [Plataforma](plataforma.md)                                              |
| Cache de módulos e flags                 | 30 segundos                                              | [Plataforma](plataforma.md)                                              |
| Card do Kanban                           | 12 etiquetas, 100 itens de checklist, WIP até 10.000     | [Kanban](kanban.md)                                                      |
| Desempenho medido (20 mil oportunidades) | forecast p95 de 433 ms; quadro inteiro 602 ms (meta 500) | [Forecast](crm-forecast.md), [Quadro comercial](crm-quadro-comercial.md) |

## Não implementado e roadmap

| Item                                  | Estado hoje                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agendamento                           | Só esqueleto: módulo registrado sem rotas de negócio; tabelas na migration `0001` (`modulo_agendamento`). Visão no bloco 1.6.2 do [MASTER_DOCUMENT](../MASTER_DOCUMENT.md)                                                                                                                                                                |
| Pagamento in-chat                     | Só esqueleto e tabela na `0001` (`modulo_pagamento_inchat`)                                                                                                                                                                                                                                                                               |
| Verticais Estética capilar e Tatuagem | Só esqueleto e tabelas na `0001` (`modulo_estetica_capilar`, `modulo_tatuagem`)                                                                                                                                                                                                                                                           |
| Cobrança de assinatura e Wallet       | Só tabelas (`assinaturas`, `cobrancas`, `wallets` e afins), sem rotina. O status da empresa não muda o acesso. Plano anterior: gateway com Pix Automático, cartão e boleto, webhook assinado e idempotente, máquina de estados `trial` → `active` → `past_due` (graça) → `suspenso` (bloqueia) → `cancelado` e régua de cobrança por fila |
| Atendimento omnichannel e WhatsApp    | Não existe. Hoje o WhatsApp só aparece como "abrir no WhatsApp" com o link do formulário (o usuário envia) e como opção reservada de origem do registro                                                                                                                                                                                   |
| IA (assessor, shadow mode, autopilot) | Não existe; só no [MASTER_DOCUMENT](../MASTER_DOCUMENT.md)                                                                                                                                                                                                                                                                                |
| n8n                                   | Não existe; só no [MASTER_DOCUMENT](../MASTER_DOCUMENT.md)                                                                                                                                                                                                                                                                                |

## Pendências para piloto e produção

**Antes de ligar em cliente real**

- **Jurídico dos formulários:** revisar termo, fluxo de menor e política de exclusão antes de ligar `crm.formularios` em tenant real. A anonimização apaga **todos** os valores da resposta, o que conflita com a guarda de prontuário. Ver [Formulários](crm-formularios.md) e [Histórico, arquivo e LGPD](crm-historico-arquivo-e-lgpd.md).
- **Status da empresa não bloqueia login nem API.** O único efeito é a página pública de formulário sumir para empresa suspensa ou cancelada. Ver [Plataforma](plataforma.md).
- **Sem limite de tentativas em `/auth/login`.** Só `/public` tem rate limit. Ver [Plataforma](plataforma.md).
- **Regras dependem de `crm.regras`.** A regra "motivo da perda obrigatório em Perdido" e o erro `CAMPOS_OBRIGATORIOS` ao mover ou mudar status só valem com `crm.regras` ligada. Com a flag desligada, nenhuma regra vale, nem a do sistema. Ver [Oportunidades](crm-oportunidades-e-pipelines.md) e [Quadro comercial](crm-quadro-comercial.md).

**Infraestrutura e deploy**

- `trustProxy` não está ligado, e o limite por IP de `/public` depende dele.
- `worker:crm` e `worker:kanban` não estão no `compose.yaml` nem no CI. Sem o `worker:crm` não há importação, purga da lixeira, resumo de esfriando, enriquecimento automático por CNPJ nem snapshot do forecast. Sem o `worker:kanban` não há varredura de vínculos.
- `pnpm crm:reconcile` precisa rodar a cada deploy (semeia campos, listas, Vendas e Atendimento).
- O CI (`pr-checks.yml`) nunca rodou num PR.
- `REDIS_URL` e `FORMS_TOKEN_KEY` são necessários (o segundo, para gerar links de formulário).

**Desempenho e telas**

- Quadro comercial: abrir a tela inteira não fica abaixo de 500 ms no p95 contra o banco de dev (602 ms com 1 usuário e 1,6 s com 5, por causa da rede); uma coluna sozinha fica entre 371 e 455 ms. O próximo passo é medir na mesma região do banco. Ver [Quadro comercial](crm-quadro-comercial.md).
- Telas pendentes: aba Projetos (vínculo com pessoa), aviso de card fora do filtro (`saiuDoFiltro`) e medição de Core Web Vitals do quadro. Os marcos de Configurações (M1 a M16) não tiveram handoff dedicado: o back não confirma o estado dessas telas, e o plano registrava como pendente o front de vários deles. Não há tela de convite de usuários (só o script `create:user`).

## Principais ideias de expansão

> Sugestões para decidir, não decisões. Priorizadas pelas que aparecem em mais de um arquivo.

| Ideia                                                                                   | Por que importa                                                                                                    | Onde está detalhada                                                                                                                                                   |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bot e WhatsApp consumindo o outbox: envio automático de links, NPS e opt-out com efeito | Tira o envio manual e dá efeito à marca de opt-out; exige cursor do outbox por consumidor e limpeza do `crm_event` | [Formulários](crm-formularios.md), [Histórico](crm-historico-arquivo-e-lgpd.md), [Oportunidades](crm-oportunidades-e-pipelines.md), [Plataforma](plataforma.md)       |
| Permissões por ação e papéis novos (arquivar, excluir, atividades; papel gerente)       | Hoje qualquer papel arquiva, exclui e apaga atividade                                                              | [Pessoas e campos](crm-pessoas-e-campos.md), [Qualidade](crm-qualidade-e-produtividade.md), [Histórico](crm-historico-arquivo-e-lgpd.md), [Plataforma](plataforma.md) |
| Lista e export de oportunidades                                                         | Relatório da carteira de vendas, não só de pessoas                                                                 | [Busca e dados em massa](crm-busca-e-dados-em-massa.md), [Oportunidades](crm-oportunidades-e-pipelines.md)                                                            |
| Colunas do ciclo de vida no export, no card e na ordenação                              | A visão de cliente chega à planilha e ao quadro                                                                    | [Busca e dados em massa](crm-busca-e-dados-em-massa.md), [Oportunidades](crm-oportunidades-e-pipelines.md), [Quadro comercial](crm-quadro-comercial.md)               |
| Meta mensal e assertividade por pipeline                                                | Atingimento no forecast e saber qual funil prevê melhor                                                            | [Forecast](crm-forecast.md)                                                                                                                                           |
| Uploads: pergunta do tipo arquivo (FM7) e anexos no card                                | Receber exames, documentos e contratos; ambos dependem de armazenamento privado                                    | [Formulários](crm-formularios.md), [Kanban](kanban.md)                                                                                                                |
| D4 nos duplicados e no resumo de esfriando, e dias de esfriar por pipeline              | Fecha a brecha de citar pessoa de pipeline oculto e faz Atendimento esfriar                                        | [Qualidade](crm-qualidade-e-produtividade.md), [Oportunidades](crm-oportunidades-e-pipelines.md)                                                                      |
| Status da empresa limitando acesso e cobrança automática                                | Dá consequência real ao status; base para a cobrança de assinatura                                                 | [Plataforma](plataforma.md)                                                                                                                                           |
| Segunda venda (D6) e selo `+N`                                                          | Recompra sem card duplicado; mostrar que a pessoa tem vários negócios                                              | [Oportunidades](crm-oportunidades-e-pipelines.md), [Quadro comercial](crm-quadro-comercial.md)                                                                        |
| Score de engajamento e lembrete do próximo follow-up                                    | Separa lead quente de lead só com bom perfil; o vendedor não depende da memória                                    | [Qualidade e produtividade](crm-qualidade-e-produtividade.md)                                                                                                         |

## Glossário

| Termo              | Significado                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pessoa / lead      | O cadastro de contato do CRM. Na API se chama "lead"; nos documentos, "pessoa" e "lead" são a mesma coisa                                                           |
| Oportunidade       | A venda ou o atendimento de uma pessoa, com status, valor, previsão e responsável (`crm_deal`). Uma pessoa pode ter várias                                          |
| Principal          | A oportunidade cujos dados comerciais aparecem na pessoa. É calculada, nunca escolhida: a aberta mais recente em Vendas; senão a última ganha; senão a mais recente |
| Ciclo de vida      | Lead, Em negociação (na API, oportunidade) ou Cliente, calculado a cada leitura a partir das oportunidades que o papel vê                                           |
| Pipeline           | O funil: lista ordenada de status. Tipos Vendas e Atendimento; até 5 por empresa                                                                                    |
| Status e categoria | O status é a etapa do pipeline; a categoria (`aberto`, `ganho`, `perdido`) é o que as regras e relatórios usam, e por isso o nome do status pode mudar              |
| Flag               | Liga e desliga uma funcionalidade por empresa, para liberar aos poucos ou desligar rápido. Não é cobrança                                                           |
| Tenant             | A empresa cliente. Todos os dados de negócio são separados por tenant no banco (RLS)                                                                                |
| Outbox             | Tabela `crm_event`: cada mudança no CRM grava um evento, só com ids, na mesma transação. Hoje o único consumidor é o tempo real do quadro comercial                 |

## Como manter estes documentos

- Ao fechar um marco, atualize o arquivo da área: features, tabela de estado, regras e limites, "fica de fora" e a data no topo. Depois ajuste este resumo se mudou um estado, uma flag, um limite ou uma pendência.
- Descreva o que está no código, não o que foi planejado. O planejado vai em "Fica de fora" ou "Ideias de expansão".
- O contrato detalhado de cada rota vive no código, nos controllers (`controllers/*.controller.js`) e nos schemas Zod (`schemas/*.schema.js`). Estes documentos não copiam contratos.
- Links entre documentos são relativos. Referências que continuam válidas fora desta pasta: [MASTER_DOCUMENT](../MASTER_DOCUMENT.md), [Kanban implementado](../kanban-implementado.md), [Cards do Kanban](../kanban-cards.md) e [Padrão de código](../padrao-de-codigo.md).
