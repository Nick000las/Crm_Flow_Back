# Handoff ao front: FC2, forecast

O forecast mostra, mês a mês, quanto a empresa **já vendeu** (realizado) e quanto **espera vender** (ponderado e melhor caso), mais os blocos de oportunidades que ficam fora dos meses (atrasadas, sem previsão e outras). Chegam três rotas e a página Forecast.

Plano: [plano-execucao-formularios-forecast.md](./plano-execucao-formularios-forecast.md), marco FC2. Antes: [handoff-front-fc1.md](./handoff-front-fc1.md).

## 1. O que é o forecast e o que cada número significa

Todos os números vêm prontos da API, calculados no banco. **O front só soma o que a API devolve e nunca recalcula ponderado.**

| Número                     | Regra                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Realizado** (mês M)      | Oportunidades **ganhas** cujo mês de `won_at` é M. `quantidade` e `soma` (valor vazio conta 0).                                      |
| **Ponderado** (mês M)      | Oportunidades **abertas** com data prevista de hoje em diante e dentro de M. `quantidade` e `soma` de valor x probabilidade efetiva. |
| **Melhor caso** (mês M)    | As mesmas abertas do ponderado, com o valor cheio (como se todas fechassem).                                                         |
| **Previsto** (mês M)       | Realizado + ponderado do mês.                                                                                                        |
| **Atrasadas**              | Abertas com data prevista **antes de hoje**, em qualquer mês.                                                                        |
| **Sem previsão**           | Abertas sem data prevista.                                                                                                           |
| **Antes do período**       | Abertas com data de hoje em diante, mas **antes do mês `de`** (só existe quando o período começa no futuro).                         |
| **Além do horizonte**      | Abertas com data de hoje em diante e **depois do último dia do mês `ate`**.                                                          |
| **Sem valor**              | Abertas sem valor, em qualquer data. Só tem `quantidade`. Uma oportunidade aqui também aparece no bloco da data dela.                |
| `ganhasSemValor` (por mês) | Ganhas do mês sem valor: só contagem, para avisar "N vendas sem valor não entram na soma".                                           |

**Probabilidade efetiva:** a própria da oportunidade, ou a padrão do status (FC1).

**Qual data posiciona no mês:**

- **Ganhas** entram pelo mês de `won_at`, no fuso do tenant.
- **Abertas** entram pelo mês de `dataPrevistaFechamento`. O mês atual inclui de hoje até o fim do mês; dias anteriores de hoje são "atrasadas".
- Meses **passados** só têm realizado. O ponderado e o melhor caso de um mês passado são sempre zero.
- Cada oportunidade cai em **uma** faixa (um mês ou um bloco). Só "Sem valor" repete oportunidades, e por isso a soma das quantidades dos cards não é o total de oportunidades.

**Fuso:** o tenant tem um fuso (`tenants.fuso_horario`; vazio ou inválido cai no padrão). A resposta traz `fuso` e `hoje` (`AAAA-MM-DD` nesse fuso). Use `hoje` para saber qual é o mês atual e não o relógio do navegador. As datas de `dataPrevistaFechamento` são datas de calendário, sem fuso.

**Só entram** oportunidades de pipelines de vendas ativos, que não estejam no arquivo nem na lixeira, de pessoas também ativas. Pessoa anonimizada entra (é venda real), com o nome como está no banco.

## 2. Rotas

As três ficam atrás da flag `crm.forecast` e são abertas a **todos os papéis**. O que cada papel vê muda pelas permissões (seção 3). Envelope de sempre: `{ "success": true, "data": ... }`.

### 2.1 `GET /crm/forecast`

Query (todos opcionais):

