# Kanban Universal

> Estado em 21/11/2026. Fonte: código do back (`src/modules/nucleo/kanban-universal/`). O Kanban é mantido por outro desenvolvedor: este documento só descreve o que existe. As ideias de expansão vêm da lista de evolução em [Cards do Kanban](../kanban-cards.md) e dependem de decisão do dono do Kanban.

## O que é

O Kanban Universal é o módulo de quadros de trabalho da plataforma: colunas, cards, equipe e comentários, com atualização ao vivo para quem está com o quadro aberto. Serve para projetos e tarefas da própria empresa (quadros nativos) e também mostra, no mesmo formato, registros de outros módulos, como as oportunidades do CRM (quadros de entidade). O dono e a equipe de gestão montam os quadros e definem quem participa; cada participante trabalha nos cards conforme o papel que recebeu no quadro (editor ou leitor). A empresa precisa ter o módulo `kanban_universal` contratado.

## Features

### Quadros e galeria

A entrada do módulo é uma galeria dos quadros que o usuário pode ver, com busca por nome e o número de participantes. Abrir um quadro leva à área de trabalho; criar, editar, excluir e escolher a equipe fica na tela de gestão, só para DONO e MASTER.

- O nome do quadro aceita até 200 caracteres.
- O tipo do quadro é só um identificador (`projetos` ou `postagens_agencia`); não importa dados nem cria cards.
- Excluir um quadro apaga seus cards e comentários, depois de confirmação na tela.
- Gestão (DONO e MASTER) vê todos os quadros da empresa; operador só vê os quadros dos quais participa.

### Modelos iniciais de quadro

Ao criar, a gestão escolhe um modelo com as colunas já prontas: Básico, Projetos, Comercial, Conteúdo, Atendimento ou Em branco. O modelo é só um ponto de partida: as colunas podem ser mudadas depois.

- Até 10 colunas iniciais, cada nome com até 200 caracteres.
- Quadro, equipe e colunas são gravados juntos: se algo falhar, nada é criado.
- Não existe duplicar um quadro existente.

### Equipe e permissões do quadro

Cada quadro tem uma equipe de participantes, escolhida entre os usuários ativos da empresa. Cada participante é editor (padrão) ou leitor.

- Leitor consulta, mas não cria, edita, move, arquiva, comenta nem exclui.
- Só participantes ativos podem receber responsabilidade por um card; ao remover alguém, as atribuições dele no quadro são limpas.
- Quadro com equipe vazia fica acessível só à gestão.
- Usuário novo na empresa não entra sozinho nos quadros existentes.
- A seleção de equipe grande tem busca sem acento, filtros (todos, selecionados, disponíveis) e páginas de 20 pessoas.

### Colunas e limite de trabalho (WIP)

A gestão cria, renomeia, reordena e remove colunas. Cada coluna pode ter um limite de cards em andamento (número inteiro positivo, até 10.000).

- Atingir ou passar do limite mostra aviso; não bloqueia mover nem criar.
- Coluna com cards (inclusive arquivados) não pode ser removida.

### Cards

O card guarda título e descrição, e a área de trabalho mostra uma versão compacta.

- Título até 200 caracteres; descrição até 20.000.
- Prioridade: sem prioridade, baixa, média, alta e urgente.
- Prazo por data, sem conversão de fuso, com indicação de atraso, vencimento hoje e entrega concluída. A conclusão é marcada à mão, não depende do nome da coluna.
- Etiquetas: nome (até 30 caracteres) e uma de seis cores, até 12 por card.
- Checklist: até 100 itens, com progresso.
- Um responsável por card.
- Excluir card é permitido a qualquer participante editor.

### Movimentação e edição simultânea

Mover card entre colunas (arrastando, pelos botões Subir e Descer ou pelo seletor de etapa) reordena origem e destino de uma vez. Escritas no mesmo quadro são serializadas, então dois movimentos ao mesmo tempo não corrompem a ordem; quadros diferentes não disputam entre si.

- Movimento com versão antiga volta `conflito: true` e vale o último a gravar.
- Edição de conteúdo com versão antiga (`expectedUpdatedAt`) é recusada com 409. A tela avisa e permite carregar a versão atual. Cliente que não manda a versão mantém o comportamento antigo.
- Arrastar manda o card para o fim da coluna; a posição exata vem dos botões.

