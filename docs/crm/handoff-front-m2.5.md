# Handoff ao front: M2.5, Fundação comercial

O CRM passou a ter pipelines e oportunidades. Uma pessoa (lead) pode ter várias oportunidades, cada uma em um pipeline e com o próprio status. Os campos comerciais do lead agora vêm da **oportunidade principal**, escolhida pelo back.

A tabela e a ficha de leads continuam funcionando sem mudança de formato. O que muda está nas seções abaixo.

## 1. Mudanças de comportamento em `/crm/leads`

Ajuste obrigatório: o front de hoje pode quebrar em algum destes pontos.

| O que mudou                                        | O que fazer no front                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Lead sem status nasce no primeiro status aberto    | Não tratar `status: null` como estado normal                                          |
| `funil_estagio_id` e `estagio_nome` têm valor      | São o id e o nome da opção de status. Não mostrar os dois como informações diferentes |
| `status: null` no PUT é 400                        | Não oferecer "limpar status"                                                          |
| `dataConversao` fora de venda ganha é 400          | Só enviar com status de categoria `ganho`                                             |
| Reabrir venda com `dataConversao` no payload é 400 | Ao sair de ganho, não reenviar a data                                                 |
| `valor` negativo é 400                             | Validar no formulário                                                                 |
| `probabilidadeFechamento` é inteiro de 0 a 100     | Validar no formulário                                                                 |
| Ganhar preenche `data_conversao` sozinho           | Só exibir; não exigir do usuário                                                      |
| Sair de Perdido limpa `motivo_perda`               | Só exibir                                                                             |
| Editar status com a categoria em uso é 409         | Mostrar a mensagem do erro em Configurações → Listas                                  |
| Desativar o último status aberto é 409             | Mesma tela. Antes, só ganho e perdido tinham essa proteção                            |
| `CRM_SCHEMA_INCOMPATIBLE` não existe mais          | Remover o tratamento desse código, se houver                                          |

**Mesclar leads:** as oportunidades dos dois continuam existindo, e o lead mostra a principal. Remova status, valor, motivo de perda, data de conversão, probabilidade e data prevista da tela de escolha. Se vierem em `escolhas`, são ignorados.

**Histórico:** existem cinco tipos novos de evento, na categoria de ciclo de vida: `oportunidade_criada`, `oportunidade_arquivada`, `oportunidade_desarquivada`, `oportunidade_excluida` e `oportunidade_restaurada`. Trazem `detalhes.oportunidadeId` e `detalhes.pipelineId`. A troca de estágio não aparece mais como `funilEstagioId`, só como `status`.

**Importação:** a coluna "Estágio do funil" aceita o nome de um status ativo do pipeline padrão.

**Arquivos do front que citam funil ou estágio:** `modules/crm/constants.js`, `lib/colunas-export.js`, `lib/form-lead.js` e dois testes em `lib/`. Os nomes da API continuam os mesmos; confira só os pontos acima.

## 2. Tela nova: Configurações → Pipelines

Leitura para qualquer papel. Escrita só para DONO e MASTER (operador recebe 403).

| Rota                                                      | O que faz                                        |
| --------------------------------------------------------- | ------------------------------------------------ |
| `GET /crm/configuracoes/pipelines`                        | Lista pipelines com status, usos e automação     |
| `POST /crm/configuracoes/pipelines`                       | Cria: `{ nome, tipo: 'sales' \| 'service' }`     |
| `PUT /crm/configuracoes/pipelines/:id`                    | Parcial: `{ nome?, ativo?, automacao? }`         |
| `DELETE /crm/configuracoes/pipelines/:id`                 | Exclui, se nada depender dele                    |
| `POST /crm/configuracoes/pipelines/:id/status`            | Cria status: `{ label, color?, category }`       |
| `PUT /crm/configuracoes/pipelines/:id/status/ordem`       | Reordena: `{ ids }`, com todos os status         |
| `PUT /crm/configuracoes/pipelines/:id/status/:opcaoId`    | Parcial: `{ label?, color?, category?, ativo? }` |
| `DELETE /crm/configuracoes/pipelines/:id/status/:opcaoId` | Exclui, se não estiver em uso                    |

Formato de cada item do `GET`:

```json
{
  "id": "uuid",
  "nome": "Atendimento",
  "tipo": "service",
  "position": 1,
  "padrao": false,
  "ativo": true,
  "oportunidades": 12,
  "automacao": {
    "ativa": true,
    "origemId": "uuid do pipeline de vendas",
    "statusInicial": "aguardando",
    "regraDoDono": "person_owner",
    "donoId": null
  },
  "status": [
    {
      "id": "uuid",
      "key": "aguardando",
      "label": "Aguardando início",
      "color": "#3B82F6",
      "position": 0,
      "category": "aberto",
      "ativo": true,
      "usos": 3
    }
  ]
}
```

**Regras que a tela precisa refletir:**

