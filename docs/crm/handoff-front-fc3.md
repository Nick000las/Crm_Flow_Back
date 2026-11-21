# Handoff ao front: FC3, assertividade do forecast

A assertividade responde a uma pergunta da gestão: "o que o forecast previa para aquele mês e o que de fato se vendeu?". Chega uma rota nova e uma aba na página Forecast. Não há rota para tirar snapshot: ele é automático.

Plano: [plano-execucao-formularios-forecast.md](./plano-execucao-formularios-forecast.md), marco FC3. Antes: [handoff-front-fc2.md](./handoff-front-fc2.md).

## 1. O que é

- **Snapshot:** toda segunda-feira, a partir das 6h no fuso do tenant, o sistema guarda uma foto do forecast: o mês atual e os três seguintes. O job roda de hora em hora e grava uma vez por semana. Se o worker ficou parado na segunda, grava na próxima hora em que subir, mesmo no meio da semana.
- **Escopo da foto:** todos os pipelines de vendas ativos, sem ocultos, sem filtro de responsável e sem restrição de papel. Valem as mesmas regras de escopo do forecast (oportunidade e pessoa fora do arquivo e da lixeira; pessoa anonimizada entra).
- **Comparação:** para cada mês **fechado**, vale o **primeiro snapshot tirado dentro do mês** (o da primeira segunda-feira do mês em diante). O que se previa é o **realizado até ali + o ponderado** daquele snapshot. O que se realizou é o realizado de agora do mês. A assertividade é `realizado / previsto`.
- **Imutável:** o snapshot nunca muda. Mudar a probabilidade padrão, editar a probabilidade de uma oportunidade ou reabrir uma oportunidade ganha **não altera** o que foi previsto.
- **Sem snapshot:** um mês sem nenhum snapshot (antes de ligar a flag, ou começo do uso) vem com `semDados: true`. Mostre "Sem dados ainda". O realizado desse mês continua vindo.

## 2. Rota

Fica atrás da flag `crm.forecast` e é **só da gestão** (DONO e MASTER). Envelope de sempre: `{ "success": true, "data": ... }`.

### 2.1 `GET /crm/forecast/assertividade`

Query (todos opcionais):

| Parâmetro   | Valor                                                                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `de`, `ate` | `AAAA-MM`. Só meses **fechados**. Padrão: os 6 meses antes do mês atual no fuso do tenant (`ate` = mês anterior, `de` = `ate` menos 5). Máximo de 24 meses. |

Se só `ate` vier, `de` é `ate` menos 5. Se só `de` vier, `ate` é o mês anterior ao atual.

Resposta (meses do **mais recente para o mais antigo**; todo mês do período aparece):

```json
{
  "fuso": "America/Sao_Paulo",
  "periodo": { "de": "2026-05", "ate": "2026-10" },
  "meses": [
    {
      "mes": "2026-10",
      "semDados": false,
      "snapshot": { "semana": "2026-10-05", "tiradoEm": "2026-10-05T09:00:00.000Z" },
      "previsto": 12000.5,
      "realizadoNoSnapshot": 2000,
      "ponderadoNoSnapshot": 10000.5,
      "realizado": 11000,
      "assertividade": 0.9166,
      "porResponsavel": [
        {
          "responsavelId": "uuid",
          "rotulo": "Maria",
          "previsto": 8000,
          "realizado": 7000,
          "assertividade": 0.875
        },
        {
          "responsavelId": null,
          "rotulo": "Sem responsável",
          "previsto": 4000.5,
          "realizado": 4000,
          "assertividade": 0.9999
        }
      ]
    },
    {
      "mes": "2026-09",
      "semDados": true,
      "snapshot": null,
      "previsto": null,
      "realizadoNoSnapshot": null,
      "ponderadoNoSnapshot": null,
      "realizado": 9000,
      "assertividade": null,
      "porResponsavel": []
    }
  ]
}
```

- **`previsto`** = `realizadoNoSnapshot` + `ponderadoNoSnapshot`. É o que o primeiro snapshot do mês dizia. O primeiro snapshot sai até o dia 7, e o que já tinha sido ganho até ali entra no previsto.
- **`snapshot`:** `semana` é a segunda-feira (`AAAA-MM-DD`, no fuso do tenant) da foto; `tiradoEm` é o instante em UTC (ISO).
- **`realizado`:** o realizado **de agora** do mês (ganhas pelo mês de `won_at` no fuso), com o mesmo escopo do snapshot. Vem também quando `semDados` é `true`.
- **`assertividade`** é uma **razão**, não porcentagem, com 4 casas: `0.9166` = 91,66%. Pode passar de 1 (vendeu mais do que previa). É `null` quando `previsto` é 0 ou quando `semDados` é `true`. Converta para porcentagem no front e trate `null` antes de formatar.
- **`porResponsavel`:** a união dos donos do snapshot com os que têm realizado no mês. Ordem: maior `previsto`, depois `rotulo`. Vem `[]` quando `semDados`.
  - `responsavelId: null` com `rotulo: "Sem responsável"`: oportunidades sem dono.
  - `rotulo: "Responsável removido"`: o dono existia no snapshot e não existe mais no cadastro de usuários.
  - Dono com realizado mas fora do snapshot tem `previsto: 0` e `assertividade: null`.
- Valores em reais (número, não centavos). Os valores do snapshot não sofrem máscara: a rota é só da gestão.
- Sem cache.

**Erros:**