### Busca e filtros

A barra do quadro tem busca em título, descrição e etiquetas, e filtros por prioridade, responsável e prazo, com atalhos Meus cards, Atrasados e Prioridade alta.

- Até 10 filtros personalizados por usuário e quadro, guardados só no navegador (não sincronizam entre dispositivos).
- Com filtro ativo o arraste fica desligado.

### Comentários e menções

Comentários ficam num bloco separado do card, com até 10.000 caracteres. Quem comenta pode mencionar participantes do quadro.

- O comentário só pode ser excluído por quem o escreveu; DONO e MASTER moderam.
- Menção gera e-mail para participante ativo da mesma empresa, exceto o autor.

### Histórico do card

Cada card tem uma linha do tempo das últimas 100 atividades: criação, mudança de conteúdo, movimentação, entrega concluída, comentários, arquivo, restauração e vínculo, com autor e horário. Começa na data da implantação e não é uma trilha de auditoria regulatória.

### Arquivar e restaurar

Arquivar tira o card do quadro sem apagar dados nem comentários. Restaurar devolve o card ao fim da coluna original. Há uma lista de arquivados por quadro. Não existe prazo de retenção: o arquivo não é apagado sozinho.

### E-mails de aviso

O sistema avisa por e-mail em três casos: atribuição (ao novo responsável, se não for o autor), menção em comentário e prazo do dia (um lembrete ao responsável, ignorando card arquivado ou entrega concluída).

- Cada usuário liga ou desliga os próprios e-mails (padrão: ligado).
- Os avisos entram numa fila na mesma gravação e saem depois, sem atrasar nem desfazer a ação se o e-mail falhar.
- Até 5 tentativas, com espera crescente de 5 minutos por tentativa; depois disso o aviso fica marcado como falho.
- O e-mail pode, em raros casos, chegar repetido (limite do SMTP).
- Fuso do lembrete de prazo: o da empresa.
- Sem SMTP e sem `FRONTEND_URL` configurados, o envio não acontece e o servidor só registra um aviso no log.

### Tempo real

Quem está com o quadro aberto vê as mudanças sem recarregar. O servidor avisa que algo mudou e a tela busca o conteúdo atual com as permissões de quem está vendo.

- A mesma conexão acompanha galeria, gestão e quadro aberto.
- Quem perde o acesso ao quadro tem o quadro fechado na hora.
- Ao cair a conexão, a tela mostra "Reconectando…" e relê tudo ao voltar. O banco é a fonte da verdade; os eventos não são histórico.
- Exige Redis. Sem Redis o servidor não sobe fora de testes.

### Quadros de entidade (flag `kanban_universal.quadros_entidade`)

Com a flag ligada, outros módulos publicam quadros no Kanban. Hoje o CRM publica o quadro de oportunidades por pipeline (tipo `crm_oportunidades`); veja [Oportunidades e pipelines](crm-oportunidades-e-pipelines.md) e [Quadro comercial](crm-quadro-comercial.md). Esses quadros não têm equipe nem linha própria: quem pode abrir e o que vê é regra do módulo dono.

- Colunas, resumo (total e soma), busca paginada por cursor, busca por ids, criar card na coluna, ações permitidas por card e mover.
- O Kanban só confere se a ação é permitida e repassa; as regras (campos obrigatórios, valores) ficam no módulo dono.
- Mudanças chegam ao vivo para quem está com o quadro aberto, com no máximo cerca de 1 segundo de atraso (despacho por lotes).
- Busca limitada a 100 itens por página (50 por padrão).

### Vínculo de card de projeto com uma pessoa do CRM (flag `kanban_universal.vinculo_entidade`)

Um card de projeto pode apontar para uma pessoa do CRM, somente para leitura. O card guarda só o tipo e o código; o nome vem do CRM a cada leitura, com as permissões de quem lê.

- Quem pode editar o quadro vincula e desvincula; o histórico registra o vínculo sem o código da pessoa.
- A ficha da pessoa tem a aba Projetos, com os cards ativos dos quadros que o usuário vê (até 100).
- Uma varredura diária às 2h de Brasília remove o vínculo de pessoa anonimizada ou apagada e aponta pessoa mesclada para a principal. Sem o `worker:kanban` rodando, o nome some na leitura mas a referência fica.

