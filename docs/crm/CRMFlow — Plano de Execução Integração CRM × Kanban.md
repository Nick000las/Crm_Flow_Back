# CRMFlow — Plano de Execução: Integração CRM × Kanban

Nov 4, 2026 · @Nickolas

## Visão e princípios

O CRM é dono dos dados; o Kanban é uma forma de trabalhar sobre eles. O motor do Kanban passa a ter dois modos: card nativo (projetos internos, como hoje) e card de entidade (o card mostra uma oportunidade do CRM, e mexer no card é mexer na oportunidade).

**Como o produto é usado**

- O Kanban não é a página principal do produto, mas, dentro da área de CRM, a visão de quadros de pipeline é a mais usada: é onde a equipe vê os leads andando e atualiza status.
- A tabela de leads e a ficha são a fonte da verdade e servem para consulta, visão geral, busca de quem já passou pelo funil, cadastro e tarefas.

**Dois tipos de quadro**

|                      | Quadro de pipeline                                         | Quadro de projeto                 |
| -------------------- | ---------------------------------------------------------- | --------------------------------- |
| Exemplos             | Vendas, Atendimento, outros criados pelo dono              | Projetos e tarefas internas       |
| Card                 | Oportunidade do CRM (card de entidade)                     | Card nativo, como hoje            |
| Estrutura            | Fixa no Kanban; definida pelo dono em Configurações do CRM | Livre, editável no próprio quadro |
| O que o card permite | Tudo que a ficha do CRM permite                            | O que o Kanban já faz hoje        |
| Regras do CRM        | Todas                                                      | Nenhuma                           |
| Vínculo com cliente  | É o próprio registro                                       | Opcional, somente leitura         |

**Princípios**

1. Uma verdade por dado: o CRM é dono de pessoas, oportunidades, pipelines, status, responsáveis, campos e histórico; o Kanban é dono de projetos nativos e da ordem visual dos cards.
2. Arrastar é editar: mexer num card de pipeline passa pelo mesmo service e pelas mesmas regras da ficha.
3. Uma linha do tempo por pessoa.
4. LGPD por construção: nenhum dado pessoal do CRM é copiado para tabelas do Kanban.
5. Módulos não se importam: conversam por um contrato no core (provedor de quadro) e por eventos (outbox).
6. O Kanban não perde nada do que já faz nos quadros de projeto.
7. **Não presumir:** qualquer ponto não coberto aqui deve ser perguntado ao dono antes de decidir.

## Pré-requisitos, escopo e decisões

Este plano cobre só a integração CRM × Kanban. M0–M2 e M6 podem começar já; M3–M5 dependem do M2.5 (Fundação comercial). A branch feat\_Forms foi descartada: os formulários serão feitos do zero depois da sincronização, com plano próprio.

### Pré-requisitos (entregues no M2.5, salvo indicação)

- Oportunidades (`crm_deal`, N por pessoa) com ciclo de vida derivado.
- `crm_pipeline` com tipo `sales` | `service`, opções de status por pipeline e regra de auto-criação do card de atendimento.
- **O dono pode criar pipelines** além dos padrões, com **limite de 5 pipelines por tenant, incluindo Vendas e Atendimento** (limite fixo por enquanto; vai mudar no futuro).
- **Card de atendimento nasce automaticamente** quando uma venda é ganha; o dono pode desligar a automação.
- **Segunda venda com tratamento ativo** (D6): quando há alguém na tela, o sistema oferece juntar ao card existente ou criar um novo. Quando a venda é ganha por automação ou importação, **não cria card novo**: o card existente ganha o aviso "nova venda: juntar ou separar?" até alguém decidir. Fica para depois do M5.
- `funil_estagios` aposentado; os estágios atuais viram o seed das opções de status do pipeline Vendas.
- Outbox `crm_event` gravado na mesma transação de cada mudança.

### Fora do escopo deste plano

- Bot de atendimento, motor de mensagens e carteira de créditos.
- Campos personalizados e catálogo de etiquetas próprios do Kanban (suspensos, ver P5).
- Formulários e anamnese: refeitos do zero depois deste plano.

### Decisões aplicadas (P0–P22)

