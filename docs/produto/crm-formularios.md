# Formulários

> Estado em 21/11/2026. Fonte: código do back (`src/modules/nucleo/crm/`).

## O que é

O dono monta um formulário (por exemplo, uma anamnese), escolhe quais campos da pessoa e quais perguntas próprias entram e publica. Na ficha, a equipe gera um link pessoal para aquela pessoa responder, sem login, numa página pública. A resposta atualiza a ficha conforme regras de escrita escolhidas pelo dono, fica guardada como foi declarada e pode disparar alertas (por exemplo, "alergia a dipirona") que aparecem no topo da ficha e no card do quadro. Tudo atrás da flag `crm.formularios`, e o que envolve dado de saúde ainda espera uma revisão jurídica antes de ir para negócio real.

## Features

### Montar e publicar formulários

Configurações → Formulários, só para DONO e MASTER. O formulário tem nome, descrição, validade do link e um rascunho com seções, itens, introdução e termo. Publicar transforma o rascunho em uma versão numerada e imutável; o rascunho continua, e a lista mostra se há alterações não publicadas. Links já enviados ficam na versão em que nasceram.

- Nome único por negócio, sem diferenciar maiúscula e minúscula.
- Publicar exige ao menos um item e o termo de aceite.
- Dá para desativar o formulário: ele deixa de poder ser enviado.
- A versão publicada guarda um retrato de cada campo (nome, tipo, opções); renomear o campo depois não muda a versão.

### Campos do CRM e perguntas próprias

Cada item é um campo da pessoa que já existe no CRM ou uma pergunta própria.

- **Campos do CRM elegíveis:** nome, e-mail, telefone, empresa, cargo, CPF, CNPJ, cidade, UF, CEP e endereço (se estiverem ligados), mais todos os campos personalizados, menos o tipo usuário. Ficam de fora status, valor, motivo, tags, origem, score, follow-up e campos de LGPD, que são do sistema ou da oportunidade.
- **Perguntas próprias:** a resposta fica só na resposta do formulário; não cria campo nem coluna no CRM. Aceitam os tipos do CRM, menos usuário e endereço. Seleção e seleção múltipla exigem de 1 a 50 opções.
- Cada item pode ser obrigatório só dentro do formulário, sem tornar o campo obrigatório no cadastro.

### Campo sensível

O dono marca um campo (ou uma pergunta) como sensível. Para o OPERADOR o campo some da leitura, dos filtros e da escrita, com ou sem a flag de permissões. Sensível nunca vem pré-preenchido na página pública. Nome, e-mail, telefone e os campos carimbados pela LGPD não podem ser sensíveis. As colunas padrão do export deixam o campo sensível de fora. Resposta a pergunta sensível só aparece para a gestão.

### Política de escrita

Define o que a resposta faz com o valor que a pessoa já tem.

- `overwrite` (sobrescrever): a declaração mais recente vale. É o padrão das perguntas e da maioria dos campos.
- `fill_if_empty` (preencher se vazio): só grava se estiver vazio; se divergir, vai para revisão. É o padrão de e-mail, telefone, CPF e CNPJ.
- Resposta vazia nunca apaga o que a pessoa já tem.

### Pré-preenchimento

O dono marca "vem preenchido" por campo. A página pública mostra o valor salvo da pessoa, editável. Campo sensível não pode ser marcado, e perguntas próprias nunca vêm preenchidas.

### Link pessoal e token

Na ficha, a equipe copia o link de um formulário publicado. Se já existe um link ativo, a mesma URL volta; senão, cria outro (dois cliques ao mesmo tempo geram um só). O link tem validade (padrão 7 dias, de 1 a 90). O token tem 32 bytes aleatórios; no banco ficam só o hash e uma cópia cifrada (AES-256-GCM) que permite "copiar de novo". Um link pode apontar para uma oportunidade da pessoa, como referência.

