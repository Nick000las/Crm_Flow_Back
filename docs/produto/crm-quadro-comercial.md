# Quadro comercial

> Estado em 21/11/2026. Fonte: código do back (`src/modules/nucleo/crm/` e `src/modules/nucleo/kanban-universal/`).

## O que é

O quadro comercial mostra as oportunidades do CRM como cards num quadro estilo Kanban: cada pipeline ativo é um quadro, cada status é uma coluna e cada oportunidade é um card. O CRM é o dono dos dados e das regras; o Kanban só desenha o quadro. Arrastar o card muda o status, com as mesmas regras da ficha. O dono não configura nada à parte: criar um pipeline em Configurações já cria o quadro. O Kanban em si (quadros de equipe, cards, comentários) é de outro desenvolvedor e está descrito em [Kanban implementado](../kanban-implementado.md) e [Cards do Kanban](../kanban-cards.md).

## Features

### Um quadro por pipeline

Cada pipeline ativo vira um quadro, visível para quem o papel pode ver. As colunas seguem a ordem dos status do pipeline. Status desativado continua como coluna enquanto tiver cards, marcada como inativa (não serve de destino). A estrutura não se edita no quadro: o DONO edita em Configurações → Pipelines.

### Card pelo layout

O título, o subtítulo e os destaques do card seguem o Layout do CRM (configurável pelo dono, com a permissão do papel já aplicada). O responsável mostrado é o da oportunidade. Card de pessoa que o papel não pode descrever vem como "registro restrito".

- O card traz também o título da oportunidade e se pode ser movido.
- Abrir o card abre a ficha da pessoa, com a aba Oportunidades.

### Selos

Avisos derivados do CRM a cada leitura; nada fica guardado no Kanban.

| Selo                | Quando aparece                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `esfriando`         | O status passou dos dias sem interação configurados (precisa de `crm.inatividade`)                                            |
| `origem_reaberta`   | Card de atendimento cuja venda de origem foi reaberta                                                                         |
| `alerta_formulario` | Alerta de formulário que quem vê o card ainda não marcou como visto (precisa de `crm.formularios`); só o nível, nunca o texto |

### Soma e total por coluna

Cada coluna mostra quantos cards tem e a soma dos valores, já respeitando o filtro da tela. Quem não vê o campo Valor recebe a soma vazia: nem a soma revela o dado.

### Mover com regras

Arrastar chama o mesmo service único de status da ficha, sem regra própria.

- O card só se move dentro do próprio pipeline.
- Quem pode editar o campo Status pode arrastar; não existe regra por coluna. O card diz se pode ser movido: pessoa anonimizada, oportunidade arquivada e papel sem permissão de Status travam.
- Regra de obrigatoriedade (por exemplo, motivo da perda ao ir para Perdido) devolve `CAMPOS_OBRIGATORIOS` com a lista do que falta. A tela abre o formulário "Falta preencher para mover" e repete o mover com o motivo e a probabilidade em `campos`. As regras só valem com `crm.regras` ligada.
- Se outra pessoa mexeu antes, o mover grava e devolve `conflito: true`.
- Mudar o status volta a probabilidade própria ao padrão, com aviso na resposta (ver [Forecast](crm-forecast.md)).
- Com um filtro aberto, a resposta diz se o card saiu dele (`saiuDoFiltro`), para a tela avisar. O filtro é validado antes de gravar.

### Criar na coluna

Cria um card já no status da coluna. Pessoa existente ganha uma oportunidade nova; pessoa nova nasce só naquele pipeline (exceção à regra de que formulário de leads e importação criam em Vendas). Pessoa nova passa pelas mesmas validações e pelo aviso de duplicidade do formulário de Novo lead.

### Filtros, views e busca

O quadro usa o mesmo filtro da tabela de leads (um único caminho de código), inclusive as views salvas: a mesma view vale na tabela e no quadro. A busca cobre nome, e-mail, telefone e o identificador do layout. Três diferenças de propósito: os campos comerciais comparam a própria oportunidade (não a principal da pessoa), o responsável é o da oportunidade, e a situação é ignorada (o quadro só tem cards ativos).

### Ordenação

Lista fechada: última atualização (padrão, mais recente primeiro), data de criação, nome, valor, data prevista e probabilidade. Quem não vê o campo não ordena por ele. Cards sem valor no campo ficam por último nas duas direções. A tabela de leads não tem essa ordenação.

### Paginação por cursor

Cada coluna pagina por cursor opaco (campo de ordenação mais id), sem `OFFSET`. O cursor vale só para a ordem em que nasceu. Em escala, 9.600 cards foram percorridos em três ordens sem perda nem repetição.

### Tempo real

Quem tem o quadro aberto recebe aviso quando algo muda em qualquer lugar do CRM: ficha, tabela, edição em massa, importação, distribuição, venda ganha que cria atendimento, alerta de formulário. O aviso leva só ids; a tela relê os cards pela API, com o filtro e as permissões de quem vê (o que não vier saiu do quadro, do filtro ou do alcance). A fonte é o outbox do CRM, e não há canal ou Redis dedicado ao quadro.

