# Histórico, arquivo e LGPD

> Estado em 21/11/2026. Fonte: código do back (`src/modules/nucleo/crm/...`).

## O que é

Esta área responde a três perguntas do dia a dia e da lei: "o que aconteceu com este lead e quem fez?", "como tiro um lead da frente sem perdê-lo?" e "como atendo o pedido de um titular de dados?". O histórico registra cada mudança do lead com autor e data. O arquivo e a lixeira guardam leads (e oportunidades) fora da lista ativa, com prazo de 30 dias para restaurar. A parte de LGPD registra a base legal e a origem de cada cadastro, o opt-out de marketing e permite anonimizar uma pessoa sem perder as estatísticas.

## Features

### Histórico do lead

Cada mudança no lead vira um evento com o antes e o depois só dos campos que mudaram, o autor (o usuário do token, ou o sistema em jobs e no enriquecimento) e a data. O histórico é gravado sempre, com ou sem flag; a flag só libera a leitura.

- Tipos de evento: criado, atualizado, arquivado, desarquivado, excluído, restaurado, mesclado, enriquecido por CNPJ, anonimizado, formulário respondido e os cinco do ciclo da oportunidade (criada, arquivada, desarquivada, excluída, restaurada).
- O evento de criação guarda de onde veio o responsável quando houve distribuição automática (regra, rodízio ou sem responsável).
- O import também grava histórico, com quem importou como autor.
- O histórico é append-only: o banco barra qualquer alteração de conteúdo. As únicas exceções são o lead de origem mudar numa mesclagem, o autor virar vazio quando o usuário é removido e a anonimização.
- O rótulo, o tipo e as opções de cada campo vêm do cadastro atual na hora de ler. Renomear um campo não reescreve o passado.
- Na leitura, o diff respeita o papel: campo desligado, oculto para o papel, ou personalizado excluído some. Uma edição que só mexeu em campos que o papel não vê desaparece da lista e do total. O CNPJ consultado no enriquecimento só aparece para quem vê o campo CNPJ. Eventos de oportunidades de pipeline que o papel não vê também não aparecem.
- Responsável e campos do tipo usuário vêm com o nome (inclusive de usuário já inativo).
- Lista paginada, do mais novo para o mais antigo (50 por página por padrão, até 200).
- Atividades não entram no histórico; elas têm lista própria (ver [qualidade e produtividade](crm-qualidade-e-produtividade.md)).

### Timeline com filtro por categoria

Sobre o histórico, a timeline completa do detalhe do lead permite filtrar por categoria: Campos, Atribuições, Mesclagens, Enriquecimentos e Ciclo de vida. Um evento pode cair em mais de uma (uma edição que trocou o responsável é "Campos" e "Atribuições"). O filtro é feito no banco, então a paginação e o total batem.

- Ciclo de vida reúne criação, arquivar, desarquivar, excluir, restaurar, anonimizar e os eventos das oportunidades.
- Filtrar por categoria exige a flag `crm.timeline`; a leitura simples do histórico continua atrás de `crm.atividades`. A lista de categorias para o seletor também é da `crm.timeline`.

### Arquivar e desarquivar lead

Arquivar tira o lead da lista ativa sem apagar nada. O lead continua editável e aparece no filtro de situação "arquivados". Repetir a ação num lead já arquivado não suja o histórico.

- A lista padrão mostra só leads ativos; a situação é um filtro fixo da busca, do export e das views salvas (ativos, arquivados, lixeira).
- Arquivar revoga os links de formulário ainda ativos da pessoa; desarquivar não os traz de volta (é preciso gerar link novo). Pessoa arquivada não responde formulário.
- As oportunidades de uma pessoa arquivada saem do quadro comercial e do forecast.
- Com a flag `crm.arquivo` desligada, a lista "ativos" volta a incluir os arquivados: o kill switch nunca esconde lead.

### Lixeira e restauração do lead

"Excluir" sempre manda o lead para a lixeira, com ou sem a flag; sem a flag só não existe a tela para restaurar. A lixeira guarda o lead por 30 dias.

