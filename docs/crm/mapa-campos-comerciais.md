# Mapa dos campos comerciais do lead

Levantado em 05/11/2026 para o M2.5, etapa F0 (`plano-execucao-crm-kanban.md`). Mostra quem lia e quem gravava `status`, `valor` e os demais campos que passaram para a oportunidade na F4. As colunas e `funil_estagios` foram apagadas na F5. O contrato da API está fixado em `src/modules/nucleo/crm/controllers/leads.contrato.db.test.js`.

## Campos que mudam de lugar

| Antes em `leads`           | Em `crm_deal`          | Saída na API          |
| -------------------------- | ---------------------- | --------------------- |
| `status`                   | `status`               | sempre                |
| `valor`                    | `amount`               | sempre                |
| `funil_estagio_id`         | opção de status        | sempre                |
| `motivo_perda`             | `lost_reason`          | só com o campo ligado |
| `data_conversao`           | `won_at`               | só com o campo ligado |
| `probabilidade_fechamento` | `probability_override` | só com o campo ligado |
| `data_prevista_fechamento` | `expected_close_date`  | só com o campo ligado |

## Quem grava

| Fluxo                      | Onde, depois da F4                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------- |
| Criar e editar             | `oportunidades.service.js` (`criarLeadComOportunidade`, `atualizarLeadComOportunidade`) |
| Edição em massa            | `leads-bulk.service.js`, pelo mesmo caminho do PUT                                      |
| Importação                 | `import.service.js`, pelas mesmas funções                                               |
| Mesclar                    | `mesclarLeads`, com `moverOportunidades`                                                |
| Anonimizar                 | `crm-lgpd.repository.js`                                                                |
| Distribuição (responsável) | escolhe ao criar: a oportunidade nasce com esse dono                                    |

## Quem lê

| Leitura                | Onde                                                      | Atenção                                            |
| ---------------------- | --------------------------------------------------------- | -------------------------------------------------- |
| Lista, detalhe e busca | `FONTE_LEADS`, `colunasLeitura`                           | oportunidade principal                             |
| Filtros e views        | `lead-filter.service.js`                                  | `valorMin`, `valorMax`, `funilEstagioId`           |
| Exportação             | `export.service.js`                                       | `funilEstagio` sai de `estagio_nome`               |
| Inatividade            | `crm-inatividade.sql.js`, `crm-inatividade.repository.js` | lê `FONTE_LEADS`, com o `pipeline_id` dela         |
| Score                  | `crm-score.repository.js`                                 | a expressão roda sobre `FONTE_LEADS`               |
| Duplicados             | `crm-duplicates.repository.js`                            | não lê campo comercial                             |
| Usos de opção          | `crm-options.repository.js`, `contarUsos`                 | conta todas as oportunidades                       |
| Regras (M8)            | `regras-campos.service.js`                                | recebe o objeto do lead, sem SQL                   |
| Histórico              | `constants/historico.js`                                  | `valor` é propriedade; estágio aparece como status |
| Layout e planilha      | `constants/layout.js`, `constants/planilha.js`            | citam "Estágio do funil"                           |
| Configuração de campos | `constants/campos.js`                                     | `status` e `motivoPerda` são campos do sistema     |

## O que os testes mostraram

- **Funil vazio:** nenhum tenant recebe estágio. A lista real de etapas é `crm_option`, com `kind = 'status'`.
- **Status não é mais nulo:** o lead sem status nasce no primeiro aberto de Vendas, porque `crm_deal.status` é `NOT NULL`.
- **Mudar status conta como interação:** `aplicarPlano` atualiza `ultima_interacao_em`, que é o relógio do M9.
- **Anonimizar preserva o comercial:** `status`, `valor` e `motivo_perda` não são dado pessoal e ficam para os relatórios.
- **Campos opcionais somem da resposta:** sem o campo ligado, a chave não vem, mesmo com valor gravado.

## Front

Cinco arquivos citam funil ou estágio: `modules/crm/constants.js`, `lib/colunas-export.js`, `lib/form-lead.js` e dois testes em `lib/`.
