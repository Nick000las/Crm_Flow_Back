# Handoff ao front: FC4, colunas do ciclo de vida na tabela de leads

Cada lead passa a dizer em que ponto da jornada está: **Lead**, **Em negociação** ou **Cliente**, desde quando é cliente, quando comprou pela última vez e quantas oportunidades abertas tem. Chegam quatro campos novos em toda leitura de lead, quatro colunas opcionais na tabela, filtros novos na busca e uma regra de permissão que esconde duas colunas e dois filtros para alguns papéis. Não depende de flag.

Plano: [plano-execucao-formularios-forecast.md](./plano-execucao-formularios-forecast.md), marco FC4. Antes: [handoff-front-fc3.md](./handoff-front-fc3.md).

## 1. O que é

- **Ciclo de vida:** calculado a cada leitura, a partir das oportunidades que o usuário vê.
  - **Cliente:** tem ao menos uma venda ganha.
  - **Em negociação:** não tem venda ganha, mas tem oportunidade aberta.
  - **Lead:** nenhuma das duas coisas.
- **Compras:** contam só as oportunidades **ganhas** de pipelines de **Vendas**. Uma oportunidade ganha **arquivada** conta como compra.
- **Abertas:** contam as oportunidades **não arquivadas** de **qualquer** pipeline.
- **Visibilidade:** o que conta é o que o papel vê. Pipeline oculto para o papel não entra em nenhum dos quatro campos.
- **Reabertura:** reabrir a única venda ganha do lead limpa `cliente_desde` e `ultima_compra`, e o ciclo volta a ser calculado sem a venda.

## 2. Campos novos na leitura de lead

Valem em `GET /crm/leads`, `GET /crm/leads/:id` e `POST /crm/leads/search`. Os nomes seguem snake_case, como `esfriando_desde`.

| Campo                   | Tipo                                        | Regra                                                                                        |
| ----------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `ciclo_de_vida`         | `'lead'` \| `'oportunidade'` \| `'cliente'` | Rótulos sugeridos: **Lead**, **Em negociação** e **Cliente**.                                |
| `cliente_desde`         | string ISO UTC ou `null`                    | Instante da **primeira** venda ganha. Exibir como **mm/aaaa** no fuso do tenant.             |
| `ultima_compra`         | string ISO UTC ou `null`                    | Instante da **última** venda ganha. Exibir na mesma convenção de data do restante da tela.   |
| `oportunidades_abertas` | inteiro                                     | Quantidade de oportunidades abertas (não arquivadas) que o usuário vê, de qualquer pipeline. |

Exemplo (só os campos novos; o restante do lead vem como já vem):

```json
{
  "id": "uuid",
  "ciclo_de_vida": "cliente",
  "cliente_desde": "2026-03-10T14:00:00.000Z",
  "ultima_compra": "2026-10-02T17:20:00.000Z",
  "oportunidades_abertas": 2
}
```

Um lead sem nenhuma venda vem com `cliente_desde: null` e `ultima_compra: null`. Um lead sem oportunidade nenhuma vem com `oportunidades_abertas: 0`, nunca `null`.

- **Permissão de campo:** `ciclo_de_vida` e `oportunidades_abertas` **sempre vêm**. `cliente_desde` e `ultima_compra` **só vêm** se o papel vê o campo "Data de conversão" (chave `dataConversao`). Sem essa permissão, as duas chaves **não vêm na resposta** (não vêm como `null`). Veja a seção 3.
- Os valores são calculados a cada leitura, sem cache próprio do front além do que a tela já faz.

## 3. Permissão por campo

Se o papel **não vê** "Data de conversão" (`dataConversao`):

- As chaves `cliente_desde` e `ultima_compra` **não vêm** em nenhum item de lead.
- **Esconda** as duas colunas correspondentes na tabela, no seletor de colunas e no chip de ciclo.
- **Esconda** os filtros `clienteDesdeDe`, `clienteDesdeAte`, `ultimaCompraDe` e `ultimaCompraAte` da barra de filtros.
- Se a tela mandar um desses filtros mesmo assim, a API responde 400 (seção 4).