| Ponto                       | Decisão                                                                                                            | Marco      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------- |
| P0 Banco à frente do código | Banco novo só com as migrations da main                                                                            | M0         |
| P21 Formatação e pnpm       | Commit só de formatação; docs em pnpm                                                                              | M0         |
| P1 Dono da etapa            | CRM; coluna = opção de status do pipeline; Kanban sem ordem própria                                                | M3         |
| P2 O que é o card           | Card de entidade sem cópia; vínculo leve                                                                           | M2, M3     |
| P3 Conversa entre módulos   | Provedor de quadro no core; sem FK entre schemas                                                                   | M2         |
| P4 Tipo e vocabulário       | Catálogo de tipos; provedor `crm_oportunidades` (não `crm_leads`); "Status" no CRM, "Coluna" só na tela            | M2, M3     |
| P5 Campos do card           | Card de entidade sem `dados_extras`; campos/etiquetas do Kanban suspensos; corrigir §1.1.1/§1.6.1                  | M3         |
| P6 O que aparece no card    | Identificador, subtítulo e destaques do Layout do CRM                                                              | M3         |
| P7 Regras no mover          | Mesmo service da oportunidade; formulário de campos faltantes; rollback com aviso                                  | M3         |
| P8 Conflitos                | Mover: última vence com aviso; editar: `expectedUpdatedAt` também no CRM                                           | M3         |
| P9 Excluir e arquivar       | Sem excluir card de pipeline; só arquivar/lixeira da oportunidade; excluir quadro nunca apaga dados                | M3         |
| P10 Automações              | Nada agora; regra de domínio dispara pelo registro                                                                 | —          |
| P11 Quem vê o quê           | Visibilidade do CRM + visibilidade por pipeline por papel (D4)                                                     | M3         |
| P12 Permissão por campo     | Schema do papel aplicado no provedor; soma null sem acesso a Valor                                                 | M3         |
| P13 Responsável             | Responsável da oportunidade, sem regra de participante                                                             | M3         |
| P14 Histórico               | Movimento na timeline da pessoa/oportunidade                                                                       | M3         |
| P15 Comentários             | Ocultos em card de pipeline até a segunda etapa                                                                    | M3, M7     |
| P16 LGPD                    | Coberto por P2 e P15; anonimização limpa vínculos de projeto                                                       | M3, M6     |
| P17 Notificações            | Core; segunda etapa                                                                                                | M7         |
| P18 Worker e fuso           | Fuso do tenant agora; worker depois                                                                                | M1, M7     |
| P19 Tempo real              | Fonte = outbox `crm_event`                                                                                         | M5         |
| P20 Filtros e escala        | Filtros/views do CRM, paginação por coluna, lock só na escrita e por quadro, ordenação escolhida pelo usuário (D2) | M1, M4     |
| P22 Contrato de módulo      | Flag `crm.quadro_comercial`; tirar hooks repetidos; contador único de migrations                                   | M0, M1, M2 |

## M0 — Ambiente

Destrava o trabalho de todos: banco alinhado com a main e CI verde. Não depende de decisão de produto.

**Entregas**

1. Branch novo do Neon com só as migrations da main. O banco atual fica guardado como referência e sai do `.env` de desenvolvimento.
2. Commit único de formatação na main (`pnpm format`), sem nenhuma outra mudança no mesmo commit.
3. Docs do CRM migrados de npm para pnpm.
4. Regra registrada no MASTER\_DOCUMENT: contador único de migrations entre módulos daqui em diante.
5. As migrations 0030–0034, que existem no histórico do banco antigo mas não na main, serão **recriadas com novos números** pelo M2.5, nunca reaproveitadas.

**Aceite**

- [x] `prisma migrate status` e o catálogo do Postgres batem com os arquivos da main.
- [x] Criar e editar lead funcionam no banco novo.
- [ ] CI verde, incluindo `format:check`.

## M1 — Correções do Kanban atual

Correções que valem para os quadros de projeto de hoje e preparam a escala dos quadros de pipeline. Independentes do CRM.

**Entregas**