- Estados: ativo, respondido, vencido e revogado. Vencido ou revogado se resolve gerando um novo.
- Revogar é manual. Arquivar, excluir ou anonimizar a pessoa revoga os links ativos.
- Formas de envio na tela: copiar, abrir no WhatsApp com a URL na mensagem (o usuário envia) e QR Code. Não há envio automático.
- Sem a chave dos links no servidor, a criação responde 503 (`FORMS_UNAVAILABLE`).

### Página pública

A rota `/f/:token` do front, sem login, lê o formulário na API pública. Mostra introdução, seções, campos (com o pré-preenchimento), termo e prazo, e saúda só pelo primeiro nome.

- Ler não muda nada. A "abertura" é marcada à parte, para um robô de prévia (WhatsApp, antivírus de e-mail) não contar como abertura.
- Link vencido, cancelado, já respondido ou inexistente dá o mesmo 404, para não revelar o motivo.
- Respostas com `no-store`, `no-referrer` e `noindex`.

### Resposta e política de escrita na ficha

Ao enviar, a resposta é gravada como foi declarada e, em seguida, cada campo do CRM é tratado pela política dele. Para cada campo, o resultado é gravado, ignorado ou "para revisão".

| Resultado | Motivo                                                                                                                 |
| --------- | ---------------------------------------------------------------------------------------------------------------------- |
| Gravado   | Atualizou a ficha                                                                                                      |
| Ignorado  | Igual ao que já estava, ou não respondido                                                                              |
| Revisão   | Valor diferente do salvo; contato que já é de outra pessoa; regra do CRM impediu; campo desligado depois da publicação |

- Quem vê a resposta usa "Usar este valor" (edição normal do lead) para aceitar o que ficou em revisão. A resposta em si não muda.
- O histórico da pessoa ganha "Respondeu o formulário" e, quando a resposta gravou campos, "Atualizado pelo formulário".
- Clique duplo grava uma resposta só. Erro de validação não consome o link.
- Quem abriu antes de vencer tem 2 horas depois do vencimento para enviar.

### Termo de aceite e quem preenche

O termo é obrigatório para publicar (até 10.000 caracteres) e o aceite é obrigatório no envio; sem `aceite: true` a resposta é 400. A pessoa informa se quem preenche é o titular ou um responsável, e, no segundo caso, o nome do responsável é obrigatório. Isso atende o menor de idade, mas não há validação de idade: quem preenche se declara. Termo, momento do aceite, IP e navegador (este último só visível para a gestão) ficam na resposta.

### Ver respostas

Na ficha, lista e detalhe das respostas da pessoa, da mais nova para a mais antiga, com o resumo do que foi gravado, ignorado e para revisão (selo "Revisar" quando houver). Campo que o papel não vê e pergunta sensível para quem não é da gestão aparecem como "restrito", sem o valor. Vale para qualquer papel que veja a pessoa.

### Alertas

O dono cria regras no formulário: "quando [campo ou pergunta] [operador] [valor], mostrar [nível]: [texto]".

- Níveis: informativo, atenção e crítico.
- Operadores: igual, contém, é um dos, entre, vazio e não vazio, conforme o tipo do alvo.
- O alerta vai junto com a versão publicada.
- O alerta aparece no topo da ficha e como selo no card do quadro (só o nível mais grave ainda não visto por quem olha, sem texto). "Visto" é por usuário: marcar só tira o alerta para quem marcou.
- Quem não pode ver o alvo (campo ou pergunta sensível) recebe o alerta com texto genérico ("Há um alerta restrito nesta pessoa. Fale com a gestão.").

### Ciclo de vida da pessoa e LGPD