## Estado

| Feature                     | Back   | Front                                              | Flag                                   | Origem       |
| --------------------------- | ------ | -------------------------------------------------- | -------------------------------------- | ------------ |
| Quadros e galeria           | pronto | sem handoff (documentado em kanban-implementado)   | sempre ligado                          | Kanban base  |
| Modelos iniciais            | pronto | sem handoff (documentado em kanban-implementado)   | sempre ligado                          | Kanban base  |
| Equipe e permissões         | pronto | sem handoff (documentado em kanban-implementado)   | sempre ligado                          | Kanban base  |
| Colunas e WIP               | pronto | sem handoff (documentado em kanban-implementado)   | sempre ligado                          | Kanban base  |
| Cards                       | pronto | sem handoff (documentado em kanban-cards)          | sempre ligado                          | Kanban cards |
| Movimentação e concorrência | pronto | sem handoff (documentado em kanban-implementado)   | sempre ligado                          | Kanban base  |
| Busca e filtros             | pronto | sem handoff (documentado em kanban-implementado)   | sempre ligado                          | Kanban base  |
| Comentários e menções       | pronto | sem handoff (documentado em kanban-implementado)   | sempre ligado                          | Kanban base  |
| Histórico do card           | pronto | sem handoff (documentado em kanban-implementado)   | sempre ligado                          | Kanban base  |
| Arquivar e restaurar        | pronto | sem handoff (documentado em kanban-implementado)   | sempre ligado                          | Kanban base  |
| E-mails de aviso            | pronto | sem handoff (documentado em kanban-implementado)   | sempre ligado (`KANBAN_EMAIL_ENABLED`) | Kanban base  |
| Tempo real                  | pronto | sem handoff (documentado em kanban-implementado)   | sempre ligado                          | Kanban base  |
| Quadros de entidade         | pronto | handoff entregue (M3 a M5, consomem este contrato) | `kanban_universal.quadros_entidade`    | M2           |
| Vínculo com pessoa          | pronto | tela pendente (aba Projetos; sem handoff)          | `kanban_universal.vinculo_entidade`    | M6           |

## Regras e limites

**Papéis**

- Gerir quadros e colunas (criar, editar, excluir, equipe, colunas): só DONO e MASTER.
- Operador: consulta e trabalha nos cards dos quadros de que participa, conforme editor ou leitor. Excluir comentário: só o próprio; gestão modera.
- DONO e MASTER acessam todos os quadros da própria empresa.
- Os papéis de editor e leitor valem por quadro e só para participantes.

**Limites**

| Item                         | Limite                           |
| ---------------------------- | -------------------------------- |
| Nome de quadro, coluna       | 200 caracteres                   |
| Título do card               | 200 caracteres                   |
| Descrição do card            | 20.000 caracteres                |
| Comentário                   | 10.000 caracteres                |
| Etiquetas por card           | 12 (nome até 30 caracteres)      |
| Itens de checklist           | 100                              |
| Colunas iniciais (modelo)    | 10                               |
| WIP por coluna               | 1 a 10.000                       |
| Atividades exibidas          | 100 por card                     |
| Cards na aba Projetos        | 100                              |
| Página de quadro de entidade | 100 (padrão 50)                  |
| E-mails: tentativas          | 5, espera de 5 minutos crescente |
| Mensagem de tempo real       | 16 KB                            |

**Decisões do dono do Kanban**

- WIP avisa e não bloqueia.
- Entrega concluída é manual, independente da coluna.
- Em movimento com versão antiga vale o último a gravar; em edição de conteúdo, a versão antiga é recusada.
- Filtros salvos ficam só no navegador.
- Sem long polling: só WebSocket.

## Fica de fora