1. **Lock só na escrita e por quadro** (P20): leituras sem lock; escritas travam só o quadro afetado, não o tenant. Leituras deixam de carregar todos os quadros, colunas e cards do tenant (`kanban.repository.js:41`).
2. **Fuso do tenant no lembrete de prazo** (P18): usar `tenants.fuso_horario` no lugar de `KANBAN_EMAIL_TIMEZONE`.
3. **Remover hooks repetidos** (P22): `authenticateHook` e checagem de módulo que o `app.js` já faz.
4. **Declarar feature flags do Kanban** conforme o §1.1.3.
5. Verificar se existem quadros com `boardType = 'crm_leads'` com dado real. Sem dado, remover; com dado, **perguntar ao dono** antes de converter ou apagar.

**Aceite**

- [x] Dois usuários do mesmo tenant editando quadros diferentes não entram em fila.
- [x] Lembrete de prazo de um tenant em outro fuso chega no dia certo perto da virada.
- [x] `test:kanban:integration` verde.

## M2 — Contrato de provedor de quadro no core

O motor do Kanban passa a aceitar quadros cujo conteúdo vem de outro módulo, sem conhecer "lead" ou "oportunidade": ele conhece só `boardType` e `entidade_id`. Este marco não depende do CRM; é validado com um provedor falso nos testes.

### Contrato

Declarado no objeto `Module` (campo novo e opcional) e publicado por `#core/registry/modules.js`:

```js
// Module.quadros
[{
  boardType: 'crm_oportunidades',
  listarQuadros(ctx),                         // quadros que este módulo publica (ex.: um por pipeline)
  listarColunas(ctx, quadroRef),              // colunas somente leitura no Kanban
  listarCards(ctx, quadroRef, { colunaRef, filtros, viewId, cursor, limite }),
  resumoColuna(ctx, quadroRef, { colunaRef, filtros }),   // { total, soma } por consulta agregada
  descreverCard(ctx, entidadeIds),            // título, subtítulo, destaques, responsável
  mover(ctx, { entidadeId, colunaDestino, expectedUpdatedAt }),
  criar(ctx, { quadroRef, colunaRef, dados }),
  acoesPermitidas(ctx, entidadeId),           // o que o usuário pode fazer neste card
  rotaFicha(entidadeId)                       // para abrir a ficha completa
}]
```

### Regras do motor

- **Catálogo de tipos:** `nativo` + os `boardType` dos provedores registrados. Tipo deixa de ser texto livre.
- **Sem provedor, o card é nativo.** Quadros de projeto não mudam.
- **Quadro de entidade não precisa de linha em `boards`.** O motor lista os quadros pelo provedor. Se alguma parte do motor exigir linha, ela é criada e mantida pelo provedor, nunca pela galeria de modelos.
- **O Kanban não guarda nada sobre quadros de entidade.** Não há ordem manual (D2); a preferência de ordenação fica no navegador do usuário.
- **Referências lógicas, sem FK entre schemas.** Limpeza por evento quando a entidade é excluída, anonimizada ou muda de coluna/quadro.
- **Erros de domínio padronizados** com `ERROR_CODES`. Ex.: `CAMPOS_OBRIGATORIOS` com a lista de campos, para a tela abrir o formulário.
- **Colunas de quadro de entidade são somente leitura no Kanban:** sem criar, renomear, apagar ou reordenar coluna pela tela do quadro.
- **Sem excluir card** de entidade no motor: só as ações que `acoesPermitidas` devolver.

### Aceite

- [x] Provedor falso nos testes: listar, paginar, mover com sucesso, mover com `CAMPOS_OBRIGATORIOS`, criar.
- [x] Tenant sem módulo CRM usa só cards nativos, sem mudança de comportamento.
- [x] Nenhum import entre módulos (verificado pelo ESLint de fronteiras).

## M2.5 — Fundação comercial

Marco criado em 5/11/2026, com a decisão de descartar a feat\_Forms: a base comercial que M3–M5 usam nasce aqui, e os formulários ficam para depois. Checklist completo em `plano-execucao-crm-kanban.md`.

**Entregas**

1. `crm_pipeline`, `crm_deal` e `crm_event` em migrations novas, a partir da 0036.
2. Pipelines Vendas e Atendimento por tenant, com status por pipeline e limite de 5.
3. Um service único de oportunidade, usado pela ficha, pela importação, pela edição em massa e pelo quadro.
4. Card de atendimento automático ao ganhar a venda, que o dono pode desligar.
5. Mesclar, anonimizar, lixeira, inatividade, score e distribuição funcionando sobre oportunidades.
6. Leitura com um modelo só: `funil_estagios` aposentado. A API de leads mantém o formato, com os dados da oportunidade principal.