`ciclo_de_vida` e `oportunidades_abertas` continuam aparecendo para todos os papéis, inclusive quando `dataConversao` está oculto. Use a presença da chave para decidir a coluna quando não houver outra fonte: se nenhum item da página traz `cliente_desde`, a coluna fica escondida.

**Atenção:** o campo "Data de conversão" vem **desligado de fábrica** (Camada 2). Enquanto o dono não o liga em Campos, `cliente_desde` e `ultima_compra` não saem para ninguém, nem para o DONO. A melhor fonte para decidir é o schema de campos do papel (`dataConversao` presente), não a página de leads.

**Atendimento conta nas abertas:** com a automação de atendimento ligada, ganhar uma venda cria uma oportunidade aberta no pipeline de Atendimento. Ela entra em `oportunidades_abertas` (a regra conta qualquer pipeline); o ciclo continua `cliente`.

## 4. Filtros no `POST /crm/leads/search`

Os filtros novos entram no corpo da busca, junto com os que já existem. Valem também em **views salvas** e no **export**, no mesmo formato.

| Filtro                    | Tipo                                                       | Significado                                                   |
| ------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------- |
| `cicloDeVida`             | array não vazio de `'lead'`, `'oportunidade'`, `'cliente'` | "Um dos": o lead está em qualquer um dos ciclos marcados.     |
| `clienteDesdeDe`          | texto `AAAA-MM-DD`                                         | Início (inclusivo) de `cliente_desde`, dia no fuso do tenant. |
| `clienteDesdeAte`         | texto `AAAA-MM-DD`                                         | Fim (inclusivo) de `cliente_desde`, dia no fuso do tenant.    |
| `ultimaCompraDe`          | texto `AAAA-MM-DD`                                         | Início (inclusivo) de `ultima_compra`, dia no fuso do tenant. |
| `ultimaCompraAte`         | texto `AAAA-MM-DD`                                         | Fim (inclusivo) de `ultima_compra`, dia no fuso do tenant.    |
| `oportunidadesAbertasMin` | inteiro >= 0                                               | Mínimo de `oportunidades_abertas` (inclusivo).                |
| `oportunidadesAbertasMax` | inteiro >= 0                                               | Máximo de `oportunidades_abertas` (inclusivo).                |

Exemplo: clientes sem compra desde julho (última compra até 30/06).

```json
{
  "cicloDeVida": ["cliente"],
  "ultimaCompraAte": "2026-06-30",
  "paginacao": { "pagina": 1, "tamanho": 50 }
}
```

- As duas pontas de cada intervalo de data são **inclusivas**. Não some um dia no front para "fechar" o intervalo.
- `cicloDeVida` é multi-seleção ("um dos"). Mande o array só com os itens marcados; array vazio dá 400.
- Os filtros de data são **texto de calendário**, não instante: mande `AAAA-MM-DD` como o usuário escolheu, sem converter para ISO.

**Erros:**

| Status | Quando                                                                               | Campo / mensagem                                                             |
| ------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 400    | `clienteDesdeDe` depois de `clienteDesdeAte`                                         | `fields.clienteDesdeDe`: "A data inicial não pode ser depois da final"       |
| 400    | `ultimaCompraDe` depois de `ultimaCompraAte`                                         | `fields.ultimaCompraDe`: "A data inicial não pode ser depois da final"       |
| 400    | `oportunidadesAbertasMin` maior que `oportunidadesAbertasMax`                        | `fields.oportunidadesAbertasMin`: "O mínimo não pode ser maior que o máximo" |
| 400    | `cicloDeVida` com valor fora de `lead`, `oportunidade`, `cliente`, ou array vazio    | `fields.cicloDeVida`                                                         |
| 400    | Data malformada (fora de `AAAA-MM-DD` ou inexistente)                                | o campo da data, com a mensagem de erro do schema                            |
| 400    | Filtro de data (`clienteDesde*` ou `ultimaCompra*`) sem permissão de `dataConversao` | `fields["filtros.<chave>"]`: "Campo desconhecido"                            |