- O limite é de 5 pipelines, contando Vendas e Atendimento. O sexto dá 400 em `fields.pipeline`.
- Pipeline novo nasce com uma lista inicial. Vendas: Novo, Ganho e Perdido. Atendimento: Aguardando início, Em atendimento, Concluído e Cancelado.
- O pipeline padrão não desativa nem exclui (409).
- Excluir dá 409 se houver oportunidade, inclusive arquivada ou na lixeira, ou se outro pipeline nascer dele. Com oportunidades, a saída é desativar.
- Pipeline inativo mantém as oportunidades, mas não aceita novas.
- Automação existe só em pipeline `service`; em `sales` dá 400.
- `regraDoDono` aceita `person_owner`, `specific_user` (exige `donoId`) e `none`.
- Com a automação ligada, erros vêm em `fields['automacao.origemId']`, `fields['automacao.statusInicial']` e `fields['automacao.donoId']`.
- Excluir status ou mudar a categoria dá 409 se `usos > 0`.
- Cada pipeline precisa manter um status ativo de cada categoria: aberto, ganho e perdido.
- Os dias de "lead esfriando" continuam configurados só para o pipeline padrão.

## 3. Tela nova: aba Oportunidades na ficha

| Rota                                  | O que faz                                                   |
| ------------------------------------- | ----------------------------------------------------------- |
| `GET /crm/leads/:id/oportunidades`    | Lista, mais nova primeiro; inclui arquivadas, sem a lixeira |
| `POST /crm/leads/:id/oportunidades`   | Cria                                                        |
| `PUT /crm/oportunidades/:id`          | Edita; `expectedUpdatedAt` é obrigatório                    |
| `PATCH /crm/oportunidades/:id/status` | Muda o status; é assim que se ganha, perde e reabre         |

Corpo do `POST`, tudo opcional. Sem pipeline, entra no padrão; sem status, no primeiro aberto:

```json
{
  "pipelineId": "uuid",
  "status": "proposta",
  "titulo": "Reforma da loja",
  "valor": 1500,
  "probabilidadeFechamento": 40,
  "dataPrevistaFechamento": "2026-12-20",
  "motivoPerda": null,
  "responsavelId": "uuid"
}
```

Corpo do `PUT`: `titulo`, `valor`, `probabilidadeFechamento`, `dataPrevistaFechamento` e `responsavelId`, mais `expectedUpdatedAt`. Omitir mantém; `null` limpa.

Corpo do `PATCH`: `{ status, motivoPerda?, expectedUpdatedAt? }`.

Formato da oportunidade:

```json
{
  "id": "uuid",
  "leadId": "uuid",
  "pipelineId": "uuid",
  "origemId": null,
  "titulo": "Reforma da loja",
  "status": "proposta",
  "categoria": "aberto",
  "valor": 1500,
  "probabilidadeFechamento": 40,
  "dataPrevistaFechamento": "2026-12-20T00:00:00.000Z",
  "ganhaEm": null,
  "perdidaEm": null,
  "motivoPerda": null,
  "responsavelId": "uuid",
  "origemReabertaEm": null,
  "arquivadaEm": null,
  "criadaEm": "2026-11-06T12:00:00.000Z",
  "atualizadaEm": "2026-11-06T12:00:00.000Z"
}
```

**Comportamentos que a tela precisa tratar:**

- **Conflito no `PUT`:** versão antiga dá 409, com o estado atual em `error.details.atual`. Mostre o aviso e recarregue a partir dele.
- **Conflito no `PATCH`:** a gravação acontece, e a resposta traz `conflito: true`. Mostre um aviso de que outra pessoa mexeu antes.
- **Envie em `expectedUpdatedAt`** o `atualizadaEm` recebido na última leitura.
- **Regras do tenant:** faltar campo obrigatório dá 400 com `code: CAMPOS_OBRIGATORIOS` e os campos em `fields`. A regra "Perdido exige Motivo" vale para toda categoria `perdido`, inclusive "Cancelado" em Atendimento.
- **Permissão por campo:** campo desligado ou oculto some da resposta, então trate a chave como opcional. Campo "só ver" no payload dá 403. Se `status` estiver oculto, somem também `categoria`, `ganhaEm` e `perdidaEm`.
- **Oportunidade arquivada:** status e edição dão 409. Ainda não há rota para arquivar, restaurar ou mandar para a lixeira: isso chega no M3, com o quadro.
- **Lead anonimizado:** alterar a oportunidade dá 409.
- **`origemReabertaEm`:** a venda que originou o atendimento foi reaberta. Vale mostrar um aviso no card.
- **Venda ganha:** cria sozinha um card em Atendimento, se a automação estiver ligada. Recarregue a lista depois de ganhar.
- **Segunda venda (D6):** ainda não existe. Por enquanto, cada venda ganha cria o próprio card de atendimento.

Para os nomes dos pipelines e os rótulos dos status, use `GET /crm/configuracoes/pipelines`, que está liberado para todos os papéis.

## 4. O que ainda não existe

Quadro comercial no Kanban (M3), ordenação e filtros do quadro (M4), tempo real (M5), formulários e segunda venda.
