# Oportunidades e pipelines

> Estado em 21/11/2026. Fonte: código do back (`src/modules/nucleo/crm/`).

## O que é

A oportunidade é a venda (ou o atendimento) de uma pessoa: tem status, valor, previsão de fechamento, responsável e histórico. Uma pessoa pode ter várias oportunidades, cada uma em um pipeline. O pipeline é o funil: uma lista de status em ordem, que o dono edita. Todo negócio nasce com **Vendas** e **Atendimento**, e o dono pode criar outros, até 5 no total. O que a pessoa "é" para o negócio (lead, em negociação ou cliente) sai das oportunidades dela.

## Features

### Oportunidades da pessoa

Cada pessoa tem uma aba de oportunidades na ficha. Dá para criar, editar, mudar o status, arquivar, excluir (lixeira) e restaurar. Criar sem pipeline cai no padrão (Vendas) e, sem status, no primeiro status aberto. Tudo passa por um único service de escrita, o mesmo da ficha, da importação, da edição em massa e do quadro, então as regras são iguais em todo lugar.

- Campos: título (até 200 caracteres), valor, probabilidade própria, data prevista de fechamento, motivo da perda e responsável.
- Campo desligado ou oculto para o papel some da resposta (valor, probabilidade, status, etc.). Campo "só ver" no payload é 403.
- Editar exige a versão que a pessoa estava vendo (`expectedUpdatedAt`): versão antiga é 409, com o estado atual na resposta.
- Arquivar e excluir não têm regra de negócio: o card sai do quadro e volta se for restaurado. Não existe excluir de vez por aqui. Oportunidade arquivada ou excluída não aceita edição.
- Pessoa anonimizada não tem oportunidade editável.
- Os dados comerciais que o cadastro de pessoas sempre teve (status, valor, probabilidade, data prevista, motivo da perda, data de conversão) continuam aceitos e devolvidos por `/crm/leads`, mas moram na oportunidade principal.

### Oportunidade principal

A pessoa mostra, nas telas de lead, os dados comerciais da sua oportunidade principal. A principal é calculada, nunca escolhida: a aberta mais recente em um pipeline de Vendas; sem aberta, a última ganha; senão, a mais recente. Arquivada só é principal se não houver outra. Sem principal, os campos comerciais da pessoa vêm vazios, e a leitura nunca soma negócios diferentes.

### Ciclo de vida da pessoa

Lead, oportunidade (na tela, "Em negociação") ou cliente.

- Cliente: tem ao menos uma venda ganha em pipeline de Vendas (arquivada também conta).
- Em negociação: sem venda ganha, mas com oportunidade aberta e não arquivada, de qualquer pipeline.
- Lead: o resto.

A tabela de leads traz quatro colunas opcionais calculadas a cada leitura, sem gravar nada: ciclo de vida, "Cliente desde" (primeira venda ganha), "Última compra" (última venda ganha) e quantidade de oportunidades abertas. Há filtros por ciclo, por intervalo de datas das duas datas e por mínimo e máximo de abertas. Os filtros valem também em views salvas e no export. O cálculo só considera os pipelines que o papel enxerga. "Cliente desde" e "Última compra" seguem a permissão do campo "Data de conversão" (que nasce desligado): sem ela, as chaves nem vêm e os filtros dão 400.

### Pipelines

Configurações → Pipelines. Cada pipeline tem nome, tipo (Vendas ou Atendimento), ativo e visibilidade para o operador. Leitura para qualquer papel; escrita só da gestão.

- Limite de 5 por negócio, contando Vendas e Atendimento.
- O pipeline padrão (Vendas) não pode ser desativado nem excluído.
- Pipeline com oportunidades não pode ser excluído: desative. Desativar não mexe nas oportunidades que já estão nele, só impede criar novas.
- Pipeline que é origem da automação de outro não pode ser excluído.
- Pipeline novo de Vendas nasce com Novo, Ganho e Perdido. Atendimento nasce com Aguardando início, Em atendimento, Concluído e Cancelado.

### Status e categorias

Os status são por pipeline, cada um com nome, cor, ordem e uma categoria: `aberto`, `ganho` ou `perdido`. Regras e relatórios usam a categoria, não o nome, e por isso o dono pode renomear "Perdido". A chave do status é imutável. Status em uso é desativado, não excluído. O dono ainda pode reordenar, criar e editar status, e a probabilidade padrão de cada um (ver [Forecast](crm-forecast.md)).

### Mudar status, ganhar, perder e reabrir

