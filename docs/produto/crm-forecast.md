# Forecast

> Estado em 21/11/2026. Fonte: código do back (`src/modules/nucleo/crm/`).

## O que é

O forecast mostra, mês a mês, quanto o negócio já vendeu (realizado) e quanto espera vender (ponderado pela probabilidade, e o melhor caso, com valor cheio), mais os blocos de oportunidades que ficam fora dos meses: atrasadas, sem previsão e outras. Cada status do funil tem uma probabilidade padrão, e a oportunidade pode ter a sua. Toda segunda-feira o sistema guarda uma foto da previsão, e a gestão compara depois o que se previa com o que se vendeu (assertividade). Tudo atrás da flag `crm.forecast`; os números vêm prontos do banco, e a tela só soma o que a API devolve.

## Features

### Probabilidade padrão por status

Cada status de um pipeline tem uma probabilidade padrão. Ganho é sempre 100% e perdido sempre 0%, e não se edita. Status aberto nasce com a sugestão pela chave (Novo 10, Em contato 20, Qualificado 40, Proposta 60, Negociação 80) ou 10 se a chave não for conhecida. O dono edita o valor (inteiro de 0 a 100) em Configurações → Pipelines. Mudar a categoria de um status acerta o valor sozinho.

### Probabilidade efetiva e override que volta ao padrão

A probabilidade que vale é a própria da oportunidade, se preenchida; senão, a padrão do status. Quando o status muda (inclusive entre dois status da mesma categoria), a probabilidade própria é apagada e volta a valer a do novo status, com um aviso na resposta com o valor anterior. Esse aviso só vem para quem vê o campo Probabilidade. Mandar a probabilidade junto com a mudança de status vence a volta ao padrão. O motivo é evitar a maior fonte de forecast inflado: uma probabilidade esquecida de uma etapa anterior.

### Gancho da flag

Ligar `crm.forecast` liga, em todos os contextos (tabela, filtro, ficha e formulário), os campos "Data prevista de fechamento" e "Probabilidade de fechamento", que nasciam desligados. Desligar a flag não os desliga. Religar a flag liga os campos de novo, mesmo que o dono os tenha desligado.

### Consulta do forecast

`GET /crm/forecast`, aberto a todos os papéis. Para cada mês de um período (padrão: o mês atual, três antes e três depois; máximo de 24 meses) devolve:

- **Realizado:** oportunidades ganhas cujo mês de ganho é o mês, com quantidade e soma (valor vazio conta zero).
- **Ponderado:** oportunidades abertas com data prevista de hoje em diante dentro do mês, somando valor vezes probabilidade efetiva.
- **Melhor caso:** as mesmas abertas, com o valor cheio.
- **Previsto:** realizado mais ponderado do mês.
- **Ganhas sem valor:** só contagem, para avisar que não entram na soma.

Meses passados só têm realizado. Filtros por pipeline de Vendas, por responsável e agrupamento total, por responsável ou por status (este exige pipeline escolhido e papel que vê o campo Status). Só entram oportunidades de pipelines de Vendas ativos, fora do arquivo e da lixeira, de pessoas ativas; pessoa anonimizada entra, porque é venda real. Datas usam o fuso do negócio. Quando não há nenhuma oportunidade de Vendas, a resposta diz que está vazia.

### Blocos fora dos meses

Cada oportunidade aberta cai em uma só faixa, exceto "sem valor", que repete.

| Bloco             | O que reúne                                                                        |
| ----------------- | ---------------------------------------------------------------------------------- |
| Atrasadas         | Abertas com data prevista antes de hoje                                            |
| Sem previsão      | Abertas sem data prevista                                                          |
| Antes do período  | Abertas de hoje em diante, mas antes do mês inicial (período que começa no futuro) |
| Além do horizonte | Abertas depois do último dia do mês final                                          |
| Sem valor         | Abertas sem valor, em qualquer data (só contagem)                                  |

### Lista de oportunidades

`GET /crm/forecast/oportunidades` lista as oportunidades por trás de um número: de um mês (realizado ou aberto) ou de um bloco, paginada (50 por padrão, 100 no máximo), sem cache. Cada item traz a pessoa, o status, o valor, a probabilidade efetiva, o ponderado, a data prevista, a data do ganho e o id do responsável (o nome a tela resolve). Abertas e blocos ordenam por data prevista (sem data por último) e depois por valor; ganhas pelo ganho mais recente.

### Ação em massa: data prevista