| Item                                                | Motivo                                                               | Quando volta                        |
| --------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------- |
| Anexos e links em card                              | Depende de armazenamento privado e autorização de download           | Decisão do dono do Kanban           |
| Catálogo de etiquetas do quadro                     | Hoje a etiqueta é por card, sem lista reutilizável                   | Decisão do dono do Kanban           |
| Duplicar quadro ou card                             | Só modelos de colunas na criação                                     | Decisão do dono do Kanban           |
| Mais de um participante por card, seguidores        | Hoje há um responsável                                               | Decisão do dono do Kanban           |
| Campos personalizados no card                       | Não existe definição de campos no Kanban                             | Decisão do dono do Kanban           |
| Checklist com responsável e prazo por item          | Itens são só título e conclusão                                      | Decisão do dono do Kanban           |
| Calendário e visualização em lista                  | Só a visão de quadro                                                 | Decisão do dono do Kanban           |
| Automações, dependências e bloqueios                | Não existem                                                          | Decisão do dono do Kanban           |
| Métricas de tempo de ciclo                          | O histórico é de 100 atividades, não um registro durável de métricas | Decisão do dono do Kanban           |
| Importar leads para quadros por tipo                | O tipo do quadro é só identificador; os leads vivem no CRM           | Resolvido pelos quadros de entidade |
| Editar colunas e excluir card em quadro de entidade | O contrato do provedor não tem essas operações                       | Sem data                            |
| Filtros salvos sincronizados entre dispositivos     | Ficam no navegador                                                   | Decisão do dono do Kanban           |
| Trilha de auditoria imutável                        | Histórico não é registro regulatório                                 | Sem data                            |

## Ideias de expansão e refinamento

> Sugestões para decidir, não decisões. Todas as ideias da lista de evolução de `kanban-cards.md` são decisão do dono do Kanban. Itens 1, 3, 4 e a parte de limites do item 13 dessa lista já existem; o que sobra está abaixo.

| Ideia                                                      | Valor para o cliente                                       | Depende de                                            | Esforço (P/M/G) |
| ---------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------- | --------------- |
| Anexos e links (item 2)                                    | Reunir contratos e briefings no card                       | Armazenamento privado, autorização, limites de upload | G               |
| Catálogo de etiquetas do quadro (item 5)                   | Padronizar nomes e cores e filtrar por categoria           | Tabela de etiquetas e associação com cards            | M               |
| Duplicar card e quadro, modelos por quadro (item 6)        | Padronizar onboarding e entregas recorrentes               | Cópia controlada e reinício de datas                  | M               |
| Vários participantes e seguidores (item 7)                 | Separar responsável principal dos colaboradores            | Associação de usuários e regras de aviso              | M               |
| Campos personalizados (item 8)                             | Registrar valor, origem ou SLA no card                     | Definição, validação e índices de consulta            | G               |
| Checklist avançado (item 9)                                | Responsável e prazo por item                               | Modelo próprio de itens, permissões, lembretes        | M               |
| Calendário e lista (item 10)                               | Planejar entregas por data                                 | Consultas paginadas com filtros compartilhados        | M               |
| Automações (item 11)                                       | Ao mudar de etapa, atribuir pessoa ou definir prazo        | Motor de regras sem ciclos, execução idempotente      | G               |
| Dependências e bloqueios (item 12)                         | Ver tarefas impedidas por outra entrega                    | Relação entre cards e validação de ciclos             | M               |
| Métricas de tempo de ciclo (item 13)                       | Medir quanto tempo o card passa em cada etapa              | Histórico durável de movimentações                    | M               |
| Filtros salvos por usuário no servidor                     | Mesmos filtros em qualquer dispositivo                     | Tabela de filtros por usuário e quadro                | P               |
| Mover o envio de e-mails para o worker                     | Envio não depende do servidor HTTP e do cronômetro interno | `worker:kanban` no deploy                             | M               |
| Medir e reduzir a latência da abertura do quadro comercial | Fechar o aceite de desempenho do quadro de oportunidades   | Ver [Quadro comercial](crm-quadro-comercial.md)       | M               |

## Pendências para produção

- `worker:kanban` não está no `compose.yaml` nem no CI; a varredura de vínculos precisa estar no deploy.
- `REDIS_URL` é obrigatório (tempo real); `SMTP_*` e `FRONTEND_URL` são necessários para os e-mails.
- Migrations antigas do Kanban (`0008_kanban_integrity`) falham se houver referências inconsistentes; faça backup e corrija antes de aplicar.
- Quadro comercial: abrir a tela inteira não fica abaixo de 500 ms no p95 contra o banco de dev (602 ms com 1 usuário, 1,6 s com 5, por causa da rede); uma coluna sozinha fica entre 371 e 455 ms. Detalhes em [Quadro comercial](crm-quadro-comercial.md).