São a mesma ação: quem decide é a categoria do status de destino.

- Ganhar grava a data do ganho; perder grava a data da perda e o motivo; reabrir limpa as duas.
- Trocar de um status de ganho para outro de ganho não troca a data do ganho.
- Mudar o status volta a probabilidade própria ao padrão do novo status, com aviso. Probabilidade enviada junto vence.
- Regras de obrigatoriedade (por exemplo, motivo no Perdido) são conferidas aqui com o status e o pipeline de destino. Falta de campo é 400 `CAMPOS_OBRIGATORIOS`, com a lista do que falta.
- Mover sem versão, ou com versão antiga, grava e devolve `conflito: true` ("a última gravação vence, com aviso"). Editar os dados, ao contrário, dá 409.

### Motivo da perda

O campo "Motivo da perda" nasce ligado em todo negócio, e a regra do sistema "motivo obrigatório em Perdido" vem junto. Se o dono desligar o campo, a regra some e o Perdido aceita oportunidade sem motivo. A regra só vale com `crm.regras` ligada.

### Atendimento automático

O pipeline de Atendimento pode nascer sozinho de uma venda ganha. O dono liga a automação e escolhe: de qual pipeline de Vendas vem, em qual status aberto o card nasce e quem assume (o responsável da pessoa, um usuário fixo ou ninguém). Repetir o ganho não duplica o card. Se o status escolhido foi desativado, vale o primeiro aberto do pipeline. Reabrir a venda marca os atendimentos que nasceram dela com "origem reaberta".

### Visibilidade por pipeline

O dono decide quais pipelines o OPERADOR enxerga; DONO e MASTER veem tudo. Vale em todo o CRM: quadro, tabela, ficha, busca, totais e forecast.

- A pessoa aparece para o operador se tiver ao menos uma oportunidade visível, ou nenhuma. Só com oportunidades ocultas, dá 404.
- Se a principal estiver oculta, os campos comerciais saem vazios. Editar campo comercial pela pessoa nesse caso dá 409; o contato continua editável.
- Ocultar o pipeline padrão faz o que o operador cria nele sumir para ele, se a pessoa não tiver outra oportunidade visível.

### Eventos para o tempo real

Toda mudança grava um evento no mesmo instante da mudança (outbox `crm_event`), só com ids e chaves de status, sem dado pessoal. Quem consome é o [quadro comercial](crm-quadro-comercial.md).

| Entidade   | Eventos                                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Deal       | `deal.created`, `updated`, `status_changed`, `won`, `lost`, `reopened`, `archived`, `unarchived`, `deleted`, `restored`                 |
| Pessoa     | `person.updated`, `archived`, `unarchived`, `merged`, `anonymized`                                                                      |
| Formulário | `form.link_created`, `link_revoked`, `submitted` (ver [Formulários](crm-formularios.md)), confirmados sem aviso pelo despacho do quadro |

## Estado

| Feature                           | Back   | Front            | Flag                   | Origem   |
| --------------------------------- | ------ | ---------------- | ---------------------- | -------- |
| Oportunidades da pessoa           | pronto | handoff entregue | sempre ligado          | M2.5     |
| Oportunidade principal            | pronto | handoff entregue | sempre ligado          | M2.5     |
| Ciclo de vida e colunas do ciclo  | pronto | handoff entregue | sempre ligado          | FC4      |
| Pipelines (CRUD e limite)         | pronto | handoff entregue | sempre ligado          | M2.5     |
| Status e categorias por pipeline  | pronto | handoff entregue | sempre ligado          | M2.5     |
| Mudar status, ganhar, perder      | pronto | handoff entregue | sempre ligado          | M2.5     |
| Motivo da perda ligado por padrão | pronto | handoff entregue | `crm.regras` (a regra) | P0       |
| Atendimento automático            | pronto | handoff entregue | sempre ligado          | M2.5     |
| Visibilidade por pipeline         | pronto | handoff entregue | sempre ligado          | M3       |
| Eventos (outbox)                  | pronto | não se aplica    | sempre ligado          | M2.5, M5 |

## Regras e limites

**Pipelines**

- Máximo de 5 por negócio (Vendas e Atendimento incluídos). A constante é fixa no código, com a nota de que "vai mudar".
- Só DONO e MASTER criam, editam e excluem pipelines e status. Todos os papéis leem (a ficha precisa deles).
- Cada pipeline tem de manter ao menos um status ativo nas categorias aberto, ganho e perdido (regra das listas, valendo por pipeline). Status com oportunidades não muda de categoria até elas serem movidas.
- Automação só existe em pipeline do tipo Atendimento. Para ligá-la: origem de Vendas ativa, status inicial aberto e ativo, e, com usuário fixo, um usuário ativo.