`POST /crm/forecast/data-prevista` define a mesma data prevista em até 200 oportunidades abertas de uma vez. Cada uma passa pela mesma porta da edição normal (histórico e eventos), uma a uma, sem checagem de conflito (a última escrita vence). A falha de uma não impede as outras: a resposta diz quantas foram atualizadas e quais foram ignoradas, com o motivo (não encontrada, não aberta, arquivada ou outro). Não limpa a data e não muda probabilidade, valor nem status. Exige permissão para editar a Data prevista; sem ela, 403 antes de gravar.

### Acesso por permissão

O forecast respeita as permissões de campo e a visibilidade por pipeline do papel.

- Sem acesso a Valor, todo valor em dinheiro vem vazio (soma, ponderado, melhor caso, previsto); as contagens continuam.
- Sem acesso a Probabilidade, a probabilidade some da lista, mas o ponderado agregado continua vindo (decisão do dono).
- Cada campo oculto remove da lista as chaves dele; a tela esconde a coluna.
- Pipeline oculto fica fora de todos os números, e pedir um pipeline oculto dá 404.
- A resposta lista os campos de que o forecast precisa e o papel não tem (`camposDesligados`), para a tela avisar.

### Cache e desempenho

O agregado fica em cache por até 60 segundos. A chave muda a cada escrita em oportunidade (criar, editar, mudar status, ganhar, perder, arquivar) e a cada mudança de probabilidade padrão, então o dado nunca fica velho depois de uma escrita. A máscara de valor é aplicada depois do cache, sobre o agregado cheio. A lista não usa cache. Medido: p95 de 433 ms com 20 mil oportunidades.

### Snapshots semanais

Toda segunda-feira, a partir das 6h no fuso do negócio, o sistema guarda uma foto do forecast: o mês atual e os três seguintes, com realizado, ponderado, melhor caso e a divisão por responsável. O job roda de hora em hora e grava uma vez por semana por negócio; se o worker ficou parado na segunda, grava na próxima hora em que subir. A foto cobre todos os pipelines de Vendas ativos, sem filtro de responsável e sem máscara de papel. Snapshot é imutável: mudar probabilidades ou reabrir uma venda depois não altera o que foi previsto. Só roda com `crm.forecast` ligada.

### Assertividade

`GET /crm/forecast/assertividade`, só DONO e MASTER. Para cada mês fechado (padrão: os seis antes do atual; máximo de 24), compara o previsto com o realizado. O previsto é o que o primeiro snapshot do mês dizia, e ele é o realizado até aquela data mais o ponderado do snapshot (desvio aprovado em relação ao plano, que só previa o ponderado). A assertividade é a razão realizado sobre previsto, com 4 casas, e pode passar de 1. Mês sem snapshot vem como "sem dados", e o realizado dele continua vindo. Traz também a divisão por responsável, com as linhas "Sem responsável" e "Responsável removido".

### Colunas do ciclo de vida

Cliente desde, última compra, oportunidades abertas e ciclo de vida da pessoa não são do forecast, mas nasceram no mesmo plano (FC4). Estão em [Oportunidades e pipelines](crm-oportunidades-e-pipelines.md).

## Estado

| Feature                                 | Back   | Front                      | Flag                                                           | Origem |
| --------------------------------------- | ------ | -------------------------- | -------------------------------------------------------------- | ------ |
| Probabilidade padrão por status         | pronto | handoff entregue           | sempre ligado (a probabilidade); `crm.forecast` liga os campos | FC1    |
| Probabilidade efetiva e volta ao padrão | pronto | handoff entregue           | sempre ligado                                                  | FC1    |
| Gancho da flag                          | pronto | handoff entregue           | `crm.forecast`                                                 | FC1    |
| Consulta do forecast e blocos           | pronto | handoff entregue           | `crm.forecast`                                                 | FC2    |
| Lista de oportunidades                  | pronto | handoff entregue           | `crm.forecast`                                                 | FC2    |
| Ação em massa de data prevista          | pronto | handoff entregue           | `crm.forecast`                                                 | FC2    |
| Acesso por permissão                    | pronto | handoff entregue           | `crm.forecast`                                                 | FC2    |
| Cache e desempenho                      | pronto | não se aplica              | `crm.forecast`                                                 | FC2    |
| Snapshots semanais                      | pronto | não se aplica (automático) | `crm.forecast`                                                 | FC3    |
| Assertividade                           | pronto | handoff entregue           | `crm.forecast`                                                 | FC3    |

## Regras e limites

**Quem pode**

- Consulta, lista e ação em massa: todos os papéis, limitados pelas permissões de campo (a ação em massa exige poder editar Data prevista).
- Assertividade: só DONO e MASTER (OPERADOR recebe 403).
- Editar probabilidade padrão de status: só DONO e MASTER.

**Números**