- Lead na lixeira some de toda leitura, busca, export e checagem de duplicidade. Detalhe e edição respondem "não encontrado". O export da lixeira é recusado.
- As oportunidades da pessoa vão para a lixeira junto e voltam junto, mas só as que foram excluídas no mesmo momento do lead; uma oportunidade excluída antes, à parte, continua na lixeira. Os links de formulário ativos são revogados.
- Restaurar devolve o lead como estava (um lead arquivado antes continua arquivado). Passados os 30 dias, o lead já conta como apagado, mesmo antes da purga.
- Lead descartado numa mesclagem não pode ser restaurado (conflito), porque seus dados e histórico já estão no outro lead.
- A resposta da exclusão informa a data em que o lead será apagado de vez.

### Purga automática da lixeira

Um job diário apaga de vez o que passou de 30 dias na lixeira. Roda às 3h no horário de Brasília e cobre todo tenant que já contratou o CRM, mesmo cancelado, porque é prazo de retenção. Falha num tenant não para os outros, e o resumo do job vai para o log do worker. As tabelas ligadas ao lead seguem as chaves estrangeiras: atividades, eventos e oportunidades são apagados junto, e outros vínculos são desligados.

### Arquivo e lixeira da oportunidade

Cada oportunidade tem arquivar, desarquivar, excluir e restaurar. Não há regra de negócio: o card sai do quadro e volta se restaurado, e não existe "excluir card" definitivo nem excluir um quadro que apague dados. A aba Oportunidades da ficha lista as excluídas pelo filtro de situação "lixeira".

- Cada ação grava um evento no histórico do lead e um evento para o quadro em tempo real.
- Uma oportunidade excluída não tem prazo nem job próprio: ela só é apagada de vez quando o lead dela é purgado.
- Se o lead está na lixeira, as ações sobre suas oportunidades dão "não encontrado"; se a pessoa foi anonimizada, não se mexe nas oportunidades dela (conflito).
- Qualquer papel pode executar essas ações.

### Base legal e origem do registro

Quatro campos do sistema registram a base da LGPD de cada lead: Base legal, Data da base legal, Origem do registro e Opt-out de marketing. A base legal é escolhida entre cinco valores fixos que vêm da lei (consentimento, legítimo interesse, execução de contrato, obrigação legal e outra), não de uma lista editável do tenant.

- A data da base legal, a origem e a data do opt-out são carimbadas pelo sistema e são só leitura: não entram no payload nem no mapeamento do import. Trocar a base legal renova a data; mandar a mesma de novo não mexe; limpar apaga as duas.
- Os carimbos valem sempre, com ou sem a flag: o cadastro feito à mão fica com origem "manual" e o import com "importação". As origens "formulário", "WhatsApp" e "API" existem como opção, mas nenhum fluxo do back as grava hoje. Leads antigos ficam sem origem.
- A flag `crm.lgpd` liga a configuração: o DONO define uma base legal padrão (aplicada só ao cadastro manual sem base informada) e se a base legal é obrigatória. A obrigatoriedade é a do próprio campo, que o formulário e o import já exigem.
- No import, um passo extra deixa escolher a base legal do lote, que vale nas linhas sem base própria e cobre o campo mesmo quando a coluna não é mapeada. Informar a base do lote exige a flag.
- Ao salvar a configuração, os campos LGPD são ligados no detalhe, na tabela e no filtro (e a Base legal também no formulário de criação). O DONO pode escondê-los depois em Configurações, Campos.

### Opt-out de marketing

O lead pode ser marcado como "não quero receber marketing" por um sim ou não no cadastro. Ligar grava a data; ligar de novo mantém a data da primeira vez; desligar apaga a data. Hoje é só um registro: nenhum envio de mensagem do CRM consulta essa marca, porque o CRM ainda não dispara campanhas.

### Anonimização (pedido do titular)

Atende o pedido de um titular de dados. É irreversível e só DONO e MASTER podem fazer. O lead permanece para as estatísticas (status, estágio, valor, origem, score, datas, responsável, cidade, UF e tags), mas sai tudo que identifica a pessoa.

