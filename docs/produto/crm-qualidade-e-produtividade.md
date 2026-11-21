# Qualidade de dados e produtividade do CRM

> Estado em 21/11/2026. Fonte: código do back (`src/modules/nucleo/crm/...`).

## O que é

Esta área reúne o que mantém a base de leads limpa e o time produtivo: o aviso de cadastro duplicado e a mesclagem, o preenchimento automático por CNPJ, a pontuação do lead, a distribuição automática de leads entre vendedores, o alerta de lead esfriando e o registro de atividades. A maior parte é configurada pelo DONO (ou MASTER) em Configurações e consumida por todos os papéis no dia a dia. Cada recurso liga e desliga por uma flag própria do tenant, pensada para liberar aos poucos, não para cobrança. Desligada, a flag devolve o comportamento anterior.

## Features

### Duplicidade de cadastro

Ao criar ou editar um lead, o sistema compara e-mail, telefone, CNPJ e CPF com os leads que já existem e avisa ou bloqueia. Cada campo tem uma regra com duas ações: avisar (o usuário vê os leads parecidos e confirma para salvar mesmo assim) ou bloquear (não salva). A comparação é por valor normalizado, então telefone com e sem máscara conta como o mesmo.

- Sem configuração, e-mail e telefone avisam; CNPJ e CPF ficam desligados.
- A tela de cadastro pode perguntar ao vivo, sem salvar, se já existe alguém parecido (até 5 candidatos por checagem). Com a flag desligada, essa consulta responde sempre "ninguém", para o formulário não precisar conhecer a flag.
- Na edição, só os campos que mudaram são conferidos: editar outro dado de um lead que já tinha um parecido não dispara o aviso de novo.
- O import de planilha usa as mesmas regras e mostra os duplicados de cada linha no passo Revisar, com três ações: pular, atualizar ou criar mesmo assim. Sem a flag, o import mantém o comportamento antigo (e-mail e telefone, só avisando).
- Lead na lixeira não conta como duplicado; lead arquivado conta.
- Quando o enriquecimento automático por CNPJ trouxe e-mail ou telefone que cairiam num bloqueio, esse dado é descartado; um mero aviso passa, porque o sistema não tem como pedir confirmação.

### Mesclagem de leads

Junta dois cadastros da mesma pessoa em um só. O lead principal fica; o secundário vai para a lixeira. Só DONO e MASTER podem mesclar, porque a operação é difícil de desfazer.

- Para cada campo, o usuário escolhe o valor do principal ou do secundário. Sem escolha, vale o do principal, ou o do secundário se o do principal estiver vazio.
- Tags viram a união das duas listas; a última interação é a mais recente das duas.
- Status, valor e demais campos comerciais não têm escolha: as oportunidades dos dois leads continuam existindo e passam para o principal, e o lead mostra a oportunidade principal.
- Atividades, histórico e dados de formulário (links, respostas e alertas) do secundário passam para o principal. Se os dois tinham um link ativo do mesmo formulário, fica o mais novo.
- O principal ganha um evento "mesclado" no histórico e o secundário um "excluído" apontando para o principal. O score do principal é recalculado.
- Lead mesclado não volta da lixeira (a tentativa de restaurar dá conflito), e lead anonimizado não pode mesclar nem ser mesclado.
- A mesclagem acontece numa transação só: se algo falhar, nada muda.

### Enriquecimento por CNPJ

Preenche dados da empresa a partir do CNPJ, consultando a Receita por um provedor externo (hoje a BrasilAPI, gratuita). Tem dois modos, escolhidos pelo DONO.

