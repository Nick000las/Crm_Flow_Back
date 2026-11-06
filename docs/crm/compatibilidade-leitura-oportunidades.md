# Leitura de leads sobre oportunidades

**Situação em 06/11/2026 (M2.5, F5):** existe um modelo só. Os campos comerciais
moram em `crm_deal`, e `funil_estagios` e as colunas comerciais de `leads` foram
apagados pela migration 0039. O schema antigo está em
[`referencia-schema-0030-0034.sql`](./referencia-schema-0030-0034.sql), só como
referência histórica.

`adapters/crm-lead-read-model.js` concentra a leitura em `FONTE_LEADS`.

## Contrato da busca e do detalhe

O contato vem de `leads`. O contexto comercial vem exclusivamente da oportunidade
principal (`leads.principal_deal_id`), com os nomes que a API sempre usou:

| Campo na API                        | Origem                                                     |
| ----------------------------------- | ---------------------------------------------------------- |
| `valor`                             | `crm_deal.amount`                                          |
| `status`                            | `crm_deal.status`                                          |
| `funil_estagio_id` e `estagio_nome` | ID e rótulo da opção de status do pipeline da oportunidade |
| `data_conversao`                    | `crm_deal.won_at`                                          |
| `probabilidade_fechamento`          | `crm_deal.probability_override`                            |
| `data_prevista_fechamento`          | `crm_deal.expected_close_date`                             |
| `motivo_perda`                      | `crm_deal.lost_reason`                                     |

Sem oportunidade principal, esses valores são nulos. A leitura não escolhe uma
oportunidade arbitrária nem soma valores de negócios diferentes. Lead na lixeira
continua mostrando a principal, que foi para a lixeira junto com ele.
Os joins exigem o mesmo tenant, o vínculo ao contato e o mesmo pipeline para
resolver o status. Contagem, paginação e filtros usam a mesma fonte; a lista
segue a data de criação, e o ID desempata para estabilizar páginas.

A inatividade considera o pipeline ao resolver o status, pois a mesma key pode
existir em quadros distintos.

## Listas configuráveis

Status e motivos de perda contam usos em todas as oportunidades do tenant,
inclusive as não principais. Isso mantém a proteção contra excluir uma opção
referenciada. Origem, tags e tipos de atividade mantêm suas fontes próprias.

## Escrita

Toda escrita comercial passa pelo service único de oportunidade
(`oportunidades.service.js`), inclusive a que chega por `/crm/leads`. Campos
comerciais não voltam a ser colunas do contato.
