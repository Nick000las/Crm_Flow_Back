# Plataforma

> Estado em 21/11/2026. Fonte: código do back (`src/core/`, `src/api/`, `src/workers/`, `scripts/`).

## O que é

A plataforma é a base que todos os módulos (CRM, Kanban e os demais) usam: entrar no sistema, saber quem é cada pessoa e o que ela pode fazer, separar os dados de cada empresa cliente e decidir quais módulos e novidades cada empresa enxerga. A equipe da plataforma (papel MASTER) cria as empresas, liga os módulos e libera funcionalidades novas aos poucos pelo painel de administração. A empresa cliente tem um dono (DONO) e usuários comuns (OPERADOR). Ainda não há cobrança automática: o status da empresa (teste, ativa, em atraso, suspensa, cancelada) existe como registro, mas quase não muda o que a empresa consegue fazer.

## Features

### Login por e-mail e convite

O acesso nasce de um convite: o usuário é criado sem senha, informa o e-mail e recebe um código de 6 dígitos por e-mail para criar a senha. Depois disso o login é e-mail e senha.

- O código de ativação vale 10 minutos, aceita 5 tentativas e só pode ser reenviado depois de 1 minuto.
- A senha tem no mínimo 8 caracteres.
- O e-mail é único em toda a plataforma, sem diferenciar maiúsculas de minúsculas.
- Usuário inativo ou sem convite recebe a resposta "convite não encontrado".

### Segunda etapa (MFA) por código de e-mail

O usuário pode ligar a verificação em duas etapas nas suas configurações. Com ela ligada, depois da senha chega um código de 6 dígitos por e-mail.

- O código vale 5 minutos e aceita 5 tentativas.
- Para desligar, o usuário precisa informar a senha.
- Não existe aplicativo autenticador (TOTP): só e-mail.
- Se o e-mail falhar, o login não avança (não há caminho alternativo).

### Sessão e renovação

O token de acesso dura 15 minutos. A renovação usa um cookie protegido (`httpOnly`) de 7 dias, o que mantém a pessoa logada ao atualizar a página. A área de administração (MASTER) tem cookie próprio, então a sessão de uma empresa e a do administrador convivem no mesmo navegador sem se sobrescrever.

- O cookie só exige HTTPS em produção.
- Rotas de login, ativação, MFA, renovação, sessão, sair, "quem sou eu" e configurações da conta estão no mapa técnico.

### Papéis e permissões (RBAC)

Há três papéis fixos. O papel vem do token e é conferido em cada rota.

| Papel    | Quem é                     | Alcance                                                |
| -------- | -------------------------- | ------------------------------------------------------ |
| MASTER   | Equipe da plataforma       | Rotas `/admin/*`; também entra nos módulos como gestão |
| DONO     | Dono do negócio do cliente | Configura o módulo; gestão dos quadros e do CRM        |
| OPERADOR | Usuário comum              | Trabalho do dia a dia dentro do que lhe é liberado     |

Nos módulos, "gestão" é DONO e MASTER. Em geral, a escrita de configuração é só da gestão, a leitura é de todos e o papel é conferido antes da flag.

### Isolamento entre empresas (multi-tenant e RLS)

Cada empresa só enxerga os próprios dados. A garantia é do banco de dados (segurança por linha, RLS), não só do código: o acesso de negócio usa um perfil de banco restrito (`app_tenant`) e cada consulta roda dentro de uma transação marcada com a empresa. Três testes bloqueiam o CI: toda tabela com empresa tem RLS, uma empresa não lê a outra, e toda chave estrangeira respeita a empresa.

### Módulos por empresa

A empresa só usa os módulos contratados. A checagem acontece no servidor a cada requisição de módulo (esconder o menu na tela não basta); sem o módulo, a resposta é 403 `MODULE_NOT_ENABLED`. Os módulos registrados hoje são: CRM, Kanban Universal, Agendamento, Pagamento in-chat, Estética capilar e Tatuagem. O catálogo de módulos é o código (`src/api/modules.js`), não uma tabela.

- Desligar um módulo preserva o histórico (a linha fica marcada como desligada) e o módulo volta se for contratado de novo.
- Contratar ou reativar um módulo roda o ajuste inicial dele (por exemplo, os campos padrão do CRM).

### Feature flags por empresa

Cada módulo declara suas flags (por exemplo `crm.forecast`) e a equipe da plataforma liga ou desliga por empresa. Servem para liberar novidades aos poucos e para desligar rápido se algo der errado; não são cobrança. A flag sai do código uma ou duas versões depois de estabilizar.