- **Manual (lupa):** qualquer papel consulta um CNPJ e vê os dados e uma sugestão de preenchimento; o usuário aplica no formulário e salva. A sugestão só aponta para campos que o papel pode editar. A consulta manual não grava nada no lead e não gera evento próprio.
- **Automático:** depois de salvar um lead com CNPJ (cadastro, edição ou import), o sistema enfileira a consulta e um worker aplica os dados. Sem a opção "sobrescrever", só preenche o que está vazio. O lead recebe um evento "enriquecido", com o sistema como autor.
- O DONO escolhe quais dados da Receita vão para qual campo. São 15 dados possíveis (razão social, nome fantasia, situação cadastral, atividade principal, endereço completo e em partes, CEP, telefone, e-mail, data de abertura). Cada destino precisa ser um campo ativo, de tipo compatível, e cada campo recebe um dado só. Sem configuração, vale o padrão: ligado, modo manual, sem sobrescrever, e razão social, município, UF, CEP e endereço mapeados para os campos correspondentes.
- O resultado da consulta fica em cache de 30 dias, compartilhado entre todos os tenants (é dado público). CNPJ não encontrado também é guardado; CNPJ alfanumérico não é suportado pelo provedor e não entra no cache.
- Provedor fora do ar: a lupa responde "indisponível" e o resto do formulário segue funcionando; no modo automático a fila tenta de novo até 3 vezes. Falha nunca impede de salvar o lead.
- Se o enriquecimento estiver desligado nas configurações, a lupa também fica bloqueada.

### Pontuação de leads (score)

O campo "Lead score" passa a ser calculado por regras do DONO, em vez de digitado. Cada regra tem um nome, uma pontuação (positiva ou negativa) e até 10 condições combinadas com "e", usando os mesmos operadores dos filtros. O score do lead é a soma dos pontos das regras ativas que casam.

- As faixas (padrão: Frio até 29, Morno de 30 a 69, Quente a partir de 70) têm rótulo, cor e limites configuráveis. Não podem se sobrepor, mas podem deixar buracos (o lead no buraco fica sem faixa). A lista e o filtro de busca usam a faixa.
- Com a flag ligada, o score é só leitura: mandar um valor manual dá erro. Desligada, volta a ser um número digitado, como antes.
- O score é recalculado quando o lead é criado, editado, alterado em massa, importado, mesclado, enriquecido por CNPJ, tem a oportunidade editada ou é anonimizado.
- Ao salvar a configuração, todos os leads são recalculados na hora, em lotes de 500, antes de a resposta voltar; o progresso aparece na leitura da configuração enquanto roda. Há também um botão de recalcular sem mudar regras.
- Ao salvar, o sistema liga o campo Lead score no detalhe, na tabela e no filtro, se estava escondido; o DONO pode escondê-lo de novo depois.
- Regra cujo campo foi excluído ou desligado é ignorada sem derrubar o salvamento. Mudanças fora das regras (excluir ou trocar o tipo de um campo) só aparecem no próximo recálculo.
- O recálculo não gera evento no histórico, porque não é edição de ninguém.

### Distribuição automática de leads

Define quem fica responsável por um lead novo, por regras e por rodízio. Fica desligada até o DONO ativar, e enquanto estiver desligada o criador do lead (ou quem importou) continua sendo o responsável.

- Regras em ordem: a primeira regra ativa que casar e tiver destino disponível decide. O destino é um usuário ou um grupo de usuários (rodízio dentro do grupo). Usuário inativo ou grupo sem membro ativo faz a regra ser pulada.
- Se nenhuma regra decidir, vale o fallback escolhido: rodízio geral (entre DONO e OPERADOR ativos; o MASTER é da plataforma e fica de fora) ou deixar o lead sem responsável.
- Só distribui lead novo sem responsável informado (formulário, API, criação pelo quadro ou linha de planilha sem a coluna Responsável). Um responsável escolhido é sempre respeitado, até o próprio criador. Edição, edição em massa e mesclagem nunca redistribuem.
- O rodízio é puro, sem peso por pessoa, e a posição do ponteiro fica guardada no banco. Se a criação do lead falhar depois de escolher o responsável, aquela vez do rodízio é perdida.
- O histórico do lead guarda de onde veio o responsável (regra, rodízio geral ou sem responsável) e aparece na categoria Atribuições da timeline. A mesma regra fica visível no lead.
- O responsável recebe a notificação "Novo lead para você" (não quem criou). No import, cada responsável recebe uma notificação só, com o total.
- Grupo que é destino de alguma regra não pode ser excluído antes de trocar o destino.