| Ação na pessoa         | Links ativos                                                                                    | Respostas                  | Alertas                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------- |
| Arquivar               | Revogados                                                                                       | Ficam                      | Ficam                                             |
| Excluir (lixeira)      | Revogados                                                                                       | Ficam até a purga          | Ficam até a purga                                 |
| Restaurar, desarquivar | Continuam revogados                                                                             | Ficam                      | Ficam                                             |
| Purga da lixeira       | Apagados                                                                                        | Apagadas                   | Apagados                                          |
| Mesclar                | Vão para a pessoa que fica (se os dois tinham link ativo do mesmo formulário, fica o mais novo) | Vão para quem fica         | Vão para quem fica, com o "visto" de cada usuário |
| Anonimizar             | Revogados                                                                                       | Ficam **sem nenhum valor** | Apagados                                          |

## Estado

| Feature                            | Back   | Front            | Flag                                                           | Origem    |
| ---------------------------------- | ------ | ---------------- | -------------------------------------------------------------- | --------- |
| Montar e publicar (versões)        | pronto | handoff entregue | `crm.formularios`                                              | FM1       |
| Campos do CRM e perguntas próprias | pronto | handoff entregue | `crm.formularios`                                              | FM1, FM2b |
| Campo sensível                     | pronto | handoff entregue | sempre ligado (a marcação); o formulário usa `crm.formularios` | FM1       |
| Política de escrita                | pronto | handoff entregue | `crm.formularios`                                              | FM1, FM4  |
| Pré-preenchimento                  | pronto | handoff entregue | `crm.formularios`                                              | FM2b      |
| Link pessoal e token               | pronto | handoff entregue | `crm.formularios`                                              | FM2       |
| Página pública                     | pronto | handoff entregue | `crm.formularios`                                              | FM3       |
| Resposta e escrita na ficha        | pronto | handoff entregue | `crm.formularios`                                              | FM4       |
| Termo de aceite e quem preenche    | pronto | handoff entregue | `crm.formularios`                                              | FM1, FM4  |
| Ver respostas                      | pronto | handoff entregue | `crm.formularios`                                              | FM4       |
| Alertas (ficha e card)             | pronto | handoff entregue | `crm.formularios`                                              | FM5       |
| Ciclo de vida e LGPD               | pronto | handoff entregue | `crm.formularios`                                              | FM6       |

## Regras e limites

**Quem pode**

- Montar, editar, publicar e ver versões: DONO e MASTER. Sem a flag, é 403 para todos.
- Gerar link, revogar, ver respostas e alertas: qualquer papel que veja a pessoa (a visibilidade por pipeline vale).
- Quem preenche a página pública não tem login.

**Números**

- 50 formulários por negócio; 20 seções; 100 itens (campos e perguntas juntos).
- Nome até 120 caracteres; descrição até 500; título de seção até 120; introdução até 2.000; termo até 10.000.
- Pergunta: rótulo até 200, ajuda até 500, até 50 opções de até 120 caracteres.
- Validade do link: padrão 7 dias, de 1 a 90.
- Até 30 alertas por formulário e 300 caracteres por texto.
- Tolerância de envio: 2 horas depois do vencimento, para quem abriu antes.
- Limite público: 120 pedidos por minuto por IP (todo `/public`) e 30 por minuto por link.
- Nome do responsável: até 200 caracteres.

**Decisões do dono**

- O formulário junta campos da pessoa que já existem e perguntas próprias, cuja resposta fica só no formulário (FM2b).
- Aparecer no card e na ficha, e "visto" por usuário (FM5).
- O dono marca quais campos vêm pré-preenchidos; sensível nunca vem.

**Segurança**

- A chave dos tokens é `FORMS_TOKEN_KEY` (ambiente, 32 bytes em base64), sem KMS.
- O log leva só ids do link e da resposta, nunca o conteúdo.
- O limite por link usa o hash do token, nunca o token.

**Pendências antes de ligar em negócio real**

