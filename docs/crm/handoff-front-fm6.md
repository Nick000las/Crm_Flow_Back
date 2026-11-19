# Handoff ao front: FM6, formulários no ciclo de vida da pessoa

Nenhuma rota nova. Arquivar, excluir, mesclar e anonimizar uma pessoa passam a tratar também os links, as respostas e os alertas de formulário dela. O front só precisa refletir isso nas telas que já existem.

Plano: [plano-execucao-formularios-forecast.md](./plano-execucao-formularios-forecast.md), marco FM6. Antes: [handoff-front-fm5.md](./handoff-front-fm5.md).

## 1. O que muda em cada ação

| Ação na pessoa       | Links ativos                                                                                                        | Respostas                  | Alertas                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------- |
| Arquivar             | revogados (`status: "revoked"`)                                                                                     | ficam                      | ficam                                                     |
| Desarquivar          | continuam revogados; para enviar de novo, use "Gerar novo"                                                          | ficam                      | ficam                                                     |
| Excluir (lixeira)    | revogados                                                                                                           | ficam até a purga          | ficam até a purga                                         |
| Restaurar da lixeira | continuam revogados                                                                                                 | ficam                      | ficam                                                     |
| Purga da lixeira     | apagados                                                                                                            | apagadas                   | apagados                                                  |
| Mesclar              | vão para a pessoa que fica; se as duas tinham link ativo do mesmo formulário, fica o mais novo e o outro é revogado | vão para a pessoa que fica | vão para a pessoa que fica, com o "visto" de cada usuário |
| Anonimizar           | revogados                                                                                                           | ficam **sem nenhum valor** | apagados                                                  |

## 2. Telas

- **Confirmação de arquivar e de excluir:** avise "Os links de formulário ainda não respondidos serão cancelados".
- **Confirmação de anonimizar:** acrescente "As respostas de formulários e os alertas desta pessoa também serão apagados".
- **"Ver respostas" de uma pessoa anonimizada:** a resposta continua na lista (formulário, data, quem preencheu, contagem de escrita). No detalhe, todo `valor` vem `null`, e `nomeResponsavel` vem `"Anonimizado"` quando quem preencheu foi um responsável. Mostre o aviso "Respostas apagadas a pedido do titular (LGPD)" e esconda os valores vazios.
- **Mesclar:** a ficha da pessoa que fica passa a listar os links, as respostas e os alertas da outra. Recarregue essas abas depois da mesclagem.

## 3. Menor de idade (já existia desde a FM4)

`preenchidoPor: "responsavel"` exige `nomeResponsavel`, e as duas informações ficam na resposta. Não há validação de idade: quem preenche se declara.

## 4. Antes de ligar em uma empresa real

O termo de aceite, o fluxo de menor de idade e a política de exclusão precisam ser revisados pelo jurídico. É uma parada do dono no plano. Até lá, `crm.formularios` só fica ligada em tenant interno.
