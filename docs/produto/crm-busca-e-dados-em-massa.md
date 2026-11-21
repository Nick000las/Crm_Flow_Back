# CRM: busca e dados em massa

> Estado em 21/11/2026. Fonte: código do back (`src/modules/nucleo/crm/`).

## O que é

É como a equipe encontra pessoas na base e mexe em muitas de uma vez. Cobre a busca com filtros, as visões salvas de cada usuário, a edição em lote, a importação de planilha e a exportação. Quem opera enxerga só o que o seu papel permite: campo oculto não entra na busca nem no filtro, e pipeline oculto some da lista, do total e do export. Importar e exportar são só da gestão (DONO e MASTER). A edição em massa é de qualquer papel.

## Features

### Busca e lista de pessoas

Uma única consulta serve a tabela, as views salvas e o export. A lista simples (`GET /crm/leads`) é a mesma busca, sem filtro.

- **Busca textual:** procura em Nome, E-mail e Telefone. Se o texto parece telefone, compara só os dígitos, que é como o telefone fica gravado. Também procura no identificador escolhido no layout (por exemplo CNPJ ou CPF, comparado sem pontuação).
- **Respeita o papel:** e-mail, telefone ou identificador ocultos para o operador não entram na busca, senão ela revelaria o valor.
- **Paginação:** padrão de 50 por página, no máximo 200. A resposta traz o total.
- **Ordem fixa:** da pessoa criada mais recentemente para a mais antiga. Não há ordenação escolhida pelo usuário.
- **Visibilidade por pipeline:** pessoas que só têm oportunidade em pipeline oculto para o papel não aparecem, nem no total.

### Filtros por campo

Qualquer campo visível no contexto "Filtros" (veja [Pessoas e campos](crm-pessoas-e-campos.md)) pode ser filtrado, inclusive os personalizados. Até 20 filtros por consulta, todos combinados (E). Campo oculto para o papel dá 400.

| Tipo do campo                 | Operadores aceitos                                        |
| ----------------------------- | --------------------------------------------------------- |
| Texto                         | igual, contém, é um dos, vazio, não vazio                 |
| Texto longo                   | contém, vazio, não vazio                                  |
| Número, Monetário, Data, Hora | igual, entre, vazio, não vazio                            |
| Sim/Não                       | igual, vazio, não vazio                                   |
| Seleção, Usuário              | igual, é um dos, vazio, não vazio                         |
| Seleção múltipla              | contém, é um dos, vazio, não vazio                        |
| E-mail                        | igual, contém, é um dos, vazio, não vazio                 |
| Telefone, URL, CPF, CNPJ, CEP | igual, contém, vazio, não vazio                           |
| Endereço                      | contém, vazio, não vazio                                  |
| Intervalo de datas            | entre (os dois intervalos se sobrepõem), vazio, não vazio |

- **Valor digitado é normalizado:** "(11) 99999-0000" acha o telefone gravado como `11999990000`.
- **Segurança:** nome de coluna nunca vem do cliente, e todo valor entra como parâmetro da consulta.

### Filtros prontos

Filtros próprios, fora do construtor de campos.

- **Responsável:** uma pessoa específica, ou "sem responsável". Responsável desativado conta como sem responsável. Os dois juntos dão 400.
- **Estágio:** o status da pessoa.
- **Valor:** mínimo e máximo. Dá 400 se o papel não vê o campo Valor.
- **Criada entre:** data inicial e final.
- **Situação:** ativos (padrão), arquivados ou lixeira. Exige `crm.arquivo`.
- **Esfriando:** só as pessoas que passaram dos dias sem interação configurados no status. Exige `crm.inatividade`. A regra completa está em [Qualidade e produtividade](crm-qualidade-e-produtividade.md).
- **Faixa de score:** Frio, Morno ou Quente por padrão (até 29, 30 a 69, 70 ou mais), ou as faixas que a empresa configurou. Exige `crm.score`.

### Filtros do ciclo de vida

Cada pessoa mostra em que ponto da jornada está, calculado a cada leitura, e a busca filtra por isso. Veja também [Oportunidades e pipelines](crm-oportunidades-e-pipelines.md).