## Divergências entre a documentação antiga e o código

- Os e-mails do Kanban rodam dentro do servidor HTTP (um cronômetro de 60 segundos), não em `worker:kanban`, que só faz a varredura de vínculos. A documentação antiga os descrevia como worker.
- A serialização de escritas é por quadro (trava no código por `board_id`), e não por empresa como diz a documentação antiga.
- O tipo `crm_leads` citado na documentação antiga não existe: hoje só `projetos` e `postagens_agencia` são tipos de quadro nativo.

## Mapa técnico

**Rotas principais** (todas exigem login e o módulo `kanban_universal`)

| Área                | Rotas                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Quadros e equipe    | `GET` e `POST /kanban/boards`, `GET`, `PATCH` e `DELETE /kanban/boards/:id`, `GET` e `PUT /kanban/boards/:id/membros`, `GET /kanban/membros`                                               |
| Colunas             | `POST /kanban/boards/:id/colunas`, reordenar em `/kanban/boards/:id/colunas/reordenar`, `PATCH` e `DELETE /kanban/colunas/:id`                                                             |
| Cards               | `GET` e `POST /kanban/boards/:id/cards`, `GET`, `PATCH` e `DELETE /kanban/cards/:id`, `PATCH /kanban/cards/:id/mover`                                                                      |
| Arquivo e histórico | `PATCH /kanban/cards/:id/arquivar` e `/restaurar`, `GET /kanban/boards/:id/arquivados`, `GET /kanban/cards/:id/activities`                                                                 |
| Comentários         | `GET` e `POST /kanban/cards/:id/comments`, `DELETE /kanban/comments/:id`                                                                                                                   |
| E-mails             | `GET` e `PUT /kanban/email-preferences`                                                                                                                                                    |
| Quadros de entidade | `/kanban/quadros/:boardType/:quadroRef/` com `colunas`, `resumo`, `cards/busca`, `cards/por-ids`, `cards`, `cards/:entidadeId/acoes` e `cards/:entidadeId/mover` (flag `quadros_entidade`) |
| Vínculo             | `PUT` e `DELETE /kanban/cards/:id/vinculo`, `GET /kanban/vinculos` (flag `vinculo_entidade`)                                                                                               |
| Tempo real          | Socket.IO em `/socket.io`, namespace `/kanban`; eventos `kanban:watch`, `kanban:unwatch`, `kanban:changed`, `kanban:access-revoked`, `kanban:session-expired`                              |

O contrato (campos e erros) vive nos controllers e nos schemas Zod em `src/modules/nucleo/kanban-universal/`. Detalhes de uso em [Kanban Universal](../kanban-implementado.md) e [Cards do Kanban](../kanban-cards.md).

**Tabelas:** schema `modulo_kanban_universal` (boards, colunas, cards, comentários, membros do quadro, atividades, `email_preferences`, `email_outbox`, vínculo de entidade no card). Os dados comuns do card ficam no JSON `dados_extras` do card. Todas com RLS.

**Flags:** `kanban_universal.quadros_entidade`, `kanban_universal.vinculo_entidade`.

**Jobs:** `worker:kanban` (fila `kanban-manutencao`, cron `0 2 * * *`, fuso de Brasília, varredura de vínculos); envio de e-mails em processo no servidor HTTP (a cada 60 segundos, lotes de 10, reserva de 5 minutos com `SKIP LOCKED`); despacho de mudanças dos quadros de entidade a cada 1 segundo.

**Serviços centrais:** `kanban.service.js` (regras por ação), `quadro-entidade.service.js` (provedores), `vinculo.service.js` e `varredura-vinculos.service.js` (vínculo), `notifications.service.js` (e-mails), `realtime.service.js` e `quadro-eventos.service.js` (tempo real). Contratos de provedor (`ProvedorDeQuadro`, `ProvedorDeEntidade`) em `src/core/types/module.js` e registro em `src/core/quadros/registro.js`.

**Variáveis de ambiente:** `REDIS_URL`, `SOCKET_REDIS_PREFIX`, `SMTP_*`, `FRONTEND_URL`, `KANBAN_EMAIL_ENABLED`.
