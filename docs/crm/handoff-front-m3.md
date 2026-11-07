# Handoff ao front: M3, quadro comercial

Cada pipeline ativo do CRM agora é um quadro no Kanban: cada status é uma coluna, e cada oportunidade é um card. Tudo é lido do CRM a cada consulta. O quadro fica atrás de duas flags, que precisam estar ligadas: `crm.quadro_comercial` e `kanban_universal.quadros_entidade`.

Base do front: o [handoff do M2.5](./handoff-front-m2.5.md) e o handoff do M2, com as rotas de quadro de entidade.

## 1. Mudanças em telas que já existem

**Valor virou campo do sistema.** Agora aparece em `GET /crm/leads/fields`, em Configurações → Campos e em Permissões.

- Se o formulário de lead monta os campos pela lista e também tem um campo Valor fixo, tire o fixo para não duplicar.
- `valor` pode não vir na resposta: fica oculto para o papel, e nesse caso a chave não existe. Isso vale para `/crm/leads` e para as oportunidades.
- Com `valor` oculto, `valorMin` e `valorMax` na busca dão 400, e `valor` no payload dá 403. Esconda esses controles.
- Tipo do campo: `monetario`.

**Layout:** o Valor continua sendo a referência `lead.valor`. O id do campo Valor não é aceito no layout, para não repetir o dado.

**Edição de lead:** `PUT /crm/leads/:id` aceita `expectedUpdatedAt` opcional, com o `updated_at` da última leitura. Com versão antiga, dá 409 e traz o lead atual em `error.details.atual`. Envie sempre na ficha.

**Importação:** `valor` deixou de ser coluna extra e veio para a lista normal de campos mapeáveis.

## 2. Tela nova: quadro

Os quadros aparecem em `GET /kanban/boards` com `modo: 'entidade'`, `boardType: 'crm_oportunidades'` e `quadroRef`, que é o id do pipeline. Rotas, sempre sob `/kanban/quadros/crm_oportunidades/:quadroRef`:

| Rota                             | O que faz                                              |
| -------------------------------- | ------------------------------------------------------ |
| `GET /colunas`                   | Colunas na ordem do pipeline                           |
| `POST /cards/busca`              | Página de uma coluna: `{ colunaRef, limite, cursor? }` |
| `POST /resumo`                   | Total e soma: `{ colunaRef }`                          |
| `POST /cards`                    | Cria: `{ colunaRef, dados }`                           |
| `GET /cards/:entidadeId/acoes`   | Ações do card; é uma requisição por card               |
| `PATCH /cards/:entidadeId/mover` | Move: `{ colunaDestino, expectedUpdatedAt? }`          |

**Coluna:** `{ ref, nome, cor, categoria, ativa }`. `ativa: false` é um status desativado que ainda tem cards. Mostre a coluna, mas não ofereça como destino. A estrutura não se edita no quadro: para o DONO, mostre o atalho "Editar estrutura", que abre Configurações → Pipelines.

**Card:**

```json
{
  "entidadeId": "uuid da oportunidade",
  "atualizadoEm": "2026-11-06T12:00:00.000Z",
  "leadId": "uuid",
  "titulo": "Ana Souza",
  "subtitulo": [
    { "ref": "...", "chave": "empresa", "label": "Empresa", "tipo": "texto", "valor": "Acme" }
  ],
  "destaques": [
    { "ref": "lead.valor", "chave": "valor", "label": "Valor", "tipo": "monetario", "valor": 1500 }
  ],
  "selos": [{ "tipo": "esfriando", "desde": "2026-11-01T12:00:00.000Z" }],
  "tituloOportunidade": "Reforma da loja",
  "responsavelId": "uuid",
  "rotaFicha": "/crm/oportunidades/uuid"
}
```

- `titulo`, `subtitulo` e `destaques` seguem o Layout do CRM, já com as permissões do papel.
- `selos.tipo`: `esfriando` ou `origem_reaberta`. O segundo aparece em card de atendimento cuja venda foi reaberta.
- Card sem descrição vem com `restrito: true`. Mostre "Registro restrito".
- **Abrir o card** abre a ficha completa do lead, pelo `leadId`, com a aba Oportunidades. Comentários ficam ocultos em card de pipeline.