**Fora:** formulários, segunda venda (D6), campo por pipeline e consumo do outbox (M5).

**Aceite**

- [ ] Uma pessoa com duas oportunidades em pipelines diferentes, cada uma com seu status.
- [ ] A API de leads não mudou de formato.
- [ ] Venda ganha cria o card de atendimento com a automação ligada e não cria com ela desligada.
- [ ] Toda mudança de status grava histórico e `crm_event` na mesma transação.
- [ ] Mesclar preserva as oportunidades; anonimizar não deixa dado pessoal nelas.
- [ ] `funil_estagios` não existe mais.

## M3 — Provedor crm\_oportunidades

O CRM implementa o contrato do M2: cada pipeline vira um quadro de pipeline, e cada oportunidade vira um card. Depende do M2.5. Atrás da flag `crm.quadro_comercial`.

### Quadros e colunas

- `listarQuadros`: um quadro por `crm_pipeline` ativo do tenant, de qualquer tipo (`sales` e `service`). Pipelines que o dono criar em Configurações aparecem sozinhos; pipelines desativados somem.
- `listarColunas`: as opções de status do pipeline (`crm_option`), na ordem de `position`, com a cor configurada.
- Estrutura **fixa no Kanban**. Para o DONO, o quadro mostra um atalho "Editar estrutura" que abre Configurações do CRM. Ninguém cria, renomeia ou apaga coluna pela tela do quadro.

### O card

- `descreverCard`: identificador, subtítulo e destaques do Layout do CRM (D6). Título vem da pessoa; destaques podem incluir campos da oportunidade (valor, data prevista, contador de sessões no pipeline de atendimento).
- Selos derivados do CRM: "esfriando", alerta de formulário (genérico para quem não vê campos sensíveis), "venda de origem reaberta" em card de atendimento.
- Nenhum dado copiado para o Kanban; tudo é lido do CRM a cada consulta.

### O que o card permite: tudo que a ficha permite

- **Abrir o card abre a ficha completa do CRM**, com o mesmo componente da tela de leads: dados, oportunidades, tarefas e atividades, formulários (gerar/copiar link de anamnese), histórico.
- **Mover** (P7): chama o mesmo service da mudança de status da oportunidade. Aplica obrigatoriedade por status, motivo de perda, opção ativa, reset de inatividade, histórico, recálculo do ciclo de vida e gravação no outbox. Se faltar campo, a API devolve `CAMPOS_OBRIGATORIOS`, a tela abre o formulário e, se a pessoa cancelar, o card volta com aviso.
- **Só move dentro do mesmo pipeline.** Não existe arrastar entre quadros; o card de atendimento nasce pela regra de auto-criação do CRM.
- **Criar na coluna:** busca pessoa existente (regras de duplicidade) ou cadastra nova, e cria a oportunidade naquele pipeline e status, com as mesmas validações do formulário Novo lead.
- **Arquivar e lixeira** (P9) são as ações da oportunidade; o card sai do quadro e volta se restaurado. Não existe "excluir card".
- **Comentários ocultos** em card de pipeline até a segunda etapa (P15).

### Permissões e conflitos

- Visibilidade segue o CRM (P11); quadro de pipeline não tem equipe própria.
- **Visibilidade por pipeline, por papel (D4):** o DONO define quais pipelines o papel OPERADOR enxerga. É uma permissão do CRM, então vale em todo lugar: quadro, tabela, ficha (a aba Oportunidades mostra só as dos pipelines visíveis), busca, export, totais e forecast. Só entre os papéis atuais (OPERADOR × DONO); não há papéis personalizados.
- **Quem arrasta = quem pode editar o campo Status.** Usa a permissão por campo que já existe; com "só ver" no Status, o papel não arrasta no quadro nem muda o status na ficha. Não há restrição por coluna ou por transição.
- Schema do papel aplicado em `listarCards` e `descreverCard` (P12): campo oculto não sai na resposta; soma de valor sai `null` para quem não vê Valor.
- Responsável = responsável da oportunidade (P13), sem regra de participante.
- Mover: última gravação vence, com aviso. Editar na ficha: `expectedUpdatedAt` (P8), 409 com o estado atual.

