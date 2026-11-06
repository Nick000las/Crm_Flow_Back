# Mapa dos campos comerciais do lead

Levantado em 05/11/2026 para o M2.5, etapa F0 (`plano-execucao-crm-kanban.md`). Mostra quem lê e quem grava `status`, `valor` e os demais campos que passam para a oportunidade. O contrato da API está fixado em `src/modules/nucleo/crm/controllers/leads.contrato.db.test.js`.

## Campos que mudam de lugar

| Hoje em `leads`            | Vai para `crm_deal`    | Saída na API               |
| -------------------------- | ---------------------- | -------------------------- |
| `status`                   | `status`               | sempre                     |
| `valor`                    | `amount`               | sempre                     |
| `funil_estagio_id`         | opção de status        | sempre; hoje é sempre nulo |
| `motivo_perda`             | `lost_reason`          | só com o campo ligado      |
| `data_conversao`           | `won_at`               | só com o campo ligado      |
| `probabilidade_fechamento` | `probability_override` | só com o campo ligado      |
| `data_prevista_fechamento` | `expected_close_date`  | só com o campo ligado      |

## Quem grava

| Fluxo                      | Onde                                                 | Etapa |
| -------------------------- | ---------------------------------------------------- | ----- |
| Criar e editar             | `leads.repository.js` (`criarLead`, `atualizarLead`) | F4    |
| Edição em massa            | `leads-bulk.service.js`                              | F4    |
| Importação                 | `import.service.js`                                  | F4    |
| Mesclar                    | `mesclagem.service.js`, `mesclarLeads`               | F4    |
| Anonimizar                 | `crm-lgpd.repository.js`                             | F4    |
| Distribuição (responsável) | `crm-distribuicao.repository.js`                     | F4    |

## Quem lê

| Leitura                | Onde                                                      | Atenção                                        |
| ---------------------- | --------------------------------------------------------- | ---------------------------------------------- |
| Lista, detalhe e busca | `fonteLeads`, `colunasLeitura`                            | já tem ramo de oportunidades                   |
| Filtros e views        | `lead-filter.service.js`                                  | `valorMin`, `valorMax`, `funilEstagioId`       |
| Exportação             | `export.service.js`                                       | `funilEstagio` sai de `estagio_nome`           |
| Inatividade            | `crm-inatividade.sql.js`, `crm-inatividade.repository.js` | a expressão espera `l.status`                  |
| Score                  | `crm-score.repository.js`                                 | condição em SQL direto sobre `leads`           |
| Duplicados             | `crm-duplicates.repository.js`                            | não lê campo comercial                         |
| Usos de opção          | `crm-options.repository.js`, `contarUsos`                 | já tem ramo de `crm_deal`                      |
| Regras (M8)            | `regras-campos.service.js`                                | recebe o objeto do lead, sem SQL               |
| Histórico              | `constants/historico.js`                                  | `funilEstagioId` e `valor` são propriedades    |
| Layout e planilha      | `constants/layout.js`, `constants/planilha.js`            | citam "Estágio do funil"                       |
| Configuração de campos | `constants/campos.js`                                     | `status` e `motivoPerda` são campos do sistema |

## O que os testes mostraram

- **Funil vazio:** nenhum tenant recebe estágio, e `funil_estagio_id` é sempre nulo. A lista real de etapas é `crm_option`, com `kind = 'status'`.
- **Status pode ser nulo:** um lead sem status nasce com `status: null`, e `crm_deal.status` é `NOT NULL`.
- **Mudar status conta como interação:** o SQL de `atualizarLead` atualiza `ultima_interacao_em`. A F3 precisa manter isso, porque é o relógio do M9.
- **Anonimizar preserva o comercial:** `status`, `valor` e `motivo_perda` não são dado pessoal e ficam para os relatórios.
- **Campos opcionais somem da resposta:** sem o campo ligado, a chave não vem, mesmo com valor gravado.

## Front

Cinco arquivos citam funil ou estágio: `modules/crm/constants.js`, `lib/colunas-export.js`, `lib/form-lead.js` e dois testes em `lib/`.