**Mover:**

- Atualização otimista, com rollback e aviso em caso de erro.
- Com `CAMPOS_OBRIGATORIOS` (400), volte o card e abra um formulário com os campos de `error.fields`. Ao confirmar, grave cada campo na rota dele e só então repita a mudança de status:

  | Campo                                                        | Rota                                                                 |
  | ------------------------------------------------------------ | -------------------------------------------------------------------- |
  | `motivoPerda`                                                | `PATCH /crm/oportunidades/:id/status`, junto com o status de destino |
  | `valor`, `probabilidadeFechamento`, `dataPrevistaFechamento` | `PUT /crm/oportunidades/:id`, com `expectedUpdatedAt`                |
  | Contato, `usuarioResponsavelId` e `customFields`             | `PUT /crm/leads/:id`, com o `leadId` do card                         |
  - Não mande comercial por `PUT /crm/leads/:id`: ele grava na oportunidade principal, que pode não ser a do card.
  - Campos personalizados chegam todos numa só chave, `customFields`, com a mensagem de um deles, que traz o nome do campo. Se faltar mais de um, o `PATCH` volta com o próximo: reabra o formulário.
  - `dataConversao` nunca vem nessa lista quando o card vai para Ganho: ganhar preenche a data.

- Com `conflito: true` na resposta, a gravação aconteceu. Mostre que outra pessoa mexeu antes.
- O card só se move dentro do próprio pipeline; não existe arrastar entre quadros.
- Quem não edita o campo Status não arrasta: use a permissão do papel para desabilitar o arraste no quadro todo. Não chame `/acoes` por card na listagem.
- Card de pessoa anonimizada aparece no quadro, mas não se move: o arraste dá 403. Volte o card e mostre o aviso.

**Resumo:** `soma` vem `null` para quem não vê Valor. Não mostre "R$ 0,00" nesse caso.

**Criar na coluna**, em `dados`:

- Pessoa existente: `{ leadId, titulo?, valor?, probabilidadeFechamento?, dataPrevistaFechamento?, responsavelId? }`. Busque antes por `POST /crm/leads/search`.
- Pessoa nova: os campos do formulário de Novo lead. Ela nasce só neste pipeline. A resposta traz `{ entidadeId, colunaRef, leadId }`.
- Duplicidade: pessoa nova pode dar 409 `DUPLICATE_WARNING`, como no formulário. Reenvie com `ignorarDuplicados: true` para confirmar.

## 3. Arquivar e lixeira da oportunidade

Todas sem corpo, e respondem a oportunidade:

- `POST /crm/oportunidades/:id/arquivar`
- `POST /crm/oportunidades/:id/desarquivar`
- `POST /crm/oportunidades/:id/excluir`
- `POST /crm/oportunidades/:id/restaurar`

`GET /crm/leads/:id/oportunidades?situacao=lixeira` lista as excluídas. Não existe "excluir card" de vez. Arquivadas seguem na lista normal da aba, com `arquivadaEm` preenchido. Card de pessoa arquivada também sai do quadro.

## 4. Configurações → Pipelines: visibilidade

`PUT /crm/configuracoes/pipelines/:id` aceita `visivelOperador: boolean`, e o `GET` devolve o mesmo nome. Vale só para OPERADOR; DONO e MASTER veem tudo.

Mostre um aviso ao ocultar o pipeline padrão: o que o OPERADOR criar nele deixa de aparecer para ele, se a pessoa não tiver outra oportunidade visível.

Para o OPERADOR, com pipeline oculto:

- O pipeline some de `/kanban/boards` e de `GET /crm/configuracoes/pipelines`.
- Pessoa só com oportunidades ocultas dá 404 em tudo e não aparece na busca.
- Pessoa com oportunidade visível aparece. Se a principal estiver oculta, `status`, `valor` e os demais campos comerciais vêm `null`, e a aba lista só as visíveis.
- Nesse último caso, editar campo comercial pelo lead dá 409. O contato continua editável. Trate `status: null` como "sem acesso", não como erro.

## 5. O que ainda não existe

Filtros e ordenação escolhida no quadro (M4), tempo real (M5), alerta de formulário no card e contador de sessões (formulários, depois do M5).