| Status | Quando                                                                               | Campo / código                              |
| ------ | ------------------------------------------------------------------------------------ | ------------------------------------------- |
| 400    | `de` ou `ate` fora do formato `AAAA-MM`                                              | `de` / `ate`                                |
| 400    | `de` depois de `ate` ("O mês inicial precisa vir antes do final")                    | `de`                                        |
| 400    | Período com mais de 24 meses ("Escolha um período de até 24 meses")                  | `ate`                                       |
| 400    | `ate` no mês atual ou depois ("Só meses fechados: escolha um mês anterior ao atual") | `ate`                                       |
| 403    | Papel que não é DONO nem MASTER (OPERADOR)                                           | `FORBIDDEN`                                 |
| 403    | Flag `crm.forecast` desligada no tenant                                              | `FEATURE_NOT_ENABLED`, `details.featureKey` |

## 3. Acesso

- **Só gestão (DONO e MASTER).** Esconda a aba e a rota da tela para OPERADOR; a API responde 403 se ele tentar.
- Mostre a aba só com `crm.forecast` em `featuresAtivas` (`/auth/me`) **e** papel de gestão.
- Como é só a gestão, não há dinheiro `null` nesta rota: todo valor vem como número. Os únicos `null` são `assertividade`, e `snapshot`, `previsto`, `realizadoNoSnapshot` e `ponderadoNoSnapshot` quando `semDados`.

## 4. Sugestão de tela: aba "Assertividade" na página Forecast

**Aba** "Assertividade" ao lado do forecast atual, só para a gestão.

**Filtro:** período (mês inicial e final), só com meses fechados (o seletor não oferece o mês atual nem os futuros). Padrão: o que a API devolve em `periodo`. Limite de 24 meses na tela.

**Gráfico:** barras por mês fechado, com **previsto e realizado lado a lado** e a **porcentagem em cima** (`assertividade` x 100, arredondada). Mais antigo à esquerda (a API manda do mais recente para o mais antigo; inverta para o gráfico).

- Mês `semDados`: desenhe só a barra de **realizado** e o selo "Sem dados ainda" no lugar do previsto e da porcentagem.
- `assertividade` `null` com `semDados: false` (previsto 0): mostre "—".
- Cores (sugestão, deixe configurável no front): perto de 100% é bom (por exemplo, de 80% a 120%); abaixo de 80% indica forecast **otimista** (previu mais do que vendeu); acima de 120% indica forecast **pessimista** (vendeu mais do que previu). Não dependa só da cor: mostre também o número.
- Tooltip com `previsto` (e a conta: realizado no snapshot + ponderado no snapshot), `realizado` e a semana do snapshot.

**Tabela por responsável:** ao clicar numa barra, abra a tabela do mês selecionado com `porResponsavel`: responsável, previsto, realizado e assertividade (mesmas regras de `null` e de cores). "Sem responsável" e "Responsável removido" são linhas normais, só sem link para usuário.

**Como ler (texto de ajuda ao lado do gráfico):** "Em outubro, na primeira semana, o forecast previa R$ 12.000; realizou R$ 11.000 (92%)". Explique também que o previsto é uma foto tirada na primeira segunda-feira do mês e não muda depois.

**Estados:**

- Todos os meses `semDados`: mostre o realizado e uma mensagem "As previsões começam a ser guardadas toda segunda-feira. Volte depois do primeiro mês completo."
- Carregando e erro: como na página Forecast.
- Erro 403: a aba não deveria estar visível; se aparecer, esconda-a e não mostre erro cru.

**Moeda:** formate em reais. A porcentagem sai da razão da API; nunca recalcule previsto ou realizado no front.

## 5. Como dividir o trabalho entre agentes

Decisão do dono: **o planejamento é sempre com Opus**. Tarefas críticas usam Opus em esforço médio. Tarefas simples ou repetitivas usam Haiku ou Sonnet.

| Agente                  | Tarefas                                                                                                                                                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Opus (planejamento)** | Ler este documento, definir os módulos, as props e a ordem das entregas, e escrever as instruções de cada agente abaixo.                                                                                                                       |
| **Opus, esforço médio** | **Camada de dados e regras de exibição:** a chamada à rota, a porcentagem a partir da razão (4 casas, 0.9166 = 91,66%), o tratamento de `null` (nunca virar 0%), de `semDados` e do mês sem previsto, e esconder a aba e a rota para OPERADOR. |
| **Sonnet**              | **Gráfico** de barras previsto x realizado com a porcentagem em cima, **tabela por responsável** do mês selecionado, os **estados** (`semDados`, todos sem dados, carregando, erro) e os **testes de componente**.                             |
| **Haiku**               | **Tipos** a partir deste documento, **textos** (selo "Sem dados ainda", ajuda de leitura, mensagens) e a **entrada da aba atrás de papel e flag** (`crm.forecast` e DONO/MASTER).                                                              |

**O resultado de cada agente é conferido antes de integrar.** Quem coordena lê o que foi entregue e roda a verificação (tipos, lint, testes) antes de juntar; confira em especial se nenhum `null` virou "0%" ou "R$ 0", se a porcentagem é a razão x 100 e se OPERADOR não vê a aba. Não integre trabalho de um agente só porque ele disse que terminou.

## 6. O que ainda não existe

- **Snapshot por pipeline:** a foto é do tenant inteiro (todos os pipelines de vendas ativos). Não há assertividade por pipeline.
- **Meta mensal:** não existe meta, então não há "atingimento" nem linha de meta no gráfico.
- **Colunas Ciclo de vida, Cliente desde, Última compra e Oportunidades abertas** na tabela de leads: FC4.
- Não há rota para tirar ou refazer snapshot, nem para ver o snapshot de meses futuros ou do mês atual.
