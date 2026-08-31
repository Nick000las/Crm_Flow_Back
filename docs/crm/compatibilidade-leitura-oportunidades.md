# Leitura de leads após a migração de oportunidades

O banco conectado já possui as migrations 0030–0034, enquanto os arquivos
dessas migrations não constam nas branches disponíveis do repositório.
As consultas antigas de leads e listas dependiam de tabelas e colunas removidas.

`adapters/crm-lead-read-model.js` concentra a compatibilidade da leitura. A
detecção consulta os catálogos do PostgreSQL na transação tenant, considerando
as relações e as colunas efetivas. Não executa DDL nem altera registros.

## Contrato da busca e do detalhe

No modelo anterior, mantém os dados do lead e o estágio de `funil_estagios`.
No modelo com oportunidades, o contato continua vindo de `leads`. O contexto
comercial exibido pelo contrato anterior vem exclusivamente da oportunidade
principal (`leads.principal_deal_id`):

| Campo no contrato anterior          | Origem atual                                               |
| ----------------------------------- | ---------------------------------------------------------- |
| `valor`                             | `crm_deal.amount`                                          |
| `status`                            | `crm_deal.status`                                          |
| `funil_estagio_id` e `estagio_nome` | ID e rótulo da opção de status do pipeline da oportunidade |
| `data_conversao`                    | `crm_deal.won_at`                                          |
| `probabilidade_fechamento`          | `crm_deal.probability_override`                            |
| `data_prevista_fechamento`          | `crm_deal.expected_close_date`                             |
| `motivo_perda`                      | `crm_deal.lost_reason`                                     |

Sem oportunidade principal ativa, esses valores são nulos. A leitura não escolhe
uma oportunidade arbitrária nem soma valores de negócios diferentes.
Os joins exigem o mesmo tenant, o vínculo ao contato e o mesmo pipeline para
resolver o status. Contagem, paginação e filtros usam a mesma fonte; o ID
desempata a ordenação para estabilizar páginas.

A inatividade considera o pipeline ao resolver o status, pois a mesma key pode
existir em quadros distintos. No modelo antigo, a ausência de `pipeline_id`
continua válida.

## Listas configuráveis

Status e motivos de perda contam usos em todas as oportunidades do tenant,
inclusive as não principais. Isso mantém a proteção contra excluir uma opção
referenciada. Origem, tags e tipos de atividade mantêm suas fontes próprias.

## Limites e validação

Esta compatibilidade atende à busca, leitura do detalhe, exportação que usa a
busca e contagem de usos das listas. Ela não reconstrói as migrations ausentes
nem implementa os fluxos de escrita das oportunidades. Esses fluxos precisam
do contrato de domínio correspondente; campos comerciais não voltam a ser
colunas do contato.

Schema sem os requisitos de nenhum modelo responde `503 CRM_SCHEMA_INCOMPATIBLE`,
com mensagem pública, e o frontend não repete essa falha. Testes dos adapters
cobrem os dois modelos, isolamento dos joins, paginação e usos das opções.