### Aceite

- [ ] Arrastar para "Perdido" sem motivo é recusado com a lista de campos e abre o formulário.
- [ ] A oportunidade movida aparece igual na tabela, no quadro e na timeline.
- [ ] Pipeline criado pelo dono aparece como quadro sem nenhuma ação no Kanban.
- [ ] Venda ganha gera card no quadro de atendimento (com a auto-criação ligada) e não gera com ela desligada.
- [ ] OPERADOR sem acesso a Valor não recebe valor nem soma.
- [ ] Nenhuma tabela do Kanban guarda dado pessoal do CRM.

## M4 — Ordem, filtros e escala

Como o quadro de pipeline é a visão mais usada do CRM, busca, filtros e volume entram junto com o provedor, não como otimização futura.

**Filtros e views**

- O quadro de pipeline usa o mesmo `lead-filter.service.js` e as **views salvas do CRM**. Um filtro salvo na tabela funciona no quadro e vice-versa.
- Filtro aplicado no servidor; nada de filtrar no navegador nem salvar filtro em `localStorage` para quadros de pipeline.
- Busca por nome, telefone, e-mail e identificador do layout.
- **Arrastar com filtro ativo é permitido** (D1, padrão do HubSpot): o card muda de coluna normalmente; se deixar de satisfazer o filtro, some da tela com um aviso curto ("movido; não aparece no filtro atual").

**Paginação e totais**

- Paginação por coluna, com cursor.
- Total de cards e soma de valor por coluna via consulta agregada (`resumoColuna`), não somando o que veio na página.

**Ordem**

- **Seletor de ordenação** no quadro, com os mesmos campos ordenáveis da tabela de leads, crescente ou decrescente.
- **Padrão: última atualização, mais recente primeiro** (D2).
- A escolha do usuário fica salva no `localStorage`, por quadro. Vale até ele trocar, limpar os dados do navegador ou usar outro dispositivo; aí volta ao padrão.
- **Não existe ordem manual:** arrastar só serve para mudar de coluna. Nenhuma posição é gravada no servidor.

**Aceite**

- [ ] Quadro com 20 mil oportunidades cumpre os Core Web Vitals do Google no percentil 75 (D7): LCP ≤ 2,5 s, INP ≤ 200 ms ao arrastar e clicar, TTFB ≤ 800 ms.
- [ ] Orçamento interno da API: primeira página de cada coluna em até 500 ms no p95 com 20 mil oportunidades.
- [ ] Total e soma por coluna batem com a consulta direta no banco.
- [ ] View salva na tabela produz o mesmo conjunto no quadro.
- [ ] Arrastar com filtro ativo funciona e avisa quando o card sai do filtro.

## M5 — Tempo real do CRM

Hoje o socket só publica mudanças do próprio Kanban; edições na ficha, importação, edição em massa e distribuição não chegam a um quadro aberto. Este marco liga o CRM ao tempo real pelo outbox.

**Entregas**

- Fonte única: eventos `deal.*` e `person.*` do outbox `crm_event`.
- Depois do commit, o provedor avisa o motor, que reaproveita `publicarKanban`: publica só IDs, e a tela recarrega o card pela API (respeitando permissões).
- Canal por tenant, com o pipeline no evento, para cada quadro aberto receber só o que é dele.
- Cobertura: mudança de status na ficha, edição de campo de card, criação, arquivamento, importação, edição em massa, distribuição de responsável, auto-criação de card de atendimento. O bot, quando existir, entra pelo mesmo caminho.

**Aceite**

- [ ] Editar a oportunidade na ficha atualiza o card em outro navegador sem recarregar a página.
- [ ] Evento de socket não carrega dado pessoal (só IDs).
- [ ] Usuário sem permissão para ver a oportunidade não recebe o evento ou recebe e não consegue carregar o card.

## M6 — Quadros de projeto com vínculo opcional

Quadros de projeto seguem livres, como o Kanban é hoje. A única novidade é poder apontar um card de projeto para um cliente ou oportunidade, somente para leitura (ex.: "produzir arte da tatuagem do Jorge"). Pode ser feito depois do M2, em paralelo ao M3.