- Flag desligada devolve 403 `FEATURE_NOT_ENABLED`.
- Ligar uma flag de módulo ainda não contratado é permitido: dá para preparar a liberação antes da contratação.
- Ao ligar uma flag, o módulo pode ajustar o que ela precisa (o forecast liga os campos de que depende). Se esse ajuste falhar, a flag continua ligada.
- Com Redis, desligar vale na hora em todas as instâncias. O cache de flags e de módulos dura 30 segundos.

### Administração da plataforma (MASTER)

O painel permite criar e acompanhar empresas.

- Criar empresa cria, de uma vez só, a empresa, o dono (DONO, sem senha, em estado de convite) e os módulos contratados. Se algo falhar, nada é gravado.
- Editar dados da empresa (nome, domínio, região dos dados, retenção de conversa, fuso), trocar o status, trocar a lista de módulos, ligar flags e desligar um módulo.
- Status possíveis: `trial`, `active`, `past_due`, `suspenso`, `cancelado`. Não há automação de cobrança.
- Excluir empresa apaga tudo de forma permanente e imediata; o prazo depois do cancelamento ainda não tem job.

### Notificações dentro do sistema (sino)

Qualquer módulo pode avisar um usuário. O usuário lista as próprias notificações (paginado), marca uma ou todas como lidas e não vê as dos outros. Repetições são evitadas por uma chave: um job que roda de hora em hora gera a mesma notificação uma vez só. Hoje o CRM usa isso no resumo de leads esfriando.

### Páginas públicas sem login

Módulos podem expor páginas sem login sob `/public` (hoje, o link de formulário do CRM). Tudo ali tem limite de 120 requisições por minuto por IP, resposta que não fica em cache, não vai para buscador e não envia o endereço a outro site. A URL com o token do link não vai para o log. Se o Redis cair, o limite deixa de valer e a página continua no ar.

### Tempo real

Há um servidor de tempo real (Socket.IO, só WebSocket) com namespaces autenticados dos módulos; hoje o Kanban usa. Fora de testes, exige Redis: sem `REDIS_URL` o servidor não sobe. Detalhes em [Kanban](kanban.md).

### Cache com Redis

Um cache simples guarda módulos e flags por 30 segundos e outras leituras caras. Cache nunca é a fonte da verdade: se o Redis cair, a leitura volta ao banco. Sem Redis (desenvolvimento e testes), usa memória do processo.

### Filas e workers

Tarefas demoradas ou agendadas rodam em processos separados do servidor, com filas BullMQ no Redis.

- `worker:crm`: importação de planilha, purga da lixeira, resumo de esfriando, snapshot semanal do forecast e enriquecimento por CNPJ.
- `worker:kanban`: varredura diária dos vínculos de card com pessoa.
- Os e-mails do Kanban não usam worker: rodam dentro do servidor HTTP.

### Fuso horário da empresa

Cada empresa tem um fuso (padrão `America/Sao_Paulo`). Jobs que falam com o usuário no horário local usam esse fuso (por exemplo, o resumo diário do CRM e o lembrete de prazo do Kanban). A varredura de vínculos do Kanban é a exceção: usa o horário de Brasília fixo.

### Scripts de operação

| Comando              | Para que serve                                                                       |
| -------------------- | ------------------------------------------------------------------------------------ |
| `pnpm create:master` | Cria o primeiro MASTER (não dá para criar pela API). Nasce em convite, sem senha.    |
| `pnpm create:tenant` | Cria empresa, dono e módulos (a mesma operação do painel). Para desenvolvimento.     |
| `pnpm create:user`   | Acrescenta DONO ou OPERADOR a uma empresa existente (ainda não há tela de convite).  |
| `pnpm reconcile`     | Leva cada empresa ao estado que o código atual espera. Idempotente. Passo de deploy. |
| `pnpm crm:reconcile` | O mesmo, só para o CRM.                                                              |

## Estado

