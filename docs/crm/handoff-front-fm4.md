# Handoff ao front: FM4, envio da resposta e "Ver respostas"

Duas telas mudam:

- **Página pública** (`/f/:token`): passa a ter o botão de enviar.
- **Ficha da pessoa:** mostra as respostas recebidas. Para cada campo do CRM, mostra o que foi gravado, o que foi ignorado e o que ficou para revisão.

Plano: [plano-execucao-formularios-forecast.md](./plano-execucao-formularios-forecast.md), marco FM4. Antes: [handoff-front-fm3.md](./handoff-front-fm3.md) (página pública).

## 1. Página pública: enviar

```
POST /public/f/:token/respostas      (sem Authorization)
{
  "respostas": { "<campoId ou pergunta.id>": valor, ... },
  "aceite": true,
  "preenchidoPor": "titular" | "responsavel",
  "nomeResponsavel": "Joana Souza"      // obrigatório quando "responsavel"
}
```

- **Chaves:** item de campo usa o `campoId`; item de pergunta usa o `pergunta.id`, ambos vindos do `GET`.
- **Valores:** no formato dos campos do CRM, iguais aos da ficha.
  - Texto vai como string.
  - `booleano` vai como `true` ou `false`.
  - `selecao` vai como a `key` da opção (ou o texto da opção, se a pergunta não tem `opcoesLista`), e `selecao_multipla` como uma lista delas.
  - `data` vai como data ISO.
  - `endereco` e `intervalo_datas` vão como objeto, como na ficha.
- **Campo vazio:** mande vazio ou omita. Ele nunca apaga o que a pessoa já tem.
- **Termo:** mostre o `termo` e um checkbox de aceite. Sem `aceite: true`, a resposta é 400.
- **Quem preenche:** pergunte "Quem está preenchendo?" com as opções "Eu mesmo" e "Responsável", e peça o nome do responsável quando for o caso. Isso serve para menor de idade.

**Respostas:**

| Status                    | Mostrar                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 201 `{ "enviado": true }` | tela de agradecimento; o link não abre mais                                                                                                 |
| 400 com `fields`          | erros em `respostas.<chave>`, `aceite` e `nomeResponsavel`, cada um no seu campo. O link continua valendo: a pessoa corrige e envia de novo |
| 404                       | "Este link não está mais disponível" (vencido, cancelado ou já respondido)                                                                  |
| 429                       | "Muitas tentativas", com `Retry-After`                                                                                                      |

- **Clique duplo:** grava uma resposta só, e o segundo envio recebe 404. Mesmo assim, desabilite o botão durante o envio.
- **Prazo:** quem abriu o link antes de vencer tem até 2 horas depois do vencimento para enviar e para recarregar a página. Por isso é importante chamar o `POST /aberto`.

## 2. Ficha: "Ver respostas"

| Rota                                                   | Uso                                                  |
| ------------------------------------------------------ | ---------------------------------------------------- |
| `GET /crm/leads/:id/formularios/respostas`             | respostas da pessoa, da mais nova para a mais antiga |
| `GET /crm/leads/:id/formularios/respostas/:respostaId` | uma resposta, como foi enviada                       |

As duas ficam atrás da flag `crm.formularios` e valem para qualquer papel que vê a pessoa. Na lista de links (FM2), o link respondido traz `status: "submitted"` e `respondidoEm`. O botão "Ver respostas" desse link abre a resposta que tem o mesmo `linkId`.

### Lista

```json
{
  "id": "uuid",
  "formulario": { "id": "uuid", "nome": "Anamnese" },
  "versao": { "id": "uuid", "versao": 2 },
  "linkId": "uuid",
  "oportunidadeId": null,
  "preenchidoPor": "titular",
  "nomeResponsavel": null,
  "respondidoEm": "...",
  "escrita": { "gravados": 2, "ignorados": 2, "revisao": 1 }
}
```

Quando `escrita.revisao > 0`, mostre um selo "Revisar".

### Detalhe

O detalhe traz o mesmo resumo da lista, mais `termo`, `aceitoEm` e as `secoes` na versão que a pessoa viu:

```json
{
  "campoId": "uuid",
  "campo": { "label": "E-mail", "tipo": "email", "opcoes": null },
  "valor": "outro@exemplo.com",
  "escrita": { "resultado": "revisao", "motivo": "valor_diferente" }
}
```

```json
{
  "pergunta": { "id": "uuid", "rotulo": "Fuma?", "tipo": "booleano", "opcoes": null },
  "valor": true
}
```

- **O que aparece:** é o que a pessoa **declarou**. Editar a ficha depois não muda a resposta.
- **Oculto:** um item com `oculto: true` vem sem `valor`. Mostre "Restrito", sem o valor. Isso acontece com campo que o papel não vê e com pergunta sensível para quem não é da gestão.
- **Origem:** só a gestão recebe `origem: { ip, navegador }`.

### `escrita` em cada campo do CRM

| `resultado` | `motivo`                  | Mostrar                                                                            |
| ----------- | ------------------------- | ---------------------------------------------------------------------------------- |
| `gravado`   | —                         | "Atualizado na ficha"                                                              |
| `ignorado`  | `igual`                   | "Igual ao que já estava"                                                           |
| `ignorado`  | `sem_resposta`            | "Não respondido"                                                                   |
| `revisao`   | `valor_diferente`         | "A pessoa informou um valor diferente do que está salvo" + botão "Usar este valor" |
| `revisao`   | `contato_de_outra_pessoa` | "Este contato já é de outra pessoa"                                                |
| `revisao`   | `regra_do_crm`            | "Uma regra do CRM impediu a gravação (ex.: campo obrigatório)"                     |
| `revisao`   | `campo_indisponivel`      | "O campo foi desligado depois da publicação"                                       |

- **"Usar este valor":** use a edição normal do lead (`PUT /crm/leads/:id`) com o `valor` da resposta. A resposta não muda: ela continua registrando o que a pessoa declarou.
- **Pergunta própria:** não tem `escrita`, porque a resposta dela fica só no formulário.

## 3. Histórico da pessoa

Dois tipos de evento chegam ao histórico:

- **`formulario_respondido`:** autor nulo, com `detalhes: { formularioId, formularioNome, respostaId }`. Mostre "Respondeu o formulário Anamnese", com link para a resposta.
- **`atualizado`:** quando a resposta gravou campos, vem um evento com `detalhes.origem: "formulario"`. Mostre "Atualizado pelo formulário" no lugar do nome do autor.

## 4. O que ainda não existe

Os alertas por resposta são da FM5. Apagar respostas ao anonimizar é da FM6.