- Entra na sala quem consegue abrir o quadro (módulo, flags e visibilidade por pipeline).
- Selo "esfriando" e score não geram aviso: atualizam ao reler o card.
- Aviso com mais de 5 minutos é descartado: quem abre o quadro já lê o estado atual.

### Aba Projetos (vínculo com a pessoa)

Um card de projeto do Kanban pode ser vinculado a uma pessoa do CRM. A aba "Projetos" na ficha lista os cards vinculados, só dos quadros que o usuário pode ver. O Kanban guarda apenas tipo e id; o nome vem do CRM a cada leitura. Pessoa anonimizada, na lixeira ou inexistente aparece como "registro restrito"; mesclar pessoas leva o vínculo para a que fica; anonimizar remove o vínculo depois do job diário. Oportunidade não é vinculável.

### O que o CRM expõe ao Kanban

| Provedor         | Tipo                | Uso                                                                      |
| ---------------- | ------------------- | ------------------------------------------------------------------------ |
| Pessoa           | `pessoa`            | Vínculo de card de projeto (nome, rota da ficha, resolução de mesclados) |
| Oportunidade     | `oportunidade`      | Descrição do card do quadro; não vinculável                              |
| Quadro comercial | `crm_oportunidades` | Quadros, colunas, cards, resumo, ações, mover, criar e eventos           |

## Estado

| Feature                       | Back                             | Front                                                   | Flag                                                                            | Origem  |
| ----------------------------- | -------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------- | ------- |
| Quadro por pipeline e colunas | pronto                           | handoff entregue                                        | `crm.quadro_comercial` e `kanban_universal.quadros_entidade`                    | M3      |
| Card pelo layout e selos      | pronto                           | handoff entregue (selo de formulário no handoff de FM5) | `crm.quadro_comercial`; selos dependem de `crm.inatividade` e `crm.formularios` | M3, FM5 |
| Soma e total por coluna       | pronto                           | handoff entregue                                        | `crm.quadro_comercial`                                                          | M3      |
| Mover com regras e conflito   | pronto                           | handoff entregue                                        | `crm.quadro_comercial`                                                          | M3      |
| Criar na coluna               | pronto                           | handoff entregue                                        | `crm.quadro_comercial`                                                          | M3      |
| Filtros, views e busca        | pronto                           | handoff entregue                                        | `crm.quadro_comercial`                                                          | M4      |
| Ordenação e cursor            | pronto                           | handoff entregue                                        | `crm.quadro_comercial`                                                          | M4      |
| Aviso de card fora do filtro  | pronto (`saiuDoFiltro`)          | tela pendente                                           | `crm.quadro_comercial`                                                          | M4      |
| Desempenho (aceite)           | parcial: veja "Regras e limites" | tela pendente (Core Web Vitals só com a tela publicada) | `crm.quadro_comercial`                                                          | M4      |
| Tempo real                    | pronto                           | handoff entregue                                        | `crm.quadro_comercial`                                                          | M5      |
| Aba Projetos (vínculo)        | pronto                           | sem handoff dedicado (instruções no plano do M6)        | `kanban_universal.vinculo_entidade`                                             | M6      |

## Regras e limites

**Quem vê e faz o quê**

- Sem as duas flags (`crm.quadro_comercial` e `kanban_universal.quadros_entidade`), o quadro não existe para o negócio: a lista de quadros vem vazia e as rotas dão 404 ou 403.
- Pipeline oculto para o operador (D4) some da lista de quadros; a sala de tempo real recusa e a releitura dá 404, inclusive para quem já estava nela.
- Quem perde o acesso continua na sala até sair ou reconectar, mas só recebe ids que não consegue abrir.

**Decisões do dono**

- Valor é campo do sistema, com permissão por papel, e vale em todo o CRM.
- Responsável do card e do filtro é o da oportunidade.
- Ordem do quadro é uma lista fechada; a preferência de ordem e de filtro fica só no navegador (nenhum evento de uso, D8).
- Aba Projetos mostra só os cards dos quadros que o usuário pode ver, e some se ele não vê nenhum.
- Pessoa nova criada no quadro nasce só naquele pipeline.

**Números**

- Reler cards por ids: máximo de 100 por chamada.
- O despacho leva até 1.000 eventos por rodada; atraso acima de 5 minutos descarta o aviso e a tela só vê ao reler.
- Reserva do evento: 30 s, até 5 tentativas.
- Desempenho medido em 06/11/2026 (20 mil oportunidades, da máquina local ao banco de dev, sem Redis): uma coluna por vez fica entre 371 e 455 ms no p95. **A tela inteira não fica abaixo de 500 ms no p95**: 602 ms com 1 usuário e 1,6 s com 5. O tempo vem da rede (cerca de quatro idas e voltas por transação, 12 requisições para abrir 6 colunas), não do volume.

**Pendências para produção**