### Lead esfriando

Mostra quais leads estão sem interação há tempo demais. O DONO define, para cada status em aberto, em quantos dias sem interação o lead esfria (de 1 a 365; sem valor, o status não esfria). Status de ganho ou perdido não esfria.

- A regra é calculada na leitura, nunca gravada: mudar os dias, o relógio ou uma atividade vale na próxima consulta. Lead esfriando aparece com a data desde quando esfria, no detalhe, e como filtro "Esfriando" (busca, export e views salvas). A view "Esfriando" já vem pronta, como view do sistema.
- A contagem parte da última interação (ou da criação) e é empurrada para a frente pela atividade agendada em aberto mais distante: uma atividade agendada pausa a contagem até a data dela; se venceu sem ser concluída, a contagem recomeça dali.
- O que zera o relógio: mudar o status e concluir uma atividade. Editar outro campo, agendar ou reabrir atividade não zera.
- Lead arquivado ou na lixeira nunca esfria.
- Sugestões que já vêm semeadas na lista de status: Novo 1 dia, Em contato 3, Qualificado 5, Proposta 7, Negociação 7.
- Com a flag desligada, o lead não traz a informação e o filtro `esfriando` é recusado (a flag é exigida).

### Notificações do CRM

O CRM avisa pelo sino da plataforma, usando o serviço de notificações do core. Quatro avisos existem hoje:

- **Esfriando:** "Você tem N leads esfriando", um resumo por dia para cada responsável, com atalho para a lista já filtrada.
- **Esfriando sem responsável:** os leads esfriando sem dono (ou com o responsável desativado) viram um resumo à parte para cada DONO ativo.
- **Novo lead para você** e **Você recebeu N leads de uma importação:** da distribuição automática.

O resumo de esfriando roda de hora em hora e, em cada tenant, só a partir das 8h no fuso do tenant. A chave de repetição inclui a data local, então cada pessoa recebe no máximo um por dia, mesmo se o worker estiver parado às 8h e voltar mais tarde.

### Atividades

Registro de ligações, reuniões, tarefas e afins dentro do lead. O tipo vem da lista configurável "Tipo de atividade" (já semeada com Ligação, WhatsApp, Reunião, E-mail, Tarefa e Visita). Cada atividade tem título (até 200 caracteres), notas (até 5.000), data agendada opcional, autor e data de conclusão.

- Pode nascer em aberto ou já concluída (para registrar algo que já aconteceu). Concluir leva a "última interação" do lead para a data da conclusão, nunca para trás; reabrir limpa a conclusão mas não devolve a data do lead.
- A lista do lead mostra primeiro as atividades em aberto, pela data agendada, e depois as concluídas.
- Só tipo ativo da lista é aceito; uma atividade antiga com tipo depois desativado continua válida. O tipo em uso não pode ser excluído da lista (conflito).
- Qualquer papel lê, cria, edita e exclui atividades (a exclusão é definitiva). Lead na lixeira não tem atividades acessíveis.
- As atividades não geram evento no histórico do lead; elas têm lista própria.
- Na mesclagem elas passam para o lead principal; na anonimização o título vira "Atividade anonimizada" e as notas são apagadas.

### Próximo follow-up

Um campo de data do sistema no lead ("Próximo follow-up"), editável como os demais campos de Camada 2, com visibilidade, rótulo e obrigatoriedade configuráveis. Hoje é só um dado informado: nada lembra o vendedor quando a data chega, e ele não interfere em esfriando, score nem notificações.

## Estado