O erro de filtro sem permissão segue o mesmo padrão do filtro de valor sem permissão. Trate o 400 como qualquer `VALIDATION_ERROR`: mostre a mensagem no campo indicado em `fields`. Para o caso "Campo desconhecido" de um papel sem `dataConversao`, a tela já não deveria ter mandado o filtro (seção 3); se acontecer, remova o filtro e refaça a busca.

## 5. Sugestão de tela

**Tabela de leads:** quatro colunas **opcionais**, no seletor de colunas que a tabela já tem:

- **Ciclo de vida:** chip com o rótulo do ciclo. Para cliente, use o mesmo formato do chip do drawer do documento 1A.5: **Cliente desde mm/aaaa**. Para os outros, **Em negociação** ou **Lead**.
- **Cliente desde:** mm/aaaa no fuso do tenant. Some quando `dataConversao` está oculto.
- **Última compra:** data no fuso do tenant. Some quando `dataConversao` está oculto.
- **Oportunidades abertas:** número inteiro.

**Barra de filtros:**

- **Ciclo de vida:** multi-seleção com as três opções (um dos).
- **Cliente desde:** intervalo de datas (de / até), inclusivo nas duas pontas. Some sem `dataConversao`.
- **Última compra:** intervalo de datas (de / até), inclusivo nas duas pontas. Some sem `dataConversao`.
- **Oportunidades abertas:** mínimo e máximo, inteiros >= 0. Se o mínimo for maior que o máximo, mostre o erro do campo `fields.oportunidadesAbertasMin` antes de enviar, se quiser; a API também responde 400.

**Ordenação** pelas colunas novas **ainda não existe**: não ofereça ordenar por essas colunas. O cabeçalho delas fica sem seta de ordenação.

## 6. Como dividir o trabalho entre agentes

Decisão do dono: **o planejamento é sempre com Opus**. A camada de dados e as regras usam Opus em esforço médio. Tarefas simples ou repetitivas usam Sonnet ou Haiku.

| Agente                  | Tarefas                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Opus (planejamento)** | Ler este documento, definir os módulos, as props e a ordem das entregas, e escrever as instruções de cada agente abaixo.                                                                                                                                                                                                                                            |
| **Opus, esforço médio** | **Camada de dados e regras:** os tipos dos quatro campos e dos filtros na chamada à busca, a permissão por campo (esconder colunas e filtros de `cliente_desde` e `ultima_compra` quando `dataConversao` não vem), o fuso na exibição do mm/aaaa e das datas, e a montagem dos filtros (intervalos inclusivos, multi-seleção de `cicloDeVida`, texto `AAAA-MM-DD`). |
| **Sonnet**              | **Colunas** no seletor da tabela, **chip** do ciclo, **filtros** na barra (multi-seleção, intervalos de data, mínimo e máximo) e os **testes de componente** (com `dataConversao` oculto, com ciclo de cada tipo e com filtro de intervalo inválido).                                                                                                               |
| **Haiku**               | **Tipos** a partir deste documento (só o contrato, sem regra), **textos e rótulos** (Lead, Em negociação, Cliente, mensagens de erro e de ajuda) e a **entrada** de cada coluna e filtro no seletor.                                                                                                                                                                |

**O resultado de cada agente é conferido antes de integrar.** Quem coordena lê o que foi entregue e roda a verificação (tipos, lint, testes) antes de juntar; confira em especial se as colunas e os filtros somem quando `dataConversao` não vem, se as datas `AAAA-MM-DD` não foram convertidas para instante, se os intervalos estão inclusivos e se nenhum `null` virou zero ou "Lead". Não integre trabalho de um agente só porque ele disse que terminou.

## 7. O que ainda não existe

- **Ordenação** pelas colunas novas (ciclo, cliente desde, última compra, oportunidades abertas).
- **Selo +N de abertas:** o indicador de oportunidades abertas além da primeira não existe. Só o número vem.
- **As colunas novas nos cards do quadro (Kanban):** não existem nos cards.
- **Export com essas colunas:** o filtro vale no export, mas o export ainda não traz as quatro colunas novas.