**Regras**

- **Vínculo só com a pessoa** (D3), opcional e somente leitura, para fins informativos: o card mostra o identificador do layout com link para a ficha. Não copia dado, não dispara regra, não escreve no CRM.
- **Aba "Projetos" na ficha da pessoa:** lista os cards de projeto vinculados a ela. A aba só aparece quando existe ao menos um vínculo. Menções em comentário ou descrição não contam, só o vínculo explícito.
- O vínculo é uma referência lógica (`entidade_tipo = pessoa`, `entidade_id`) resolvida pelo provedor via `descreverCard`.
- Quem não tem permissão para ver a pessoa vê só "Registro restrito".
- Anonimização LGPD da pessoa remove o vínculo por evento, sem apagar o card.
- Nenhuma outra regra, campo, permissão ou histórico do CRM se aplica ao quadro de projeto.
- Tarefas do CRM não aparecem em quadros de projeto: são coisas separadas.

**Aceite**

- [x] Card de projeto vinculado mostra o nome atualizado quando o CRM muda.
- [x] Anonimizar a pessoa remove o vínculo e o nome de todos os cards de projeto.
- [x] Usuário sem acesso ao registro não vê nenhum dado dele pelo card.

## M7 — Segunda etapa

Itens decididos, mas que entram depois que os quadros de pipeline estiverem em uso.

| Item                   | O que entra                                                                                                                                 | Origem |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Comentários → timeline | Comentário em card de pipeline grava como atividade na ficha; menções pelo fluxo de notificação; reabre o comentário que ficou oculto no M3 | P15    |
| Notificações no core   | Preferências e e-mail sobem para o core como canal de `criarNotificacoes`; Kanban deixa de ter sistema próprio                              | P17    |
| Envio pelo worker      | Lembretes e e-mails do Kanban saem do `setTimeout` do processo HTTP para o worker BullMQ                                                    | P18    |
| Camadas do Kanban      | Refatorar regra de negócio para fora do adapter e do `operarKanban(action)`, só no que a integração tocou; usar `ROLES` e `ERROR_CODES`     | P22    |

## Testes, gates e decisões pendentes

**Ordem de execução**

1. M0 → M1 (já).
2. M2 e M6 (já, em paralelo).
3. M2.5 (Fundação comercial).
4. M3 → M4 → M5.
5. Formulários do zero (plano próprio) e segunda venda (D6).
6. M7.

**Gates em todo marco:** `lint`, `format:check`, `test`, `test:rls-coverage`, `test:fk-coverage`, `test:tenant-isolation`, `test:kanban:integration`.

**Passar pelo desenvolvedor do Kanban antes de começar:** M1, M2 e M4.

### Decisões do dono

| #   | Decisão                                                                                                                                    | Onde         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| D1  | Arrastar com filtro ativo é permitido; o card some com aviso se sair do filtro (padrão HubSpot)                                            | M4           |
| D2  | Ordenação escolhida pelo usuário, salva no `localStorage` por quadro; padrão = última atualização, mais recente primeiro; sem ordem manual | M2, M4       |
| D3  | Vínculo de card de projeto só com a pessoa; aba "Projetos" na ficha, visível só quando há vínculo explícito                                | M6           |
| D4  | Visibilidade por pipeline, por papel, só entre OPERADOR e DONO; vale em todo o CRM                                                         | M3           |
| D4b | Quem arrasta = quem pode editar o campo Status; sem restrição por coluna/transição                                                         | M3           |
| D5  | Até 5 pipelines por tenant, incluindo Vendas e Atendimento (fixo por enquanto)                                                             | M2.5         |
| D6  | Segunda venda com tratamento ativo: oferece juntar; por automação/importação não cria card novo e avisa no card existente                  | Depois do M5 |
| D7  | Core Web Vitals no p75 (LCP ≤ 2,5 s, INP ≤ 200 ms, TTFB ≤ 800 ms) + API ≤ 500 ms p95 por coluna                                            | M4           |

### Ainda pendente

| #   | Pergunta                                                                                                                                                        | Onde |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| D8  | A preferência de ordenação também deve gerar um evento de uso (analytics) para medir quais ordens a equipe prefere? O `localStorage` sozinho não permite medir. | M4   |