| Feature                 | Back    | Front                                            | Flag                                                                        | Origem  |
| ----------------------- | ------- | ------------------------------------------------ | --------------------------------------------------------------------------- | ------- |
| Duplicidade de cadastro | pronto  | sem handoff (contrato no plano de Configurações) | `crm.duplicidade`                                                           | M7      |
| Mesclagem de leads      | pronto  | sem handoff (contrato no plano de Configurações) | `crm.duplicidade`                                                           | M7      |
| Enriquecimento por CNPJ | pronto  | sem handoff (contrato no plano de Configurações) | `crm.cnpj`                                                                  | M11b    |
| Pontuação de leads      | pronto  | sem handoff (contrato no plano de Configurações) | `crm.score`                                                                 | M14     |
| Distribuição automática | pronto  | sem handoff (contrato no plano de Configurações) | `crm.distribuicao`                                                          | M12     |
| Lead esfriando          | pronto  | sem handoff (contrato no plano de Configurações) | `crm.inatividade`                                                           | M9      |
| Notificações do CRM     | pronto  | sem handoff (contrato no plano de Configurações) | `crm.inatividade` e `crm.distribuicao` (cada aviso pela flag da sua origem) | M9, M12 |
| Atividades              | pronto  | sem handoff (contrato no plano de Configurações) | `crm.atividades`                                                            | M6      |
| Próximo follow-up       | parcial | sem handoff (contrato no plano de Configurações) | sempre ligado                                                               | M2      |

Nota: "parcial" no follow-up significa que existe só o campo, sem lembrete. O plano de Configurações registra o front de M6 e M7 como feito e o dos demais marcos como pendente na data em que foi escrito; o back não confirma o estado das telas.

## Regras e limites

**Papéis**

- Em geral, a configuração (regras de duplicidade, CNPJ, score, distribuição, dias de esfriar) é só de DONO e MASTER; a leitura é de todos. O papel é conferido antes da flag, então OPERADOR sempre recebe "proibido", com a flag ligada ou não.
- Mesclar leads: só DONO e MASTER.
- Consultar CNPJ pela lupa, usar atividades, checar duplicados e ver o score: qualquer papel.
- Atividades: qualquer papel faz tudo, inclusive excluir. Não há restrição por papel e isso hoje é assim, não uma decisão registrada.

**Duplicidade e mesclagem**

- Campos com regra: e-mail, telefone, CNPJ e CPF. Ações: avisar ou bloquear; se um lead parecido casa por mais de um campo, vale a ação mais forte.
- Máximo de 5 candidatos por checagem.
- Decisão do dono: avisar pede confirmação antes de salvar; mesclar é só DONO/MASTER.

**CNPJ**

- Cache de 30 dias, global entre tenants. Prazo de 5 segundos por consulta ao provedor. Até 3 tentativas com espera crescente (começando em 5 s). Limite padrão do worker: 3 consultas por segundo (ajustável por variável de ambiente).
- Decisão do dono: só BrasilAPI por enquanto, com o provedor pago previsto como troca futura; a lupa mostra os dados e o usuário aplica.

**Score**

- Até 100 regras, 10 condições por regra, 10 faixas, pontos entre -1.000 e 1.000, lotes de recálculo de 500.
- Decisão do dono: o recálculo é na hora, em lotes, e não numa fila, para funcionar sem Redis. Faixas padrão Frio, Morno e Quente (até 29, 30 a 69, 70 ou mais).

**Distribuição**

- Até 50 regras, 10 condições por regra, 30 grupos e 200 membros por grupo.
- Decisões do dono: ponteiro do rodízio no banco; presença do usuário fora (nada a atualiza hoje; só inativos são pulados); rodízio sem peso; import distribui linha a linha; uma notificação por lead no cadastro e uma agrupada por import.

**Esfriando**