- **Lead:** o nome vira "Lead anonimizado". Ficam vazios primeiro nome, e-mail, telefone, empresa, cargo, CPF, CNPJ, endereço e CEP. Dos campos personalizados, ficam só os de tipo que não identifica (número, monetário, data, booleano, seleção, seleção múltipla, usuário, intervalo de datas e hora) e que não foram marcados como sensíveis; os demais, e os de campos já excluídos, são apagados.
- **Atividades:** título genérico ("Atividade anonimizada") e notas apagadas; tipo e datas ficam.
- **Oportunidades:** perdem o título; status, valor e motivo de perda ficam.
- **Histórico:** o antes e o depois dos campos pessoais viram vazios, e o nome do lead mesclado e o CNPJ consultado somem dos detalhes. O evento, o autor e a data permanecem. Nasce um evento "anonimizado" só com contagens e uma linha na auditoria da plataforma, sem dado pessoal.
- **Quem mais é atingido:** os leads que foram mesclados nele, em cadeia (a mesma pessoa), e vale também para lead arquivado ou na lixeira.
- Depois de anonimizado, o lead fica travado: editar, mesclar ou mexer nas oportunidades dele dá conflito, e anonimizar de novo também. O score é recalculado, porque pode depender de campo apagado.
- A resposta devolve só as contagens (leads, atividades e eventos afetados).

### Efeitos da anonimização em formulários, Kanban e forecast

- **Formulários:** os links ativos da pessoa são revogados e não se gera link novo para ela. As respostas continuam na lista, com formulário, versão, datas e aceite, mas sem nenhum valor; o nome do responsável vira "Anonimizado" e IP e navegador são apagados. Os alertas gerados pelas respostas são apagados. Detalhes em [formulários](crm-formularios.md).
- **Kanban:** o card de projeto vinculado à pessoa passa a aparecer como "Registro restrito", sem nenhum dado, e a varredura diária do Kanban remove o vínculo. Um aviso `person.anonymized` é publicado para quem está com o quadro aberto. Ver [Kanban](kanban.md).
- **Quadro comercial:** o card de uma oportunidade de pessoa anonimizada continua existindo, mas não pode ser movido. Ver [quadro comercial](crm-quadro-comercial.md).
- **Forecast:** a oportunidade de pessoa anonimizada continua contando nos números (o valor e o status ficam). Já as de pessoa arquivada ou na lixeira saem. Ver [forecast](crm-forecast.md).

## Estado

| Feature                                         | Back    | Front                                                                                                            | Flag                                                              | Origem   |
| ----------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------- |
| Histórico do lead                               | pronto  | sem handoff (contrato no plano de Configurações)                                                                 | `crm.atividades` (leitura); gravação sempre ligada                | M6       |
| Timeline com filtro por categoria               | pronto  | sem handoff (contrato no plano de Configurações)                                                                 | `crm.timeline`                                                    | M16      |
| Arquivar e desarquivar lead                     | pronto  | sem handoff (contrato no plano de Configurações)                                                                 | `crm.arquivo`                                                     | M5       |
| Lixeira e restauração do lead                   | pronto  | sem handoff (contrato no plano de Configurações)                                                                 | `crm.arquivo` (restaurar); excluir sempre ligado                  | M5       |
| Purga automática da lixeira                     | pronto  | não se aplica (job)                                                                                              | sempre ligado                                                     | M5       |
| Arquivo e lixeira da oportunidade               | pronto  | handoff entregue (handoff do M3)                                                                                 | sempre ligado                                                     | P9       |
| Base legal e origem do registro                 | pronto  | sem handoff (contrato no plano de Configurações)                                                                 | `crm.lgpd` (configuração e base do lote); carimbos sempre ligados | M15      |
| Opt-out de marketing                            | parcial | sem handoff (contrato no plano de Configurações)                                                                 | sempre ligado                                                     | M15      |
| Anonimização                                    | pronto  | sem handoff (contrato no plano de Configurações)                                                                 | `crm.lgpd`                                                        | M15      |
| Efeitos da anonimização em formulários e outros | pronto  | handoff entregue para formulários (FM6); sem handoff para Kanban e forecast (contrato no plano de Configurações) | `crm.lgpd` e `crm.formularios`                                    | M15, FM6 |