- **Ciclo de vida:** Cliente (tem ao menos uma venda ganha em pipeline de Vendas, mesmo arquivada), Em negociação, chave `oportunidade` (sem venda ganha, mas com oportunidade aberta e não arquivada, em qualquer pipeline) ou Lead (o resto). O filtro aceita vários ciclos ao mesmo tempo.
- **Cliente desde e Última compra:** datas da primeira e da última venda ganha. Filtro por intervalo de dias, inclusivo nas duas pontas, no fuso da empresa.
- **Oportunidades abertas:** quantidade, com mínimo e máximo.
- **Só o que o papel vê:** pipeline oculto não entra na conta.
- **Datas dependem do campo Data de conversão:** quem não vê esse campo não recebe `cliente_desde` e `ultima_compra` e leva 400 se filtrar por elas. Como o campo nasce desligado, as duas datas não saem para ninguém até o dono ligá-lo.
- **Vale em toda parte:** os filtros funcionam também em views salvas e no export.
- **Ainda não existe:** ordenar por essas colunas, tê-las nos cards do quadro e tê-las no export.

### Views salvas

Cada usuário guarda os seus filtros com um nome e reaplica depois.

- **Pessoais:** só quem salvou vê. O nome é único por usuário.
- **Validada ao salvar:** filtro com campo inexistente ou operador incompatível não é aceito.
- **Reaplicar é buscar de novo:** a view é só o filtro guardado. Se um campo foi desligado depois, a busca acusa na hora.
- **View do sistema "Esfriando":** com `crm.inatividade` ligada, aparece sempre em primeiro, não se exclui nem se renomeia.
- **Operações:** listar, salvar e excluir. Não há edição de view existente.

### Edição em massa

O usuário marca pessoas na tabela e altera várias de uma vez.

- **O que altera:** Status, Origem, Responsável (ou tirar o responsável) e Tags. Tags somam ou tiram sobre as que cada pessoa já tem, sem substituir. Tag nova digitada vira tag da lista.
- **Mesmas regras do cadastro:** cada pessoa passa pelo mesmo caminho da edição individual. Opção ativa, responsável ativo, regras de obrigatoriedade contra a pessoa resultante e histórico valem para cada uma. Mudar o status conta como interação.
- **Relatório por pessoa:** a resposta é sempre 200 com o resultado de cada uma (atualizada, inalterada ou com erro e o motivo). Uma falha não para as outras, e não é tudo-ou-nada.
- **Permissão de campo:** se o papel não pode editar um dos campos pedidos, o pedido inteiro dá 403 antes de mexer em qualquer pessoa.
- **Limites:** de 1 a 200 pessoas por pedido, sem repetir. É o tamanho de uma página da busca.
- **Quem pode:** qualquer papel, como a edição individual. Exige `crm.massa`.

### Importação de planilha

A gestão sobe uma planilha `.xlsx` e cria ou atualiza pessoas em lote. O fluxo tem quatro passos.

1. **Arquivo:** envia a planilha. O sistema mostra as colunas, o total de linhas, as 10 primeiras linhas e os campos que aceitam mapeamento.
2. **Mapear:** o usuário liga cada coluna a um campo. Os personalizados aparecem como destino. Também dá para mapear Estágio do funil (pelo nome de um status ativo) e Responsável (pelo nome de um usuário ativo).
3. **Revisar:** o sistema valida todas as linhas e mostra os erros por linha e as possíveis duplicadas. Para cada duplicada, o usuário escolhe pular, atualizar ou criar. Onde a regra de duplicidade bloqueia, "criar" é recusado.
4. **Importar:** confirma e acompanha o progresso. O trabalho roda em segundo plano, nada é gravado dentro do pedido.

- **Mapeamento obrigatório:** todo campo obrigatório no formulário de criação precisa estar mapeado, e ao menos e-mail ou telefone. Um campo só pode receber uma coluna.
- **Regras na revisão:** cada linha é avaliada como pessoa nova contra as regras de obrigatoriedade, os tipos de campo e a base legal.
- **Duplicidade:** com `crm.duplicidade`, valem as regras da empresa. Sem a flag, vale o padrão antigo (e-mail e telefone, só avisando).
- **Responsável:** vale a coluna Responsável; senão a distribuição automática (`crm.distribuicao`); senão quem importou.
- **Base legal do lote:** com `crm.lgpd`, uma base legal vale para as linhas que não trazem a sua. Veja [Histórico, arquivo e LGPD](crm-historico-arquivo-e-lgpd.md).
- **Score:** com a pontuação ligada, o campo Lead score não pode ser importado. Os campos carimbados pelo sistema (LGPD) também não.
- **Valores das células:** datas aceitam `dd/mm/aaaa`, Sim/Não aceita sim, não, verdadeiro e falso, e documentos aceitam máscara.
- **Depois de gravar:** o score é recalculado, o enriquecimento por CNPJ é agendado e quem recebeu pessoas pela distribuição é notificado.
- **Relatório:** o acompanhamento traz linhas processadas, criadas, atualizadas, ignoradas e com erro, e o motivo de cada erro.
- **Linha com erro não derruba o lote.** Erro geral (por exemplo banco fora) marca a importação como falha.
- **Autoria:** quem importou é o autor das alterações no histórico.