**Oportunidade**

- Valor entre zero e 999.999.999.999,99.
- Probabilidade própria: inteiro de 0 a 100. Vazia significa "usar a do status".
- A data de conversão só vale para oportunidade ganha; limpá-la não apaga o ganho (isso é reabrir).
- Concorrência por `expectedUpdatedAt`, sem coluna de versão. Obrigatório na edição, opcional no mover.
- Arquivar, desarquivar, excluir e restaurar valem para qualquer papel que veja a oportunidade (não há restrição por papel).

**Ciclo de vida**

- Calculado na leitura: o ciclo gravado na pessoa (`lifecycle_stage`) existe, mas as colunas da tabela não o usam, porque com pipeline oculto ele revelaria uma venda escondida.
- Os rótulos do ciclo são fixos no código.

**Motivo da perda**

- Decisão do dono (P0): ligado de fábrica, inclusive nos negócios que já existiam.

## Fica de fora

| Item                                                               | Motivo                                                           | Quando volta                        |
| ------------------------------------------------------------------ | ---------------------------------------------------------------- | ----------------------------------- |
| Segunda venda (D6): juntar ao card de pós-venda ou criar outro     | Depende de decisão de produto                                    | Depois do M5, sem data              |
| Lista e export de oportunidades                                    | Só existe lista e export de pessoas                              | Sem marco                           |
| Campos personalizados na oportunidade (`custom_fields`, `entity`)  | Os campos personalizados são da pessoa                           | Sem marco                           |
| Campo por pipeline                                                 | O conjunto de campos é único para o CRM                          | Sem marco                           |
| Rótulos do ciclo de vida configuráveis                             | Fixos no código                                                  | Sem marco                           |
| Ordenar pelas colunas do ciclo                                     | Só filtro                                                        | Sem marco                           |
| Colunas do ciclo nos cards do quadro e no export                   | Só existem na tabela de leads                                    | Sem marco                           |
| Evento `person.lifecycle_changed`                                  | Não foi preciso: as colunas são calculadas na leitura            | Sem marco                           |
| Contadores guardados na pessoa                                     | Substituídos pelo cálculo na leitura                             | Sem marco                           |
| Restrição por papel de arquivar e excluir                          | Hoje qualquer papel faz                                          | Sem marco                           |
| Limpeza do `crm_event` (eventos processados)                       | A tabela só cresce                                               | Marco M7 do Kanban                  |
| Cursor do outbox por consumidor                                    | Um único consumidor (o quadro)                                   | Quando houver um segundo consumidor |
| D4 em `POST /crm/leads/duplicados` e no resumo diário de esfriando | Limitação assumida; os dias de esfriar vêm só do pipeline padrão | Sem marco                           |

## Ideias de expansão e refinamento

> Sugestões para decidir, não decisões.

| Ideia                                                  | Valor para o cliente                                        | Depende de                         | Esforço (P/M/G) |
| ------------------------------------------------------ | ----------------------------------------------------------- | ---------------------------------- | --------------- |
| Segunda venda: avisar "nova venda: juntar ou separar?" | Evita card duplicado de pós-venda na recompra               | Decisão do dono sobre o fluxo      | M               |
| Lista e export de oportunidades                        | Relatório de vendas sem passar pela pessoa                  | Nada técnico                       | M               |
| Ordenar a tabela pelas colunas do ciclo                | Achar "cliente mais antigo" ou "última compra mais recente" | Índice ou cálculo em ordem         | M               |
| Colunas do ciclo no card e no export                   | Mesma visão na tabela, no quadro e na planilha              | Nada técnico                       | P               |
| Rótulos do ciclo editáveis                             | Vocabulário do negócio ("Paciente", "Aluno")                | Lista configurável                 | P               |
| Campos próprios por pipeline                           | Atendimento pede dados que a venda não pede                 | Modelo de campos por entidade      | G               |
| Subir o limite de 5 pipelines                          | Negócios com mais de duas esteiras                          | Teste de carga do quadro           | P               |
| D4 também nos duplicados e no resumo de esfriando      | Sem vazar pessoa de pipeline oculto                         | Ajuste de consulta                 | P               |
| Dias de esfriar por pipeline                           | Hoje valem só os do padrão                                  | Mudar a leitura do resumo          | M               |
| Restringir arquivar e excluir por papel                | Operador não esconde negócio por engano                     | Decisão do dono sobre quais papéis | P               |
| Limpeza do `crm_event`                                 | Tabela não cresce sem fim                                   | Job de manutenção                  | P               |

