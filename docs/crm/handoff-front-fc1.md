# Handoff ao front: FC1, probabilidade padrão por status

Cada status passa a ter uma **probabilidade padrão** (Novo 10%, Em contato 20%, Qualificado 40%, Proposta 60%, Negociação 80%; ganho é sempre 100% e perdido sempre 0%). A oportunidade usa a probabilidade dela, se tiver uma, e a do status, se não tiver. Quando o status muda, a probabilidade própria da oportunidade é apagada e volta a valer a do novo status, com um aviso. É a base do forecast ponderado, que chega na FC2.

Plano: [plano-execucao-formularios-forecast.md](./plano-execucao-formularios-forecast.md), marco FC1. Antes: [handoff-front-fm6.md](./handoff-front-fm6.md).

## 1. Flag `crm.forecast`

- A flag nova aparece em `featuresAtivas` (`/auth/me`). A página Forecast só chega na FC2. Nesta entrega, a flag só muda os campos do próximo ponto.
- **Ligar a flag liga os campos** "Data prevista de fechamento" e "Probabilidade de fechamento" em todos os contextos: tabela, filtro, ficha e formulário de criação. Antes, eles nasciam desligados.
- **Desligar a flag não desliga os campos.** O dono continua podendo ligá-los e desligá-los em Configurações → Campos.

## 2. Configurações → Pipelines → status

Cada status em `GET /crm/configuracoes/pipelines` (`status[]`) ganha `probabilidadePadrao`:

```json
{
  "id": "uuid",
  "key": "proposta",
  "label": "Proposta",
  "category": "aberto",
  "ativo": true,
  "probabilidadePadrao": 60,
  "usos": 3
}
```

- **Onde mais aparece:** o mesmo campo vem nas opções de status de `/crm/configuracoes/listas` e de `/fields` (`listas.status`). Nas outras listas ele vem `null`.
- **Criar** (`POST .../pipelines/:id/status`) e **editar** (`PUT .../pipelines/:id/status/:opcaoId`) aceitam `probabilidadePadrao`, um inteiro de 0 a 100. Só a gestão (DONO e MASTER) pode.
- **Criar sem o valor:** um status aberto nasce com a sugestão pela chave (por exemplo, "Negociação" nasce com 80) ou com 10. Ganho nasce com 100 e perdido com 0.
- **Ganho e perdido são fixos.** Mandar um valor diferente de 100 ou 0 dá 400 em `probabilidadePadrao`. Na tela, mostre o valor desses dois sem deixar editar.
- **Mudar a categoria** (quando é permitido) acerta o valor sozinho: vira 100 ou 0, e um status que volta a ser aberto recebe a sugestão. Se a probabilidade for mandada junto, vale a mandada.

**Sugestão de tela:** uma coluna "Probabilidade" na lista de status do pipeline, com um campo numérico e "%". Ajuda do campo: "Usada no forecast quando a oportunidade não tem probabilidade própria."

## 3. Oportunidade: `probabilidadeEfetiva`

As respostas de oportunidade (`GET /crm/leads/:id/oportunidades`, `POST`, `PUT` e `PATCH .../status`) ganham:

```json
{
  "probabilidadeFechamento": null,
  "probabilidadeEfetiva": 60
}
```

- **`probabilidadeFechamento`** é a probabilidade própria da oportunidade, e vem `null` quando ela não tem uma.
- **`probabilidadeEfetiva`** é a que vale: a própria, ou a padrão do status.
- **Permissão:** as duas chaves seguem a permissão do campo Probabilidade. Se o campo estiver desligado ou oculto para o papel, as duas somem.

**Sugestão de tela:** mostre a efetiva. Quando a própria vier `null`, acrescente "(padrão do status)" em cinza. Ao editar, campo vazio quer dizer "usar a do status".

## 4. Mudar o status volta a probabilidade ao padrão

Quando o status de uma oportunidade com probabilidade própria muda, a própria é apagada e a resposta avisa:

```json
"avisos": [
  { "codigo": "PROBABILIDADE_REDEFINIDA", "campo": "probabilidadeFechamento", "anterior": 60 }
]
```

| Onde                                                                                              | Onde vem `avisos`                                       |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `PATCH /crm/oportunidades/:id/status`                                                             | na oportunidade devolvida                               |
| Mover no quadro comercial (`PATCH /kanban/quadros/:boardType/:quadroRef/cards/:entidadeId/mover`) | no resultado do mover, ao lado de `conflito`            |
| `PUT /crm/leads/:id` com `status` (tabela, ficha)                                                 | no lead devolvido; edição que não muda status traz `[]` |

- **Sempre vem uma lista.** Ela vem vazia quando não houve aviso, e também para quem não vê o campo Probabilidade, porque o aviso traz o valor anterior.
- **Texto do aviso:** "A probabilidade voltou ao padrão do status (X%). Antes era Y%." O X é a `probabilidadeEfetiva` da resposta (no quadro, a do status de destino). O Y é o `anterior`.
- **Mandar junto, para manter:** para trocar o status e manter (ou escolher) uma probabilidade, mande `probabilidadeFechamento` na mesma chamada. Então não há aviso.
  - No `PATCH .../status`, mande no corpo: `{ "status": "proposta", "probabilidadeFechamento": 35 }`.
  - No mover do quadro, mande em `campos`: `{ "campos": { "probabilidadeFechamento": 35 } }`.
  - No `PUT /crm/leads/:id`, mande com o `status`.
- **Formulário "Falta preencher para mover":** se `probabilidadeFechamento` estiver entre os campos que faltam, mande-a em `campos` no mover, como o motivo da perda. **Não** grave a probabilidade antes, pela rota da oportunidade, para depois mover: a mudança de status a apagaria e o mover falharia de novo.
- **Mudar entre dois status da mesma categoria** também volta ao padrão: Proposta → Negociação conta, assim como Ganho → outro status de ganho.
- **Mover para o mesmo status** não muda nada.

## 5. O que não muda

- Os campos, as regras e o quadro continuam iguais para quem não usa probabilidade própria.
- `PUT /crm/oportunidades/:id` não muda status, então não tem aviso. Editar a probabilidade por ele continua igual.
- Ainda não há página Forecast, gráfico nem lista do forecast: isso é a FC2.
