# Handoff ao front: M4, filtros, ordem e escala

O quadro comercial agora filtra, busca e ordena no servidor. Nada de filtrar no navegador, e o filtro do quadro não vai para o `localStorage`.

Base do front: o [handoff do M3](./handoff-front-m3.md).

## 1. Filtros

`POST /cards/busca` e `POST /resumo` aceitam `filtros`, no **mesmo formato** de `POST /crm/leads/search` e de `crm_filter_views.filtros`, sem a `paginacao`:

```json
{
  "colunaRef": "novo",
  "limite": 50,
  "filtros": { "busca": "ana", "valorMin": 1000, "filtros": [] }
}
```

- **View salva:** envie o `filtros` da view como está. A mesma view vale na tabela e no quadro.
- **Busca:** nome, e-mail, telefone e identificador do layout.
- **Totais:** envie os mesmos `filtros` no `/resumo`, senão total e soma não batem com o que está na tela.
- Filtro inválido dá 400, como na busca de leads.

Três diferenças em relação à tabela, de propósito:

- `valor`, `status` e os demais campos comerciais comparam a **própria oportunidade**, não a principal da pessoa.
- `usuarioResponsavelId` e `semResponsavel` comparam o **responsável da oportunidade**, que é o que o card mostra.
- `situacao` é ignorada: o quadro só tem cards ativos.

## 2. Ordem

`POST /cards/busca` aceita `ordem`:

```json
{ "colunaRef": "novo", "ordem": { "campo": "valor", "direcao": "desc" } }
```

| `campo`                   | Rótulo sugerido    | Exige ver o campo |
| ------------------------- | ------------------ | ----------------- |
| `atualizadoEm` (padrão)   | Última atualização | Não               |
| `criadoEm`                | Data de criação    | Não               |
| `nome`                    | Nome               | Não               |
| `valor`                   | Valor              | Sim               |
| `dataPrevistaFechamento`  | Data prevista      | Sim               |
| `probabilidadeFechamento` | Probabilidade      | Sim               |

- `direcao`: `asc` ou `desc`. Sem `ordem`, vale `atualizadoEm` em `desc`.
- Registro sem valor no campo fica sempre por último, nas duas direções.
- Mostre no seletor só os campos que estão em `GET /crm/leads/fields`, além dos três livres. Campo oculto ou desligado dá 400.
- Salve a escolha no `localStorage`, por quadro. Não há evento de uso (D8).
- Essa lista vale só para o quadro. A tabela de leads segue ordenada por criação.

## 3. Cursor

- O cursor agora é opaco: não leia nem monte. Envie o `proximoCursor` de volta como veio.
- Ele vale só para a ordem em que nasceu. Trocou a ordem ou o filtro, recomece sem cursor.
- Cursor inválido ou de outra ordem dá 400.

## 4. Arrastar com filtro ativo (D1)

Envie no `mover` o filtro que está na tela:

```json
{ "colunaDestino": "proposta", "filtros": { "busca": "ana" } }
```

- A resposta traz `saiuDoFiltro`.
- Com `true`, tire o card da tela e mostre o aviso: "Movido. Não aparece no filtro atual."
- Filtro inválido dá 400, e o card não se move.
- Sem `filtros`, `saiuDoFiltro` vem `false`.

**Formulário de `CAMPOS_OBRIGATORIOS`:** a última gravação agora é o próprio `mover`, repetido com os `filtros` e com o motivo em `campos`. Assim a resposta traz `saiuDoFiltro`, e o aviso neutro não é mais necessário:

```json
{
  "colunaDestino": "perdido",
  "filtros": { "busca": "ana" },
  "campos": { "motivoPerda": "Preço" }
}
```

`campos` aceita só `motivoPerda`; outra chave dá 400. Os demais campos do formulário continuam indo antes, pelas rotas da tabela do handoff do M3.

## 5. `podeMover`

Cada card agora traz `podeMover: boolean`. Use esse campo para travar o arraste. Ele cobre permissão do campo Status, pessoa anonimizada e oportunidade arquivada. Isso substitui a orientação do M3: não é preciso olhar a permissão do papel nem tratar o 403 de pessoa anonimizada como caso normal. O `/acoes` continua existindo, mas não precisa ser chamado na listagem.

## 6. Ao abrir o quadro

Peça `/resumo` e `/cards/busca` das colunas visíveis. Cada coluna custa duas requisições, então evite pedir de novo o que já está na tela e use debounce na digitação da busca.

## 7. O que depende da sua tela para fechar o M4

- Aviso de card fora do filtro.
- Core Web Vitals no p75 com 20 mil oportunidades: LCP ≤ 2,5 s, INP ≤ 200 ms, TTFB ≤ 800 ms. Só dá para medir com a tela no ar.