| Parâmetro       | Valor                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| `de`, `ate`     | `AAAA-MM`. Padrão: mês atual (no fuso) menos 3 e mais 3. Máximo de 24 meses, inclusive.                     |
| `pipelineId`    | uuid de um pipeline de vendas, ativo e visível ao papel.                                                    |
| `responsavelId` | uuid do usuário responsável.                                                                                |
| `agrupar`       | `total` (padrão), `responsavel` ou `status`. `status` exige `pipelineId` e que o papel veja o campo Status. |

Resposta:

```json
{
  "fuso": "America/Sao_Paulo",
  "hoje": "2026-11-19",
  "periodo": { "de": "2026-08", "ate": "2027-02" },
  "filtros": { "pipelineId": null, "responsavelId": null, "agrupar": "total" },
  "veValor": true,
  "veProbabilidade": true,
  "camposDesligados": [],
  "vazio": false,
  "meses": [
    {
      "mes": "2026-11",
      "realizado": { "quantidade": 2, "soma": 3000.5 },
      "ponderado": { "quantidade": 3, "soma": 1200.25 },
      "melhorCaso": { "soma": 4000 },
      "previsto": 4200.75,
      "ganhasSemValor": 0
    }
  ],
  "blocos": {
    "atrasadas": { "quantidade": 1, "soma": 500, "ponderado": 200 },
    "antesDoPeriodo": { "quantidade": 0, "soma": 0, "ponderado": 0 },
    "semPrevisao": { "quantidade": 0, "soma": 0, "ponderado": 0 },
    "alemDoHorizonte": { "quantidade": 0, "soma": 0, "ponderado": 0 },
    "semValor": { "quantidade": 0 }
  },
  "grupos": []
}
```

- **`meses`** tem um item por mês de `de` a `ate`, inclusive, **mesmo sem dado** (zeros). Nunca é preciso preencher buracos no gráfico.
- **`grupos`** é `[]` com `agrupar=total`. Com `responsavel` ou `status`, cada grupo tem o mesmo formato do topo:

```json
{
  "chave": "uuid-do-usuario",
  "rotulo": "Maria Souza",
  "meses": [],
  "blocos": {}
}
```

- Com `responsavel`, `chave` é o id do usuário, ou `null` com `rotulo: "Sem responsável"`. Com `status`, `chave` é a key do status e `rotulo` é o label.
- Só vêm grupos com ao menos uma oportunidade, do maior previsto para o menor (empate: pelo rótulo).
- `meses` e `blocos` do topo são do **conjunto inteiro**, calculados no banco. Não some os grupos.
- **`vazio`** é `true` quando o tenant não tem nenhuma oportunidade de vendas ativa (aberta ou ganha) nos pipelines que o papel vê. **Ignora** `pipelineId` e `responsavelId`: um filtro que não acha nada não é "vazio". A resposta continua com a forma completa, em zeros.
- **`periodo`** devolve o período efetivo, já com o padrão aplicado.

**Erros:**

| Status | Quando                                                                                                             | Campo / código                              |
| ------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| 400    | `de` ou `ate` fora do formato `AAAA-MM`                                                                            | `de` / `ate`                                |
| 400    | `de` depois de `ate` ("O mês inicial precisa vir antes do final")                                                  | `de`                                        |
| 400    | Período com mais de 24 meses ("Escolha um período de até 24 meses")                                                | `ate`                                       |
| 400    | `pipelineId` ou `responsavelId` que não é uuid                                                                     | `pipelineId` / `responsavelId`              |
| 400    | `agrupar` fora de `total`, `responsavel`, `status`                                                                 | `agrupar`                                   |
| 400    | `agrupar=status` sem `pipelineId` ("Escolha um pipeline para agrupar por status")                                  | `agrupar`                                   |
| 400    | `agrupar=status` e o papel não vê o campo Status ("Este campo não está disponível para agrupar")                   | `agrupar`                                   |
| 403    | Flag `crm.forecast` desligada no tenant                                                                            | `FEATURE_NOT_ENABLED`, `details.featureKey` |
| 404    | `pipelineId` que não existe, não é de vendas, está inativo ou está oculto para o papel ("Pipeline não encontrado") | `RESOURCE_NOT_FOUND`                        |