- Dias entre 1 e 365 por status em aberto. Decisão do dono: calcular na leitura, sem guardar nada no lead e sem job de recálculo; resumo diário por usuário, e os sem responsável vão aos DONOs.
- A configuração dos dias lê e grava só os status do pipeline padrão (Vendas). O cálculo (leitura do lead, filtro e resumo diário) usa o status da oportunidade principal no pipeline dela; para uma oportunidade em outro pipeline, a contagem só funciona se aquela opção tiver dias, e não existe rota para configurar isso. A visibilidade por pipeline (D4) também não vale no resumo diário.

**Atividades**

- Título até 200 caracteres, notas até 5.000. Tipos vêm da lista do tenant.

## Fica de fora

| Item                                                    | Motivo                                                                   | Quando volta                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Duplicidade por nome + empresa aproximado (`pg_trgm`)   | Exigiria um tipo novo de regra; ficou só em e-mail, telefone, CNPJ e CPF | Sem data                                                    |
| Presença e peso por usuário na distribuição             | Nada atualiza a presença hoje; rodízio puro foi decisão do dono          | Sem data                                                    |
| SERPRO como provedor de CNPJ                            | Só entra com o adapter pronto; BrasilAPI atende por ora                  | Quando houver o adapter                                     |
| Score de engajamento (com decaimento)                   | O plano previa; a entrega ficou só nas regras sobre dados do lead        | Sem data                                                    |
| Lembrete do próximo follow-up                           | O follow-up é só um campo de data                                        | Sem data                                                    |
| Restrição por papel para arquivar, excluir e atividades | Hoje qualquer papel pode; não foi tratado como regra                     | A decidir pelo dono                                         |
| Dias de esfriar por pipeline                            | A configuração dos dias usa só o pipeline padrão                         | Sem data                                                    |
| Campos personalizados na edição em massa                | Fora do escopo da edição em massa                                        | Ver [busca e dados em massa](crm-busca-e-dados-em-massa.md) |
| Desfazer uma mesclagem                                  | Não existe; o secundário não volta da lixeira                            | Sem data                                                    |

## Ideias de expansão e refinamento

> Sugestões para decidir, não decisões.

| Ideia                                                                                            | Valor para o cliente                                                          | Depende de                                            | Esforço (P/M/G) |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------------- | --------------- |
| Lembrete do próximo follow-up no sino (e/ou "atividades de hoje")                                | O vendedor deixa de depender da própria memória; usa um campo que já existe   | Serviço de notificações do core, job agendado         | M               |
| Configurar dias de esfriar por pipeline                                                          | Atendimento e outros pipelines passam a esfriar de verdade                    | Tela e rota de configuração por pipeline              | M               |
| Presença e peso na distribuição                                                                  | Rodízio justo para quem está de férias ou atende mais                         | Alguém passar a atualizar a presença do usuário       | M               |
| Duplicidade aproximada por nome + empresa                                                        | Pega o mesmo contato digitado de formas diferentes                            | `pg_trgm` no banco e nova regra de duplicidade        | G               |
| Provedor pago de CNPJ (SERPRO)                                                                   | Mais confiabilidade e sem limite de uso do provedor gratuito                  | Adapter do provedor e contrato                        | M               |
| Score de engajamento com decaimento                                                              | Separa lead quente de lead antigo que só tem bom perfil                       | Eventos de engajamento e definição do dono            | G               |
| Aplicar visibilidade por pipeline (D4) também na checagem de duplicados e no resumo de esfriando | Fecha uma brecha: hoje o aviso pode citar lead de pipeline que o papel não vê | Decisão do dono sobre o comportamento esperado        | P               |
| Restringir por papel o que OPERADOR pode arquivar, excluir ou apagar atividade                   | Controle maior para gestores que não querem exclusões soltas                  | Decisão do dono sobre quais papéis podem o quê        | P               |
| Desfazer mesclagem enquanto o secundário está na lixeira                                         | Reduz o medo de mesclar errado                                                | Guardar o estado anterior; regra de produto           | G               |
| Mostrar atividades na linha do tempo junto do histórico                                          | Uma visão só do que aconteceu com o lead                                      | Decisão de produto; hoje as duas listas são separadas | M               |