Notas: no opt-out, "parcial" quer dizer que o registro existe mas nada o consome. Segundo o plano de Configurações, o front de M5, M15 e M16 estava pendente na data em que foi escrito; o back não confirma o estado das telas.

## Regras e limites

**Papéis**

- Anonimizar e salvar a configuração de LGPD: só DONO e MASTER (papel conferido antes da flag); ler a configuração: qualquer papel.
- Arquivar, desarquivar, excluir e restaurar lead, e as mesmas ações em oportunidades: qualquer papel. Não há restrição por papel hoje.
- Ler o histórico: qualquer papel, com o diff filtrado pelo que o papel vê.

**Histórico e timeline**

- Página padrão de 50 eventos, máximo de 200.
- Decisão do dono: o filtro é por categoria, e uma edição só de campos ocultos para o papel some do histórico, da lista e do total.
- O histórico é gravado sempre; a flag só controla a leitura.

**Arquivo e lixeira**

- Prazo da lixeira: 30 dias. Purga diária às 3h de Brasília.
- Sem `crm.arquivo`, "ativos" inclui os arquivados e as situações "arquivados" e "lixeira" são recusadas.
- Mesclado não restaura.

**LGPD**

- Bases legais fixas: consentimento, legítimo interesse, execução de contrato, obrigação legal e outra.
- Base padrão só vale no cadastro manual; a do lote só no import.
- Decisão do dono: a anonimização mantém o lead para estatística, apaga o que identifica e não pode ser desfeita.
- Decisão do dono: o registro de auditoria da plataforma continua protegido contra edição e exclusão direta, mas é apagado em cascata quando o tenant é excluído, para que um tenant que anonimizou alguém ainda possa ser removido.

**Pendências antes de produção**

- **Jurídico:** parar antes de ligar `crm.formularios` em tenant real, para fechar o termo, o fluxo de menor e a exclusão. A anonimização apaga todos os valores da resposta de formulário, o que conflita com a guarda de prontuário em quem precisa mantê-lo.
- Os workers `worker:crm` e `worker:kanban` não estão no `compose.yaml` nem no CI; sem o `worker:crm` a purga da lixeira não roda e o prazo de retenção não é aplicado.
- `REDIS_URL` é necessário para o worker, e `pnpm crm:reconcile` precisa rodar no deploy.

## Fica de fora

| Item                                                                              | Motivo                                                                             | Quando volta                           |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------- |
| Limpar dados pessoais do titular em outros módulos (atendimento, agendamento, IA) | A fronteira de módulo impede o CRM de mexer neles; precisa de um evento do core    | Sem data                               |
| Restrição por papel para arquivar, excluir e restaurar                            | Hoje qualquer papel pode; não foi tratado como regra                               | A decidir pelo dono                    |
| Gravar origem "formulário", "WhatsApp" e "API"                                    | Opções reservadas para canais que ainda não existem                                | Quando o canal existir                 |
| Envio de marketing respeitando o opt-out                                          | O CRM não dispara mensagens; envio em massa e automático faz parte do plano do bot | Com o plano do bot                     |
| Limpeza do histórico de eventos do outbox (`crm_event`)                           | Não existe rotina de limpeza                                                       | M7 (segunda etapa do Kanban), sem data |
| Anonimização parcial de respostas de formulário (guarda de prontuário)            | A anonimização apaga todos os valores da resposta                                  | Depende do parecer do jurídico         |
| Excluir oportunidade de vez                                                       | Decisão P9: só arquivar e lixeira; apagar só junto com a purga do lead             | Sem data                               |

## Ideias de expansão e refinamento

> Sugestões para decidir, não decisões.