- Período: no máximo 24 meses (consulta e assertividade).
- Lista: 50 por página (padrão), 100 no máximo.
- Ação em massa: de 1 a 200 ids, sem repetir, com data obrigatória.
- Cache do agregado: 60 segundos, invalidado por escrita.
- Snapshot: mês atual e três seguintes (quatro linhas por semana), segunda-feira a partir das 6h locais.
- Probabilidade: inteiro de 0 a 100; ganho 100 e perdido 0 são fixos.
- Desempenho: p95 de 433 ms com 20 mil oportunidades.

**Decisões do dono**

- Ligar `crm.forecast` liga os campos de que ele precisa (19/11/2026).
- O ponderado agregado continua vindo para quem não vê Probabilidade.
- O previsto da assertividade soma o realizado do snapshot ao ponderado dele.
- Só entra oportunidade de pipeline de Vendas.

**Pendências para produção**

- Os workers (`worker:crm`, que grava o snapshot) não estão no `compose.yaml` nem no CI. Sem o worker, não há snapshot e a assertividade fica "sem dados".
- `REDIS_URL` é necessário para o cache (há fallback quando indisponível).
- `pnpm crm:reconcile` precisa rodar no deploy.
- O CI (`pr-checks.yml`) nunca rodou num PR.

## Fica de fora

| Item                                                  | Motivo                                    | Quando volta |
| ----------------------------------------------------- | ----------------------------------------- | ------------ |
| Meta mensal (atingimento e linha de meta)             | Não existe meta no sistema                | Sem marco    |
| Assertividade por pipeline                            | A foto é do negócio inteiro               | Sem marco    |
| Rota para tirar ou refazer snapshot                   | O snapshot é automático e imutável        | Sem marco    |
| Snapshot do mês atual ou de meses futuros na consulta | A assertividade só compara meses fechados | Sem marco    |
| Ação em massa para probabilidade, valor ou status     | A ação só altera a data prevista          | Sem marco    |
| Limpar a data prevista em massa                       | A data é obrigatória na ação              | Sem marco    |
| Ordenar a tabela de leads pelas colunas do ciclo      | Só filtro                                 | Sem marco    |

## Ideias de expansão e refinamento

> Sugestões para decidir, não decisões.

| Ideia                                         | Valor para o cliente                           | Depende de                             | Esforço (P/M/G) |
| --------------------------------------------- | ---------------------------------------------- | -------------------------------------- | --------------- |
| Meta mensal por negócio ou por responsável    | Mostrar atingimento e linha de meta no gráfico | Decisão do dono sobre o modelo de meta | M               |
| Assertividade por pipeline                    | Saber qual funil prevê melhor                  | Snapshot guardar o pipeline            | M               |
| Nome do responsável na lista de oportunidades | Hoje a lista só traz o id e a tela resolve     | Nada técnico                           | P               |
| Ação em massa de probabilidade ou de status   | Limpar o funil de uma vez                      | Regras de transição em lote            | M               |
| Subir o `worker:crm` no deploy e no compose   | Sem ele não há snapshot nem assertividade      | Decisão de infraestrutura              | P               |

## Mapa técnico

**Rotas** (flag `crm.forecast`): `GET /crm/forecast`, `GET /crm/forecast/oportunidades`, `GET /crm/forecast/assertividade` (só gestão) e `POST /crm/forecast/data-prevista`. Probabilidade padrão: nas rotas de status de `PUT` e `POST /crm/configuracoes/pipelines/:id/status`.

**Contrato**: vive no código, em `controllers/forecast.controller.js` e `schemas/forecast.schema.js`.

**Tabelas** (`modulo_crm`): `crm_option.default_probability` (migration 0048, com trigger que preenche o padrão); `crm_forecast_snapshot` (0049, única por negócio, semana e mês); `crm_deal.probability_override`.

**Flag**: `crm.forecast`. O gancho `aoLigarFeatures` do módulo liga os campos (`forecast-flag.service.js`).

**Jobs**: `snapshot-forecast` no `worker:crm`, de hora em hora (`forecast-snapshot.service.js`).

**Services centrais**: `forecast.service.js` (consulta, lista, ação em massa, cache), `forecast-snapshot.service.js`, `forecast-assertividade.service.js`, `oportunidade-transicao.service.js` (probabilidade efetiva e aviso). Adapters: `crm-forecast.repository.js` e `crm-forecast-snapshot.repository.js`. Constantes: `constants/forecast.js`.

Ver também [Oportunidades e pipelines](crm-oportunidades-e-pipelines.md) (status, probabilidade e colunas do ciclo) e [Quadro comercial](crm-quadro-comercial.md) (mover com aviso de probabilidade).
