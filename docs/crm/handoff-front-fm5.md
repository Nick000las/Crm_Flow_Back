# Handoff ao front: FM5, alertas do formulário

O dono configura alertas no formulário, por exemplo "Alergias contém dipirona → Crítico: Alergia a dipirona". Quando a resposta da pessoa casa com a regra, ela ganha um alerta. O alerta aparece no **topo da ficha** e como **selo no card** do quadro comercial, até cada usuário marcá-lo como visto.

Plano: [plano-execucao-formularios-forecast.md](./plano-execucao-formularios-forecast.md), marco FM5. Antes: [handoff-front-fm4.md](./handoff-front-fm4.md).

**Decisões do dono:**

- O alerta aparece na ficha e no card.
- "Visto" é **por usuário**: marcar só tira o alerta para quem marcou.
- São três níveis: `info` (Informativo), `warning` (Atenção) e `critical` (Crítico).

## 1. Configurar alertas (tela de montar o formulário)

O rascunho ganha `alertas`, ao lado de `secoes`, e é salvo pelo mesmo `PUT /crm/configuracoes/formularios/:id`:

```json
"alertas": [
  {
    "id": "uuid",
    "alvo": { "campoId": "uuid" },
    "operador": "contem",
    "valor": "dipirona",
    "nivel": "critical",
    "texto": "Alergia a dipirona"
  },
  {
    "alvo": { "perguntaId": "uuid" },
    "operador": "igual",
    "valor": true,
    "nivel": "warning",
    "texto": "Fumante"
  }
]
```

- **Alvo:** um campo (`campoId`) ou uma pergunta (`perguntaId`) que **já está no rascunho**. Para fazer um alerta sobre uma pergunta nova, salve o rascunho primeiro, para a pergunta ganhar o `id`, e depois crie o alerta.
- **Operadores:** os mesmos do filtro do CRM, conforme o tipo do alvo (a lista `OPERADORES_POR_TIPO` que o filtro já usa): `igual`, `contem`, `e_um_dos`, `entre`, `vazio`, `nao_vazio`.
- **Valor:** segue o tipo do alvo.
  - `igual` usa um valor do tipo; em seleção, a opção.
  - `contem` usa um texto; em seleção múltipla, uma opção.
  - `e_um_dos` usa uma lista.
  - `entre` usa `{ "de": ..., "ate": ... }`, com pelo menos um dos dois.
  - `vazio` e `nao_vazio` não levam valor.
- **Id do alerta:** sem `id`, o servidor gera um. Mande de volta o `id` que a API devolve.
- **Limites:** até 30 alertas por formulário e 300 caracteres por texto.
- **Publicação:** o alerta vai junto com a versão. Um link já enviado usa os alertas da versão dele.
- **Versão:** a versão (`POST .../publicar` e `GET .../versoes/:versaoId`) devolve `alertas`.

**Erros (400):**

| Caminho                         | Quando                                                                   |
| ------------------------------- | ------------------------------------------------------------------------ |
| `rascunho.alertas.<i>.alvo`     | o alvo não está no rascunho, inclusive quando o item foi removido depois |
| `rascunho.alertas.<i>.operador` | o operador não vale para o tipo, ou o valor é inválido                   |
| `rascunho.alertas.<i>.id`       | o mesmo alerta aparece duas vezes                                        |

**Sugestão de tela:** uma seção "Alertas" com a frase "Quando [campo ou pergunta] [operador] [valor], mostrar [nível]: [texto]".

## 2. Ficha: topo

| Rota                                                      | Uso                                                                                                  |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `GET /crm/leads/:id/formularios/alertas`                  | os alertas que **eu** ainda não vi, do mais grave para o mais leve e do mais novo para o mais antigo |
| `GET /crm/leads/:id/formularios/alertas?todos=true`       | também os que já vi, com `vistoEm`                                                                   |
| `POST /crm/leads/:id/formularios/alertas/:alertaId/visto` | marcar como visto, só para mim. Repetir não muda nada                                                |

```json
{
  "id": "uuid",
  "nivel": "critical",
  "texto": "Alergia a dipirona",
  "generico": false,
  "formulario": { "id": "uuid", "nome": "Anamnese" },
  "respostaId": "uuid",
  "criadoEm": "...",
  "vistoEm": null
}
```

- **Restrito:** quando `generico` vem `true`, o usuário não pode ver o alvo (um campo sensível, ou uma pergunta sensível para quem não é da gestão). Nesse caso o `texto` vem genérico ("Há um alerta restrito nesta pessoa. Fale com a gestão."). Mostre o nível e esse texto, sem link para a resposta.
- **Cores:** `critical` em vermelho, `warning` em amarelo e `info` em azul.
- **Ver resposta:** o alerta pode ter um link "Ver resposta" que abre `GET /crm/leads/:id/formularios/respostas/:respostaId`, que já esconde o que o papel não vê.

## 3. Card do quadro comercial

O card ganha um selo novo em `selos`:

```json
{ "tipo": "alerta_formulario", "nivel": "critical" }
```

- **Nível:** é o mais grave entre os alertas que **quem está vendo** ainda não marcou. Ele nunca traz o texto.
- **Quando some:** o selo desaparece quando o usuário marca todos os alertas da pessoa como vistos. Depois de marcar na ficha, recarregue os cards dessa pessoa.
- **Tempo real:** um alerta novo chega pelo tempo real do quadro, como qualquer mudança na pessoa.
- **Flag:** só aparece com `crm.formularios` ligada.

## 4. O que ainda não existe

Apagar os alertas e as respostas ao anonimizar, e levá-los junto ao mesclar pessoas, é da FM6.