| Ideia                                                                                           | Valor para o cliente                                             | Depende de                                             | Esforço (P/M/G) |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------ | --------------- |
| Anonimização seletiva das respostas de formulário (mantendo o que a guarda de prontuário exige) | Resolve o conflito com o prontuário em clínicas e áreas de saúde | Parecer do jurídico; regra de produto                  | M               |
| Evento do core para anonimizar o titular nos outros módulos                                     | Atende o pedido do titular na plataforma inteira, não só no CRM  | Contrato do core com os módulos                        | G               |
| Prazo de retenção da lixeira configurável por tenant                                            | Atende políticas diferentes de retenção                          | Decisão do dono; ajuste na purga                       | P               |
| Restringir por papel arquivar, excluir e restaurar                                              | Evita exclusões soltas por quem só deveria operar                | Decisão do dono sobre quais papéis podem o quê         | P               |
| Aviso antes da purga ("este lead será apagado em N dias")                                       | Reduz perda por esquecimento                                     | Notificações do core; job de aviso                     | M               |
| Aplicar o opt-out em envios (quando existir envio de campanha ou WhatsApp)                      | Dá efeito real à marca que hoje é só registro                    | Plano do bot / canal de envio                          | M               |
| Gravar origem "formulário" quando o formulário criar ou identificar a pessoa                    | Rastreia melhor de onde veio cada dado                           | Decisão de produto sobre formulários que criam pessoas | P               |
| Limpeza periódica do histórico de eventos do quadro (`crm_event`)                               | Evita crescimento sem limite da tabela                           | Definir prazo e política de retenção                   | P               |
| Exportar os dados de um titular (acesso e portabilidade)                                        | Atende o outro lado do pedido do titular, além de anonimizar     | Parecer do jurídico; decisão do dono                   | M               |

## Mapa técnico

**Rotas** (sob `/crm`; o contrato vive nos controllers e nos schemas Zod)

| Área                 | Rotas                                                                                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Histórico e timeline | `GET /crm/leads/:id/historico` (`?pagina`, `?tamanho`, `?categorias`), `GET /crm/historico/categorias`                                                                |
| Arquivo e lixeira    | `DELETE /crm/leads/:id` (lixeira), `POST /crm/leads/:id/arquivar`, `/desarquivar`, `/restaurar`; filtro `situacao` em `POST /crm/leads/search`, no export e nas views |
| Oportunidade         | `POST /crm/oportunidades/:id/arquivar`, `/desarquivar`, `/excluir`, `/restaurar`; `GET /crm/leads/:id/oportunidades?situacao=lixeira`                                 |
| LGPD                 | `GET` e `PUT /crm/configuracoes/lgpd`, `POST /crm/leads/:id/anonimizar`; `baseLegalLote` no passo de configuração do import                                           |

**Tabelas** (schema `modulo_crm`, com RLS): `leads` (colunas `archived_at`, `deleted_at`, `mesclado_em_id`, `legal_basis`, `legal_basis_at`, `origem_registro`, `marketing_opt_out_at`, `anonimizado_em`), `crm_lead_event` (histórico, com trigger append-only), `crm_deal` (`archived_at`, `deleted_at`), `crm_lgpd_config`, `crm_event` (outbox do quadro). Na plataforma: `audit_log` (auditoria da anonimização, append-only, apagada em cascata com o tenant).

**Flags:** `crm.arquivo`, `crm.atividades`, `crm.timeline`, `crm.lgpd`.

**Jobs:** fila `crm-manutencao`, job `purgar-lixeira` (cron `0 3 * * *`, fuso de Brasília), consumido pelo `pnpm worker:crm`.

**Services centrais:** `historico.service.js` (diff e leitura por papel), `adapters/crm-lead-events.repository.js` (eventos e filtro por categoria no SQL), `arquivo.service.js` (arquivar, lixeira, purga), `oportunidades.service.js` (situação da oportunidade), `lgpd.service.js` e `adapters/crm-lgpd.repository.js` (configuração, carimbos e anonimização numa transação, que liga uma variável de sessão para o trigger do histórico permitir a limpeza), `adapters/crm-form-ciclo.repository.js` (efeitos em formulários). Constantes em `constants/arquivo.js`, `constants/historico.js` e `constants/lgpd.js`.