- **Parada do jurídico:** revisar o termo, o fluxo de menor de idade e a política de exclusão. A anonimização apaga **todos** os valores da resposta, o que conflita com a guarda de prontuário. Até lá, `crm.formularios` fica só em negócio interno.
- `trustProxy` não está ligado, e o limite por IP depende dele.
- `FORMS_TOKEN_KEY` precisa estar no ambiente.
- Os workers (`worker:crm`) não estão no `compose.yaml` nem no CI; o CI (`pr-checks.yml`) nunca rodou num PR.

## Fica de fora

| Item                                                 | Motivo                                  | Quando volta        |
| ---------------------------------------------------- | --------------------------------------- | ------------------- |
| FM7: pergunta do tipo arquivo (uploads)              | Não implementado                        | Sem data            |
| Envio em massa e automático de links, WhatsApp e NPS | É o plano do bot; hoje o envio é manual | Plano do bot        |
| Validação de idade                                   | Quem preenche se declara                | Depende do jurídico |
| Guarda de prontuário na anonimização                 | Hoje apaga todos os valores             | Depende do jurídico |

## Ideias de expansão e refinamento

> Sugestões para decidir, não decisões.

| Ideia                                              | Valor para o cliente                                          | Depende de                       | Esforço (P/M/G) |
| -------------------------------------------------- | ------------------------------------------------------------- | -------------------------------- | --------------- |
| Perguntas do tipo arquivo (FM7)                    | Receber exame, documento ou foto                              | Armazenamento de arquivos e LGPD | G               |
| Envio do link por WhatsApp e e-mail pelo sistema   | Menos trabalho manual da equipe                               | Plano do bot, canal oficial      | G               |
| Retenção configurável de respostas na anonimização | Atender a guarda de prontuário sem violar o pedido do titular | Decisão do jurídico              | M               |
| Validação de idade e fluxo de menor                | Reduz risco jurídico                                          | Decisão do jurídico              | M               |
| Resposta com NPS e pesquisa de satisfação          | Medir atendimento                                             | Plano do bot                     | M               |

## Mapa técnico

**Rotas de configuração** (só gestão, `crm.formularios`), base `/crm/configuracoes/formularios`: `GET /`, `GET /campos-elegiveis`, `POST /`, `GET /:id`, `PUT /:id`, `POST /:id/publicar` e `GET /:id/versoes/:versaoId`.

**Rotas da ficha** (qualquer papel que veja a pessoa, `crm.formularios`): `GET /crm/formularios/disponiveis`, `GET /crm/leads/:id/formularios`, `POST /crm/leads/:id/formularios/:formId/link`, `POST .../links/:linkId/revogar`, `GET .../respostas`, `GET .../respostas/:respostaId`, `GET .../alertas` e `POST .../alertas/:alertaId/visto`.

**Rotas públicas** (sem login, sob `/public`): `GET /public/f/:token`, `POST /public/f/:token/aberto` e `POST /public/f/:token/respostas`.

**Contrato**: vive no código, em `controllers/formularios.controller.js`, `controllers/formulario-publico.controller.js` e `schemas/formularios.schema.js`.

**Tabelas** (`modulo_crm`): `crm_form`, `crm_form_version` (0043), `crm_form_link` (0044), `crm_form_submission` (0045), `crm_form_alert` e `crm_form_alert_seen` (0046); ciclo de vida na 0047. Campo sensível na 0042. Eventos `form.link_created`, `link_revoked` e `submitted` no `crm_event`.

**Services centrais**: `formularios.service.js`, `formulario-links.service.js`, `token-formulario.service.js`, `formulario-publico.service.js`, `formulario-respostas.service.js`, `formulario-alertas.service.js`, `formulario-visibilidade.service.js`. Ver também [Oportunidades e pipelines](crm-oportunidades-e-pipelines.md) (eventos) e [Quadro comercial](crm-quadro-comercial.md) (selo do alerta).

**Ambiente**: `FORMS_TOKEN_KEY`, `FRONTEND_URL` (monta o endereço `/f/<token>`).