- Os workers `worker:crm` e `worker:kanban` não estão no `compose.yaml` nem no CI. Sem o do Kanban, o nome some na leitura, mas a referência do vínculo fica.
- `pnpm crm:reconcile` precisa rodar no deploy (cria o campo Valor).
- `REDIS_URL` é obrigatório: fora dos testes, o servidor não sobe sem ele (tempo real com Redis Adapter).
- O CI (`pr-checks.yml`) nunca rodou num PR.
- Medir a API na mesma região do banco; se não bastar, a saída é uma rota única de abertura do quadro, que muda o contrato.

## Fica de fora

| Item                                                           | Motivo                                     | Quando volta                |
| -------------------------------------------------------------- | ------------------------------------------ | --------------------------- |
| M7 (segunda etapa do Kanban: e-mails e refactor de camadas)    | Adiado; reaproveita o `kanban.worker.js`   | Depois do M5, sem data      |
| Selo `+N` (mais de um card da mesma pessoa)                    | Não implementado                           | Sem marco                   |
| Segunda venda (D6): juntar ao card de pós-venda ou criar outro | Depende de decisão de produto              | Depois do M5, sem data      |
| Core Web Vitals no p75 com 20 mil oportunidades                | Só se mede com a tela publicada            | Quando a tela estiver no ar |
| Rota única de abertura do quadro                               | Só se a medição na mesma região não bastar | Condicional                 |
| Limpeza do `crm_event`                                         | A tabela só cresce                         | M7                          |
| Cursor do outbox por consumidor                                | Só há um consumidor                        | Quando houver um segundo    |
| Cards de oportunidade no vínculo de projeto                    | Decisão D3: oportunidade não é vinculável  | Sem marco                   |
| D4 nos duplicados e no resumo diário de esfriando              | Limitação assumida                         | Sem marco                   |

## Ideias de expansão e refinamento

> Sugestões para decidir, não decisões.

| Ideia                                          | Valor para o cliente                       | Depende de                     | Esforço (P/M/G) |
| ---------------------------------------------- | ------------------------------------------ | ------------------------------ | --------------- |
| Rota única de abertura do quadro               | Tela abre dentro da meta de 500 ms         | Medição na região do banco     | M               |
| Selo `+N` para pessoa com várias oportunidades | Evita achar que a pessoa só tem um negócio | Decisão do dono sobre o visual | P               |
| Segunda venda: avisar no card existente        | Recompra não gera card duplicado           | Decisão do dono (D6)           | M               |
| Aviso em tempo real para esfriando e score     | Selo e score atualizam sem reler           | Job que detecta a virada       | M               |
| Tirar do quadro quem perdeu o acesso na hora   | Fecha a janela em que a sala segue aberta  | Revalidação periódica da sala  | P               |
| Mostrar as colunas do ciclo no card            | Cliente ou lead aparece no próprio card    | Item "Fica de fora" do ciclo   | P               |
| Editar a estrutura do quadro sem sair dele     | Hoje o atalho leva a Configurações         | Decisão do dono sobre o escopo | M               |

## Mapa técnico

**Rotas do Kanban** (sempre sob `/kanban/quadros/crm_oportunidades/:quadroRef`, com a flag `kanban_universal.quadros_entidade`): `GET /colunas`, `POST /cards/busca`, `POST /cards/por-ids`, `POST /resumo`, `POST /cards`, `GET /cards/:entidadeId/acoes` e `PATCH /cards/:entidadeId/mover`. A lista de quadros vem em `GET /kanban/boards` (`modo: 'entidade'`). O vínculo: `GET /kanban/vinculos?entidadeTipo=pessoa&entidadeId=`, atrás de `kanban_universal.vinculo_entidade`.

**Tempo real**: namespace `/kanban` do socket, eventos `quadro:watch`, `quadro:unwatch` e `quadro:changed`.

**Contrato**: vive no código, em `kanban-universal/controllers/quadros.controller.js` e nos schemas, e em `crm/schemas/quadro-comercial.schema.js`.

**Services centrais**: `quadro-comercial.service.js` (provedor `crm_oportunidades` e provedor de oportunidade), `quadro-eventos.service.js` (drena o outbox), `pessoa-entidade.service.js` (provedor de pessoa). Adapters: `crm-quadro.repository.js`, `crm-outbox.repository.js`. Constantes: `constants/oportunidades.js` (ordens, selos, despacho).

**Tabelas**: `crm_deal`, `crm_pipeline`, `crm_event` (outbox); `cards.entidade_tipo` e `cards.entidade_id` no Kanban (migration 0035). Índice `idx_crm_deal_quadro_status` para a coluna.

**Flags**: `crm.quadro_comercial`, `kanban_universal.quadros_entidade`, `kanban_universal.vinculo_entidade`.

**Jobs**: `worker:crm` e `worker:kanban` (varredura diária dos vínculos às 2h). Detalhes das oportunidades e do outbox em [Oportunidades e pipelines](crm-oportunidades-e-pipelines.md).