### Exportação

A gestão baixa as pessoas filtradas em `.xlsx` ou `.csv`.

- **Filtro:** o mesmo da busca, inclusive os do ciclo de vida. A lixeira não pode ser exportada.
- **Colunas:** escolhidas pelo usuário, na ordem desejada, incluindo Responsável (pelo nome) e Criado em, que só existem no export. Sem escolher, saem as colunas da tabela do usuário (o identificador e as colunas do layout). Isso exige `crm.massa`.
- **Campo sensível:** só sai se pedido pelo nome, nunca nas colunas padrão.
- **CSV para Excel brasileiro:** separador `;`, acentos preservados, quebra de linha do Windows, decimal com vírgula e data `dd/mm/aaaa`. Texto que o Excel leria como fórmula ganha um apóstrofo na frente. CSV exige `crm.massa`.
- **Formatação:** listas saem pelo nome da opção, telefone, CPF, CNPJ e CEP com máscara, endereço numa linha e Sim/Não por extenso.
- **Limite:** 10.000 pessoas por arquivo. Acima disso a resposta é 400 pedindo para refinar o filtro.
- **Síncrono:** o arquivo é gerado no próprio pedido, sem guardar nada no servidor.

## Estado

| Feature                  | Back   | Front                                            | Flag                                                                                                                           | Origem             |
| ------------------------ | ------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| Busca e lista            | pronto | sem handoff                                      | sempre ligado                                                                                                                  | Base, M2, M4, M13  |
| Filtros por campo        | pronto | sem handoff                                      | sempre ligado                                                                                                                  | Base, M2, M11      |
| Filtros prontos          | pronto | sem handoff (contrato no plano de Configurações) | sempre ligado; situação `crm.arquivo`, esfriando `crm.inatividade`, score `crm.score`                                          | Base, M5, M9, M14  |
| Filtros do ciclo de vida | pronto | handoff entregue                                 | sempre ligado                                                                                                                  | FC4                |
| Views salvas             | pronto | sem handoff                                      | sempre ligado (view "Esfriando" com `crm.inatividade`)                                                                         | Base, M9           |
| Edição em massa          | pronto | sem handoff (contrato no plano de Configurações) | `crm.massa`                                                                                                                    | M10                |
| Importação de planilha   | pronto | sem handoff (contrato no plano de Configurações) | sempre ligado; Revisar com regras da empresa `crm.duplicidade`, distribuição `crm.distribuicao`, base legal do lote `crm.lgpd` | Base, M7, M12, M15 |
| Exportação               | pronto | sem handoff (contrato no plano de Configurações) | `.xlsx` sempre ligado; `.csv` e colunas padrão `crm.massa`                                                                     | Base, M10, FC4     |

## Regras e limites

**Papéis**

- Busca, lista, filtros e views: qualquer papel, sempre no recorte do papel (campo oculto e pipeline oculto fora).
- Edição em massa: qualquer papel.
- Importação e exportação: só DONO e MASTER.
- Permissão por campo não restringe import e export, porque são só da gestão.

**Busca**

- Até 20 filtros por consulta. Página de 1 a 200 pessoas, padrão 50.
- Data inicial depois da final, mínimo maior que máximo ou ciclo repetido dão 400.
- Datas do ciclo são texto `AAAA-MM-DD`, não instante.

**Edição em massa**

- De 1 a 200 pessoas por pedido, sem repetir, com ao menos uma alteração.

**Importação**

- Só `.xlsx`, até 10 MB, até 5.000 linhas, primeira aba, cabeçalho na linha 1 sem nomes repetidos.
- Progresso gravado a cada 50 linhas.
- Confirmar duas vezes dá 409. Se a fila estiver fora, a resposta é 503 e a importação volta a "pendente" para confirmar de novo.

**Exportação**

- Até 10.000 pessoas por arquivo. Colunas padrão e CSV exigem `crm.massa`.

**Pendências de produção que afetam esta área**

- O worker `worker:crm` (que processa a importação) não está no `compose.yaml` nem no CI, e `REDIS_URL` é necessário. Sem eles, confirmar a importação não processa nada.
- O CI (`pr-checks.yml`) nunca rodou num PR.
- `pnpm crm:reconcile` precisa rodar no deploy.

## Fica de fora