## Mapa técnico

**Rotas**

| Método e caminho                                                                                            | Uso                                                     |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `GET`, `POST /crm/leads/:id/oportunidades`                                                                  | Listar (`?situacao=lixeira`) e criar                    |
| `PUT /crm/oportunidades/:id`                                                                                | Editar dados                                            |
| `PATCH /crm/oportunidades/:id/status`                                                                       | Mudar status, ganhar, perder, reabrir                   |
| `POST /crm/oportunidades/:id/arquivar`, `desarquivar`, `excluir`, `restaurar`                               | Situação                                                |
| `GET`, `POST /crm/configuracoes/pipelines`                                                                  | Listar e criar pipelines                                |
| `PUT`, `DELETE /crm/configuracoes/pipelines/:id`                                                            | Editar (nome, ativo, visibilidade, automação) e excluir |
| `POST /crm/configuracoes/pipelines/:id/status`, `PUT .../status/ordem`, `PUT`, `DELETE .../status/:opcaoId` | Status do pipeline                                      |

Contratos (corpos e respostas) vivem no código: `controllers/oportunidades.controller.js`, `controllers/pipelines.controller.js` e os schemas Zod em `schemas/oportunidades.schema.js` e `schemas/pipelines.schema.js`.

**Tabelas** (schema `modulo_crm`): `crm_pipeline` (migrations 0036 e 0040), `crm_deal` (0037), `crm_event` (0037), `crm_option` com `kind = 'status'` e `pipeline_id` (0038), `leads.principal_deal_id` e `leads.lifecycle_stage` (0037). O modelo comercial antigo foi apagado na 0039.

**Flags**: nenhuma própria. O motivo da perda depende de `crm.regras`.

**Services centrais**: `oportunidades.service.js` (única porta de escrita), `oportunidade-transicao.service.js` (regras puras de status), `pipelines.service.js`, `visibilidade-pipeline.service.js` (D4). Adapters: `crm-oportunidades.repository.js` (transação com oportunidade, pessoa, histórico e outbox; recalcula principal e ciclo), `crm-lead-read-model.js` e `crm-lead-ciclo.sql.js`.

**Como a leitura do lead usa a principal** (regras de `crm-lead-read-model.js`, `FONTE_LEADS`):

- O contato vem de `leads`. O contexto comercial vem só da oportunidade principal (`leads.principal_deal_id`), com os nomes que a API sempre usou.
- Mapa dos campos: `valor` = `amount`; `status` = `status`; `funil_estagio_id` e `estagio_nome` = id e rótulo da opção de status do pipeline da oportunidade; `data_conversao` = `won_at`; `probabilidade_fechamento` = `probability_override`; `data_prevista_fechamento` = `expected_close_date`; `motivo_perda` = `lost_reason`.
- Sem principal, tudo isso é nulo. A leitura não escolhe uma oportunidade arbitrária nem soma valores de negócios diferentes.
- Lead na lixeira continua mostrando a principal, que foi para a lixeira junto com ele (o join não filtra `deleted_at`).
- Os joins exigem o mesmo tenant, o vínculo ao contato e o mesmo pipeline para resolver o status (a mesma chave pode existir em quadros diferentes).
- Contagem, paginação e filtros usam a mesma fonte; a lista segue a data de criação, e o id desempata para estabilizar páginas.
- Com pipeline oculto para o papel (D4), `fonteLeadsVisivel(ocultos)` devolve os campos comerciais nulos já na leitura, e `condicaoPessoaVisivel` decide se a pessoa aparece.
- A inatividade (lead esfriando) resolve o status levando em conta o pipeline.
- Listas de status e de motivos de perda contam usos em todas as oportunidades do tenant, inclusive as não principais, para proteger contra excluir opção em uso.
- Toda escrita comercial passa pelo service único de oportunidade, inclusive a que chega por `/crm/leads`. Campos comerciais não voltam a ser colunas do contato.
- No quadro e no forecast a leitura é diferente de propósito: lê a própria oportunidade, não a principal.

Operação: `pnpm crm:reconcile` cria Vendas e Atendimento, o campo Valor e demais itens de base, e precisa rodar no deploy. Ver [Quadro comercial](crm-quadro-comercial.md) para o que consome os eventos, e [Forecast](crm-forecast.md) para probabilidade.