| Feature               | Back    | Front                            | Flag          | Origem        |
| --------------------- | ------- | -------------------------------- | ------------- | ------------- |
| Login, convite, senha | pronto  | sem handoff (contrato no código) | sempre ligado | Fundação      |
| MFA por e-mail        | pronto  | sem handoff (contrato no código) | sempre ligado | Fundação      |
| Sessão e renovação    | pronto  | sem handoff (contrato no código) | sempre ligado | Fundação      |
| Papéis e RBAC         | pronto  | sem handoff (contrato no código) | sempre ligado | Fundação      |
| Isolamento e RLS      | pronto  | não se aplica                    | sempre ligado | Fundação      |
| Módulos por empresa   | pronto  | sem handoff (contrato no código) | sempre ligado | Fundação      |
| Feature flags         | pronto  | sem handoff (contrato no código) | sempre ligado | Configurações |
| Administração MASTER  | parcial | sem handoff (contrato no código) | sempre ligado | Fundação      |
| Notificações (sino)   | pronto  | sem handoff (contrato no código) | sempre ligado | M9            |
| Páginas públicas      | pronto  | handoff entregue (FM3)           | sempre ligado | FM3           |
| Tempo real            | pronto  | handoff entregue (Kanban, M5)    | sempre ligado | Kanban        |
| Cache                 | pronto  | não se aplica                    | sempre ligado | Fundação      |
| Filas e workers       | parcial | não se aplica                    | sempre ligado | Fundação      |
| Fuso da empresa       | pronto  | sem handoff (contrato no código) | sempre ligado | M9            |
| Scripts de operação   | pronto  | não se aplica                    | sempre ligado | Fundação      |

Administração MASTER é parcial: faltam cobrança automática e exclusão com prazo. Filas e workers são parciais: os workers ainda não estão no `compose.yaml` nem no CI.

## Regras e limites

**Login e sessão**

- Token de acesso: 15 minutos. Renovação: 7 dias, em cookie `httpOnly`, `sameSite=lax`.
- Código de ativação: 6 dígitos, 10 minutos, 5 tentativas, reenvio após 1 minuto.
- Código de MFA: 6 dígitos, 5 minutos, 5 tentativas, reenvio após 1 minuto.
- Senha com no mínimo 8 caracteres.

**Papéis**

- MASTER é a equipe da plataforma (`/admin/*`). O token aceita MASTER sem empresa, mas o script `create:master` cria o MASTER dentro de uma empresa "guarda-chuva" da plataforma, porque todo usuário pertence a uma empresa.
- A criação de empresa sempre cria o dono como DONO, nunca como MASTER.
- Ninguém cria MASTER pela API.

**Módulos e flags**

- Flag desligada: 403 `FEATURE_NOT_ENABLED`. Módulo não contratado: 403 `MODULE_NOT_ENABLED`.
- Troca de módulos e de flags é por substituição: a lista enviada vira o conjunto inteiro. Lista vazia de flags desliga todas.
- Só entram no catálogo as flags que o módulo declara; qualquer outra é recusada.

**Status da empresa**

- O status não bloqueia login nem API. O único efeito no código é que a página pública de formulário some para empresa suspensa ou cancelada.
- Jobs por empresa pulam quem tem `cancelado_em` preenchido, exceto a purga da lixeira do CRM, que roda também em empresa cancelada (prazo de retenção).

**Páginas públicas**

- 120 requisições por minuto por IP em todo `/public`; cada rota pode somar o limite dela (por link).

## Fica de fora

| Item                                                     | Motivo                                                    | Quando volta                           |
| -------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------- |
| Cobrança automática e efeito do status na conta          | Há tabelas de assinatura e cobrança, sem rotina nem regra | Sem data; depende de decisão comercial |
| Exclusão de empresa só depois do prazo de cancelamento   | Falta o job agendado                                      | Sem data                               |
| Tela de convite de usuários                              | Hoje só o script `create:user`                            | Sem data                               |
| MFA por aplicativo autenticador (TOTP)                   | Decisão: só código por e-mail                             | Sem data                               |
| Catálogo de módulos em tabela (`module_catalog`)         | O catálogo é o código                                     | Sem data                               |
| Envio em massa e automático de links, WhatsApp e NPS     | Pertence ao plano do bot                                  | Plano do bot                           |
| Cursor do outbox por consumidor e limpeza do `crm_event` | Não implementado                                          | M7 (segunda etapa do Kanban), sem data |

## Ideias de expansão e refinamento

> Sugestões para decidir, não decisões.