| Item                                                               | Motivo                                                        | Quando volta |
| ------------------------------------------------------------------ | ------------------------------------------------------------- | ------------ |
| Campos personalizados na edição em massa                           | A primeira versão cobre só Status, Origem, Responsável e Tags | Sem data     |
| Ordenação escolhida pelo usuário, inclusive pelas colunas do ciclo | A lista tem ordem fixa por data de criação                    | Sem data     |
| Colunas do ciclo de vida nos cards do quadro e no export           | Só as colunas na tabela e os filtros foram entregues          | Sem data     |
| Lista e export de oportunidades                                    | Hoje tudo é por pessoa                                        | Sem data     |
| Rótulos do ciclo de vida configuráveis                             | Lead, Em negociação e Cliente são fixos                       | Sem data     |
| Selo `+N` de oportunidades abertas                                 | Só o número chega, sem o indicador                            | Sem data     |
| Importar `.csv`                                                    | O import só lê `.xlsx`                                        | Sem data     |

## Ideias de expansão e refinamento

> Sugestões para decidir, não decisões.

| Ideia                                                       | Valor para o cliente                                                 | Depende de                                    | Esforço (P/M/G) |
| ----------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------- | --------------- |
| Ordenar a tabela por qualquer coluna, inclusive as do ciclo | Achar os clientes mais antigos ou os com mais oportunidades abertas  | Ordenação no filtro e nas expressões do ciclo | M               |
| Colunas do ciclo de vida no export                          | Levar a visão de cliente para a planilha                             | Incluir as colunas calculadas no export       | P               |
| Editar campos personalizados em massa                       | Corrigir um campo em centenas de pessoas sem importar de novo        | Regras por tipo e permissões por pessoa       | M               |
| Marcar "todas do filtro" na edição em massa                 | Hoje o lote é uma página de 200; a base inteira exige várias rodadas | Processar em segundo plano, como a importação | M               |
| Export maior ou em segundo plano                            | O teto de 10.000 trava bases grandes                                 | Fila e armazenamento do arquivo               | G               |
| Importar em lotes maiores, ou `.csv`                        | O teto de 5.000 linhas obriga a dividir a planilha                   | Leitura em fluxo e ajuste de memória          | M               |
| Views compartilhadas com a equipe                           | Padronizar "meus clientes parados" para todo o time                  | Modelo de view por empresa e quem pode editar | M               |
| Editar ou renomear uma view salva                           | Hoje é preciso excluir e criar de novo                               | Rota de edição                                | P               |
| Lista e export por oportunidade                             | Ver a carteira de vendas, não só de pessoas                          | Leitura própria de oportunidades              | G               |

## Mapa técnico

**Rotas** (sob `/crm`)

| Método e caminho                                     | Para que serve                               |
| ---------------------------------------------------- | -------------------------------------------- |
| `POST /leads/search`, `GET /leads?pagina=&tamanho=`  | Busca com filtros e lista simples            |
| `GET/POST /filter-views`, `DELETE /filter-views/:id` | Views salvas do usuário                      |
| `PATCH /leads/bulk`                                  | Edição em massa (`crm.massa`)                |
| `POST /import/preview`, `POST /import/validate`      | Passos Arquivo, Mapear e Revisar (só gestão) |
| `POST /import/:jobId/confirm`, `GET /import/:jobId`  | Confirmar e acompanhar (só gestão)           |
| `POST /export`                                       | Baixar `.xlsx` ou `.csv` (só gestão)         |

O contrato de entrada e saída mora nos controllers (`controllers/leads.controller.js`, `filter-views.controller.js`, `import-export.controller.js`) e nos schemas Zod (`schemas/leads-search.schema.js`, `leads-bulk.schema.js`, `import-export.schema.js`, `filter-views.schema.js`). Não está copiado aqui.

**Tabelas** (schema `modulo_crm`, com RLS): `crm_filter_views` (filtros em JSON, nome único por usuário), `import_jobs` (linhas válidas já mapeadas, estratégia, ações por linha e progresso). A leitura da pessoa combina `leads` com a oportunidade principal e os cálculos do ciclo.

**Flags:** `crm.massa`, `crm.arquivo`, `crm.inatividade`, `crm.score`, `crm.duplicidade`, `crm.distribuicao`, `crm.lgpd`.

**Jobs:** fila `crm-import` (BullMQ), processada por `pnpm worker:crm`.

**Services centrais:** `lead-filter.service.js` (traduz o filtro em condições SQL, puro), `leads.service.js` (`prepararFiltro`, base comum de tabela, export e quadro), `leads-bulk.service.js`, `filter-views.service.js`, `import.service.js`, `planilha.service.js` (leitura e geração de planilha e CSV), `export.service.js`, `tipos-campo.service.js` (conversão de célula e texto de busca). As expressões SQL do ciclo e do esfriando ficam em `adapters/crm-lead-ciclo.sql.js` e `adapters/crm-inatividade.sql.js`. As constantes estão em `constants/campos.js` (operadores e limites da busca) e `constants/planilha.js`.