## Mapa técnico

**Rotas** (todas sob `/crm`, autenticadas, com módulo CRM ativo; o contrato vive nos controllers e nos schemas Zod)

| Área         | Rotas                                                                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duplicidade  | `POST /crm/leads/duplicados`, `GET` e `PUT /crm/configuracoes/duplicidade`, `POST /crm/leads/merge`                                                       |
| CNPJ         | `GET /crm/cnpj/:cnpj`, `GET` e `PUT /crm/configuracoes/cnpj`                                                                                              |
| Score        | `GET` e `PUT /crm/configuracoes/score`, `POST /crm/configuracoes/score/recalcular`                                                                        |
| Distribuição | `GET` e `PUT /crm/configuracoes/distribuicao`, `POST /crm/configuracoes/distribuicao/grupos`, `PUT` e `DELETE /crm/configuracoes/distribuicao/grupos/:id` |
| Esfriando    | `GET` e `PUT /crm/configuracoes/inatividade`; filtro `esfriando` em `POST /crm/leads/search`                                                              |
| Atividades   | `GET /crm/atividades/tipos`, `GET` e `POST /crm/leads/:id/atividades`, `PUT` e `DELETE /crm/leads/:id/atividades/:atividadeId`                            |
| Notificações | Do core: `GET /notificacoes`, `POST /notificacoes/:id/lida`, `POST /notificacoes/lidas`                                                                   |

**Tabelas** (schema `modulo_crm`, todas com `tenant_id` e RLS, exceto o cache de CNPJ, que é global de propósito)

- `crm_duplicate_rule` e as colunas geradas `dedup_email`, `dedup_telefone`, `dedup_cnpj` e `dedup_cpf` em `leads`.
- `crm_cnpj_config` e `crm_cnpj_cache` (global).
- `crm_score_rule`, `crm_score_band`, `crm_score_config`; o score mora em `leads.lead_score`.
- `crm_user_group`, `crm_user_group_member`, `crm_assignment_rule`, `crm_distribuicao_config`, `crm_rodizio_ponteiro`.
- `crm_option.stale_days` (dias de esfriar, só para opções de status).
- `crm_activity`; `public.notificacoes` (core).

**Flags:** `crm.duplicidade`, `crm.cnpj`, `crm.score`, `crm.distribuicao`, `crm.inatividade`, `crm.atividades`. A importação aplica distribuição e score por linha.

**Jobs e filas** (worker `pnpm worker:crm`): fila `crm-cnpj` (job de enriquecimento, com limite de consultas por segundo) e fila `crm-manutencao` (job `notificar-esfriando`, de hora em hora).

**Services centrais:** `duplicidade.service.js`, `mesclagem.service.js`, `cnpj.service.js` e `cnpj-enriquecimento.service.js`, `score.service.js`, `distribuicao.service.js` e `distribuicao-motor.service.js` (a escolha de destino é função pura), `inatividade.service.js` (o cálculo é uma única expressão SQL em `adapters/crm-inatividade.sql.js`, usada pela leitura do lead, pelo filtro e pelo job), `atividades.service.js`.

**Pendências de produção que afetam esta área:** os workers `worker:crm` e `worker:kanban` ainda não estão no `compose.yaml` nem no CI, e sem o `worker:crm` rodando o enriquecimento automático por CNPJ, o resumo de esfriando e a purga da lixeira não acontecem; `REDIS_URL` é necessário; `pnpm crm:reconcile` precisa rodar no deploy (semeia listas e sugestões de dias de esfriar). Ver também [histórico, arquivo e LGPD](crm-historico-arquivo-e-lgpd.md) e [pessoas e campos](crm-pessoas-e-campos.md).