| Ideia                                                         | Valor para o cliente                                     | Depende de                             | Esforço (P/M/G) |
| ------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------- | --------------- |
| Status da empresa passa a limitar o acesso (suspensa, atraso) | Dá consequência real ao status e evita uso sem pagar     | Decisão comercial; regra por status    | M               |
| Cobrança e assinatura automáticas                             | Reduz trabalho manual da equipe                          | Provedor de pagamento; regra de status | G               |
| Prazo automático antes de apagar empresa cancelada            | Evita perda acidental de dados                           | Job agendado                           | P               |
| Tela de convite e gestão de usuários                          | O dono convida a equipe sem acionar a plataforma         | Rota de convite; limite por plano      | M               |
| Limite de tentativas no login por senha                       | Reduz risco de força bruta; hoje só `/public` tem limite | `trustProxy` ligado                    | P               |
| Ligar `trustProxy`                                            | O limite por IP passa a usar o IP real do cliente        | Conhecer o proxy de produção           | P               |
| Workers no `compose.yaml` e no CI                             | Jobs sobem junto com o deploy; menos esquecimento        | Decisão de infraestrutura              | P               |
| MFA por aplicativo autenticador                               | Segurança maior que e-mail                               | Biblioteca TOTP; recuperação de acesso | M               |
| Papel intermediário (gerente) ou permissões por módulo        | Acesso mais fino que DONO e OPERADOR                     | Decisão de produto sobre papéis        | G               |
| Mover o e-mail do Kanban para o worker                        | Envio não depende do servidor HTTP estar de pé           | Worker no deploy                       | M               |

## Pendências para produção

- `trustProxy` não está ligado; o limite por IP em `/public` depende dele.
- `worker:crm` e `worker:kanban` não estão no `compose.yaml` nem no CI.
- `pnpm crm:reconcile` precisa rodar a cada deploy.
- O CI (`pr-checks.yml`) nunca rodou num PR.
- `REDIS_URL` e `FORMS_TOKEN_KEY` são necessários (o segundo, para gerar links de formulário).

## Mapa técnico

**Rotas principais**

| Área           | Rotas                                                                                                                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Auth           | `POST /auth/login`, `POST /auth/login/password`, `POST /auth/activation/verify`, `POST /auth/activation/password`, `POST /auth/mfa/verify`, `POST /auth/refresh`, `POST /auth/logout`                                                                  |
| Conta          | `GET /auth/session`, `GET /auth/me`, `GET /auth/settings`, `PUT /auth/mfa`, `DELETE /auth/mfa`                                                                                                                                                         |
| Admin (MASTER) | `POST` e `GET /admin/tenants`, `GET`, `PUT` e `DELETE /admin/tenants/:id`, `PUT /admin/tenants/:id/status`, `PUT /admin/tenants/:id/modules`, `DELETE /admin/tenants/:id/modules/:moduleKey`, `GET /admin/features`, `PUT /admin/tenants/:id/features` |
| Notificações   | `GET /notificacoes`, `POST /notificacoes/:id/lida`, `POST /notificacoes/lidas`                                                                                                                                                                         |
| Saúde          | `GET /health`                                                                                                                                                                                                                                          |
| Públicas       | `/public/*`, registradas por cada módulo (`registerPublicRoutes`)                                                                                                                                                                                      |

O contrato de cada rota vive nos controllers e nos schemas Zod, não neste documento.

**Tabelas do núcleo:** `tenants`, `usuarios`, `codigos_verificacao`, `tenant_modules`, `tenant_module_features`, `notificacoes`, `audit_log`, mais tabelas de assinatura e cobrança sem uso ativo (`assinaturas`, `cobrancas`, `wallets`).

**Flags:** `tenant_module_features` (uma linha por flag ligada). O catálogo vem do `featureFlags` de cada módulo. Funções centrais: `exigirFeature`, `garantirFeature` e `featureAtiva` em `src/core/tenant/feature-flags.js`; `aoLigarFeatures` e `reconciliar` em `src/core/tenant/reconcile.js`.

**Módulos:** `exigirModuloAtivo` em `src/core/tenant/module-access.js`, aplicado a todo módulo por `src/api/app.js`. Contrato do módulo em [MODULE_CONTRACT](../../MODULE_CONTRACT.md); visão geral em [MASTER_DOCUMENT](../MASTER_DOCUMENT.md); padrões em [padrão de código](../padrao-de-codigo.md).

**Banco:** `getTenantClient(tenantId, cb)` (transação com `app.current_tenant`, perfil `app_tenant`, `TENANT_DATABASE_URL`) e `getAdminClient()` (perfil dono, só para administração e jobs). Gates: `test:rls-coverage`, `test:tenant-isolation`, `test:fk-coverage`.

**Jobs e filas:** BullMQ sobre `REDIS_URL` (`src/core/queue/connection.js`); entrypoints em `src/workers/crm.worker.js` e `src/workers/kanban.worker.js`.

**Variáveis de ambiente relevantes:** `JWT_SECRET`, `JWT_REFRESH_SECRET`, `DATABASE_URL`, `TENANT_DATABASE_URL`, `REDIS_URL`, `CORS_ORIGIN`, `FRONTEND_URL`, `SMTP_*`, `FORMS_TOKEN_KEY`, `KANBAN_EMAIL_ENABLED`.