### 2.2 `GET /crm/forecast/oportunidades`

A lista por trás de um número. Informe **um** entre `mes` e `bloco`. Os dois, ou nenhum, dão 400 em `mes`.

| Parâmetro                     | Valor                                                                                                                                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mes`                         | `AAAA-MM`. Exige `tipo`.                                                                                                                                                                     |
| `tipo`                        | `realizado` (ganhas do mês) ou `aberto` (abertas previstas para o mês, de hoje em diante).                                                                                                   |
| `bloco`                       | `atrasadas`, `antes_do_periodo`, `sem_previsao`, `alem_do_horizonte` ou `sem_valor`.                                                                                                         |
| `de`, `ate`                   | `AAAA-MM`. Só importam em `antes_do_periodo` (usa `de`) e `alem_do_horizonte` (usa `ate`). **Mande o mesmo período do GET principal**; sem eles, vale o padrão (mês atual menos 3 e mais 3). |
| `pipelineId`, `responsavelId` | Mesmas regras e mesmos erros da rota principal. Mande os mesmos filtros da tela.                                                                                                             |
| `pagina`                      | Inteiro, mínimo 1. Padrão 1.                                                                                                                                                                 |
| `tamanho`                     | Inteiro de 1 a 100. Padrão 50.                                                                                                                                                               |

Resposta:

```json
{
  "itens": [
    {
      "id": "uuid",
      "leadId": "uuid",
      "pessoa": "Nome da pessoa",
      "pipelineId": "uuid",
      "status": "proposta",
      "statusLabel": "Proposta",
      "categoria": "aberto",
      "valor": 1000,
      "probabilidadeEfetiva": 60,
      "ponderado": 600,
      "dataPrevistaFechamento": "2026-12-10",
      "ganhaEm": null,
      "responsavelId": "uuid ou null",
      "atualizadaEm": "2026-11-18T14:03:00.000Z"
    }
  ],
  "total": 37,
  "pagina": 1,
  "tamanho": 50
}
```

- **Ordem:** abertas e blocos por data prevista (sem data por último), depois valor do maior para o menor, depois id. Ganhas por `ganhaEm` mais recente primeiro.
- `valor` e `ponderado` são `null` quando a oportunidade não tem valor.
- `ganhaEm` só tem valor em oportunidades ganhas.
- Esta rota **não usa cache**.
- Não há nome do responsável na lista, só `responsavelId`. Resolva pelo cadastro de usuários que a tela já carrega.

**Erros:**

| Status | Quando                                                           | Campo / código        |
| ------ | ---------------------------------------------------------------- | --------------------- |
| 400    | Nem `mes` nem `bloco`, ou os dois ("Informe um mês ou um bloco") | `mes`                 |
| 400    | `mes` sem `tipo` ("Informe o tipo: realizado ou aberto")         | `tipo`                |
| 400    | `tipo` fora de `realizado`, `aberto`                             | `tipo`                |
| 400    | `bloco` fora da lista                                            | `bloco`               |
| 400    | `mes`, `de` ou `ate` fora de `AAAA-MM`                           | o próprio campo       |
| 400    | `pagina` menor que 1, ou `tamanho` fora de 1 a 100               | `pagina` / `tamanho`  |
| 400    | `pipelineId` ou `responsavelId` que não é uuid                   | o próprio campo       |
| 403    | Flag `crm.forecast` desligada                                    | `FEATURE_NOT_ENABLED` |
| 404    | `pipelineId` inexistente, não vendas, inativo ou oculto ao papel | `RESOURCE_NOT_FOUND`  |

### 2.3 `POST /crm/forecast/data-prevista`

Ação em massa: a mesma data prevista em várias oportunidades abertas.

```json
{
  "oportunidadeIds": ["uuid", "uuid"],
  "dataPrevistaFechamento": "2026-12-15"
}
```

- `oportunidadeIds`: de 1 a **200** ids, sem repetir.
- `dataPrevistaFechamento`: **texto de data obrigatório** (`AAAA-MM-DD`). Não aceita `null`, então esta ação não limpa a data.
- Corpo estrito: chaves a mais dão 400.
- Cada oportunidade é atualizada **em sequência**, pela mesma porta da edição normal (histórico e eventos de cada uma). Sem checagem de conflito: a última escrita vence.
- A falha de uma não impede as outras.

Resposta 200:

```json
{
  "atualizadas": 2,
  "ignoradas": [
    { "id": "uuid", "motivo": "NAO_ABERTA" },
    { "id": "uuid", "motivo": "NAO_ENCONTRADA" },
    { "id": "uuid", "motivo": "RESOURCE_CONFLICT" }
  ]
}
```

| `motivo`            | Significa                                                                                                                 | Texto sugerido                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `NAO_ENCONTRADA`    | O id não existe ou está em pipeline que o papel não vê.                                                                   | "Oportunidade não encontrada."                 |
| `NAO_ABERTA`        | Já foi ganha ou perdida.                                                                                                  | "Já foi encerrada."                            |
| `RESOURCE_CONFLICT` | Exemplo de erro da edição, aqui para oportunidade arquivada. O `motivo` é o `code` de qualquer erro de negócio da edição. | "Está arquivada." (ou texto genérico)          |
| outro `code`        | Qualquer outro erro de negócio vira o `code` dele.                                                                        | "Não foi possível atualizar." (texto genérico) |

Mostre um texto para cada `motivo` conhecido e um genérico para os demais. Erro inesperado do servidor não vira `ignoradas`: a chamada inteira dá 500, e as já gravadas ficam gravadas. Se isso acontecer, refaça o GET.

**Erros:**

| Status | Quando                                                                         | Campo / código           |
| ------ | ------------------------------------------------------------------------------ | ------------------------ |
| 400    | `oportunidadeIds` ausente, vazio, com mais de 200, com id inválido ou repetido | `oportunidadeIds`        |
| 400    | `dataPrevistaFechamento` ausente, `null` ou inválida                           | `dataPrevistaFechamento` |
| 400    | Chave desconhecida no corpo                                                    | a chave                  |
| 403    | O papel não pode editar Data prevista de fechamento. Nada é gravado.           | `FORBIDDEN`              |
| 403    | Flag `crm.forecast` desligada                                                  | `FEATURE_NOT_ENABLED`    |

## 3. Permissões

O forecast respeita as permissões de campo do papel. A tela precisa funcionar em todos os casos.

- **`veValor: false`**: todo número em dinheiro vem **`null`**: `soma`, `ponderado`, `melhorCaso.soma` e `previsto`, em `meses`, `blocos` e `grupos`. **As contagens continuam** (`quantidade`, `ganhasSemValor`, `semValor.quantidade`).
  - Mostre só contagens: o gráfico de barras vira contagem de oportunidades (realizado e abertas), sem eixo em R$.
  - **Nunca mostre "R$ 0" para `null`.** Esconda o valor ou use um traço. Trate `null` antes de formatar moeda.
  - Na lista, a chave `valor` e a `ponderado` somem dos itens.
- **`veProbabilidade: false`**: a chave `probabilidadeEfetiva` some dos itens da lista. O ponderado agregado **continua** vindo (decisão do dono). Esconda só a coluna de probabilidade.
- **Chaves que somem da lista por papel** (a chave não vem, não vem `null`):

| Campo que o papel não vê    | Chaves removidas do item                        |
| --------------------------- | ----------------------------------------------- |
| Valor                       | `valor`, `ponderado`                            |
| Probabilidade               | `probabilidadeEfetiva`                          |
| Data prevista de fechamento | `dataPrevistaFechamento`                        |
| Status                      | `status`, `statusLabel`, `categoria`, `ganhaEm` |

A tabela precisa esconder a coluna quando a chave não existe em nenhum item.

- **Pipeline oculto:** o papel não vê pipelines ocultos para ele (hoje só o operador tem). Eles ficam fora de todos os números. Um `pipelineId` de pipeline oculto dá 404. O seletor de pipeline deve vir da lista de pipelines que o papel já recebe.
- **Agrupar por status** dá 400 para quem não vê o campo Status. Esconda essa opção quando o papel não vê Status.
- **Ação em massa:** só quem pode editar Data prevista de fechamento. Sem permissão, a API responde 403 antes de gravar. Esconda o botão para quem não pode.

## 4. `camposDesligados`

`camposDesligados` lista as chaves de que o forecast precisa e que o papel **não tem** (campo desligado ou oculto): `dataPrevistaFechamento` e `probabilidadeFechamento`. Mostre um aviso no topo da página, com um texto por chave:

- `dataPrevistaFechamento`: "Ligue Data prevista de fechamento em Configurações → Campos para o forecast posicionar as oportunidades."
- `probabilidadeFechamento`: "Ligue Probabilidade de fechamento em Configurações → Campos para ajustar a probabilidade de cada oportunidade. Enquanto isso, vale a probabilidade padrão do status."

O aviso não bloqueia a página: os números continuam vindo. Para quem não é gestão, troque "Ligue" por "Peça ao responsável pela conta para ligar".

## 5. Estado vazio (`vazio: true`)

Quando `vazio` é `true`, **não desenhe o gráfico zerado**. Mostre um estado vazio com a chamada para criar a primeira oportunidade:

> "Ainda não há oportunidades de venda. Crie a primeira para acompanhar o forecast."

Com botão "Criar oportunidade" (para o quadro comercial ou o formulário de criação). Se `vazio` for `false` e os meses estiverem zerados por causa dos filtros, mostre o gráfico normal e uma linha "Nenhum resultado para estes filtros".

## 6. Sugestão de tela: página Forecast

Mostre o item de menu e a rota só quando `crm.forecast` estiver em `featuresAtivas` (`/auth/me`).

**Topo (filtros):**

- Seletor de período (mês inicial e final). Padrão: o que a API devolve em `periodo`. Limite de 24 meses na própria tela.
- Pipeline (só vendas, os que o papel vê), responsável e agrupamento (Total, Por responsável, Por status). "Por status" só com pipeline escolhido e só se o papel vê Status.
- Aviso de `camposDesligados` (seção 4) logo abaixo.

**Gráfico:** barras por mês (`meses`), com **realizado e ponderado empilhados** e o **melhor caso como marcador** (traço ou ponto) acima da barra. Marque o mês atual (o de `hoje`). Tooltip com os quatro números e `ganhasSemValor`, se for maior que zero ("2 vendas sem valor não entram na soma"). Sem `veValor`, o gráfico mostra contagens (seção 3). Com agrupamento, mostre o total no gráfico e os grupos em uma tabela de resumo abaixo (uma linha por grupo, com o previsto total e os meses).

**Cards dos blocos:** Atrasadas, Sem previsão, Antes do período (só quando a quantidade for maior que zero), Além do horizonte e Sem valor. Cada card mostra a quantidade e, quando há valor, a soma e o ponderado. Clicar abre a lista (`bloco=...`, com `de`, `ate` e filtros da tela). Atrasadas e Sem previsão pedem atenção: use destaque de alerta.

**Tabela do mês clicado:** ao clicar numa barra, abra a lista paginada do mês (`pagina`, `tamanho`):

- Mês **passado**: `tipo=realizado`.
- Mês **futuro**: `tipo=aberto`.
- Mês **atual**: duas abas, "Realizado" e "Em aberto".
- Colunas: pessoa (link para a ficha), status, valor, probabilidade, ponderado, data prevista e responsável. Esconda as colunas cujas chaves não vêm (seção 3).

**Ação em massa "Atualizar data prevista":** disponível nas listas de **Atrasadas** e **Sem previsão** (e pode valer para qualquer lista de abertas).

1. Checkbox por linha e "selecionar todas desta página". Limite de **200** selecionadas, com contador "37 de 200".
2. Botão "Atualizar data prevista" abre um seletor de data e confirma.
3. Envie `POST /crm/forecast/data-prevista`.
4. Mostre "N atualizadas". Se `ignoradas` tiver itens, liste cada um com o nome da pessoa (pelos itens já carregados) e o **motivo em texto**, nunca o código cru.
5. Depois, refaça o GET do forecast e a lista (seção 7).

**Moeda:** formate em reais. Some sempre os números que a API devolve e **nunca recalcule o ponderado no front**: ele vem do banco, com a probabilidade efetiva e arredondamento próprios.

## 7. Cache

- `GET /crm/forecast` pode devolver dados de até **60 segundos** atrás **quando nada mudou**. Toda escrita em oportunidade (criar, editar, mudar status, ganhar, perder, arquivar) e toda mudança de probabilidade padrão trocam a chave do cache sozinhas, então o dado nunca fica velho depois de uma escrita.
- A lista (`/crm/forecast/oportunidades`) não usa cache.
- **Depois de uma ação em massa, refaça o GET** do forecast e a lista aberta. O mesmo vale se o usuário editar uma oportunidade em outra tela e voltar. Não guarde os números em estado global duradouro: busque ao entrar na página e a cada mudança de filtro.

## 8. Como dividir o trabalho entre agentes

Decisão do dono: **o planejamento é sempre com Opus**. Tarefas críticas usam Opus em esforço médio. Tarefas simples ou repetitivas usam Haiku ou Sonnet.

**Divisão proposta para o front:**

| Agente                  | Tarefas                                                                                                                                                                                                                                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Opus (planejamento)** | Ler este documento, definir os módulos, as props e a ordem das entregas, e escrever as instruções de cada agente abaixo.                                                                                                                                                                                              |
| **Opus, esforço médio** | **Camada de dados da página:** as chamadas às três rotas, o tratamento de permissão (`veValor`, `veProbabilidade`, chaves ausentes), o tratamento de `null` (nunca virar zero) e a invalidação depois da ação em massa. **Ação em massa com seleção:** limite de 200, `ignoradas` com motivo em texto, refazer o GET. |
| **Sonnet**              | **Gráfico** de barras empilhadas com marcador de melhor caso, **tabela paginada** do mês e dos blocos, **cards dos blocos**, estados vazio e de aviso (`vazio`, `camposDesligados`) e os **testes de componente** (com `veValor: false`, `vazio: true` e colunas ausentes).                                           |
| **Haiku**               | **Tipos e contrato** a partir deste documento, **rótulos e textos** (motivos de `ignoradas`, avisos, estado vazio) e a **entrada no menu atrás da flag** `crm.forecast`.                                                                                                                                              |

**O resultado de cada agente é conferido antes de integrar.** Quem coordena lê o que foi entregue e roda a verificação (tipos, lint, testes) antes de juntar; confira em especial se nenhum `null` virou "R$ 0" e se o ponderado não é recalculado no front. Não integre trabalho de um agente só porque ele disse que terminou.

## 9. O que ainda não existe

- **Assertividade e snapshots** (comparar o previsto de um mês com o que se realizou): FC3. Não há histórico de previsões nesta entrega, só o retrato de agora.
- **Colunas Ciclo de vida, Cliente desde, Última compra e Oportunidades abertas** na tabela de leads: FC4.
- **Meta mensal:** não existe meta, então não há "atingimento" nem linha de meta no gráfico.
- A ação em massa só altera a **data prevista**; não muda probabilidade, valor nem status, e não limpa a data.
