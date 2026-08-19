# Sprint 0 — Fundação (Infra + Auth + Banco de Dados + RLS)

Escopo: tudo que TODO módulo depende, e que só faz sentido construir junto, no mesmo
código, revisando um a resposta do outro em tempo real — diferente das sprints
seguintes, que seguem o `MODULE_CONTRACT.md` e podem ser feitas em paralelo sem
coordenação constante.

## Por que isso é feito junto, e não dividido

Autenticação e o gateway multi-tenant são o "núcleo compartilhado" — se um dos dois
implementar isso "do seu jeito", é exatamente aqui que nasce vazamento de dado entre
tenants (Bloco 2.1) ou inconsistência de token (Bloco 8.2). Depois desta sprint, o
`MODULE_CONTRACT.md` vira a referência única, e cada um trabalha num módulo sem
precisar perguntar nada ao outro.

## O que já está pronto no repositório (não recriar)

| Arquivo | O que já faz |
|---|---|
| `src/core/db/tenantClient.ts` | Gateway multi-tenant — `getTenantClient()` com `SET LOCAL app.current_tenant` via `$transaction` interativo (decisão de MVP, Bloco 2.1) |
| `src/core/auth/jwt.ts` | Assinatura/verificação de access token (15 min) e refresh token (7 dias) — Bloco 8.2 |
| `src/core/auth/rbac.ts` | Hook de autenticação (`authenticateHook`) + `requireRole()` |
| `prisma/schema.prisma` | Modelos `Tenant`, `Usuario`, `TenantModule`, `TenantModuleFeature` |
| `prisma/migrations/0001_init/rls.sql` | RLS aplicado nas 3 tabelas do core, com o modelo comentado pra tabelas de módulo |
| `src/core/db/__tests__/rls-coverage.test.ts` | Bloqueador de CI — varre o banco procurando `tenant_id` sem RLS |
| `src/core/db/__tests__/tenant-isolation.test.ts` | Bloqueador de CI — tenta vazar dado entre dois tenants de teste |
| `MODULE_CONTRACT.md` | Especificação completa de como um módulo deve ser construído |

## O que falta implementar, em ordem

### 1. Provisionar infraestrutura
- [ ] Criar banco no Neon, copiar `DATABASE_URL` pro `.env`
- [ ] Gerar `JWT_SECRET` e `JWT_REFRESH_SECRET` (`openssl rand -hex 32`, um valor diferente
      pra cada)
- [ ] `npm install`
- [ ] `npm run db:migrate` — confirmar que as 4 tabelas do core sobem com RLS aplicado
- [ ] `npm run test:rls-coverage && npm run test:tenant-isolation` — os dois têm que
      passar antes de continuar. Se falhar aqui, não avance — é a fundação de tudo.

### 2. Endpoint de autenticação (falta implementar)
Ainda não existe controller de auth no repositório. Criar `src/core/auth/` (ou um
módulo `nucleo/auth/` seguindo o padrão controller/service/adapter, à escolha de vocês):
- [ ] `POST /auth/login` — valida e-mail/senha (hash com `argon2` ou `bcrypt`, nunca
      texto puro), retorna `{ accessToken, refreshToken }`
- [ ] `POST /auth/refresh` — troca refresh token por access token novo
- [ ] Middleware já existe (`authenticateHook`) — só falta o endpoint que gera o token

### 3. MFA (Bloco 8.2 — obrigatório para Administradores)
Campos `mfaAtivo`/`mfaSecret` já existem no schema `Usuario`. Falta:
- [ ] Fluxo de ativação (gerar secret TOTP, mostrar QR code, confirmar código)
- [ ] Checagem de código TOTP no login quando `mfaAtivo = true`

### 4. Custódia da chave mestra — AWS KMS (Bloco 2.2/7.1)
Ainda não scaffolded. Decisão já tomada: AWS KMS gerenciado, não Vault self-hosted.
- [ ] Criar a chave no console AWS KMS
- [ ] Criar `src/core/crypto/kms.ts` com `encrypt()`/`decrypt()` chamando a API do KMS
      (credencial IAM via `AWS_KMS_KEY_ID`/`AWS_REGION`, já no `.env.example`)
- [ ] Não implementar Lazy Key Rotation ainda (Bloco 2.2) — só a criptografia básica
      funcionando é suficiente pra esta sprint

### 5. Provisionamento de tenant (Bloco 1.1.5)
- [ ] Endpoint administrativo que cria tenant + usuário admin inicial + vínculo de
      módulos contratados como transação atômica (usar `getAdminClient()`, não
      `getTenantClient()` — é operação sem tenant ainda existente)
- [ ] Confirmar que um tenant criado por aqui já nasce com RLS funcionando (teste manual:
      criar 2 tenants, confirmar que um não vê dado do outro via `curl`)

### 6. CI (GitHub Actions)
- [ ] Workflow rodando em todo PR: `npm run lint && npm run test:rls-coverage && npm run test:tenant-isolation`
- [ ] PR não pode ser mergeado se qualquer um desses falhar (branch protection rule)

## Critério de "pronto para dividir e trabalhar sozinhos"

- [ ] Os dois testes de CI passam localmente e no GitHub Actions
- [ ] Login + refresh token funcionando de ponta a ponta (testado via Postman/curl)
- [ ] MFA funcional para role `MASTER`/`DONO`
- [ ] Um tenant de teste criado via endpoint de provisionamento, com RLS confirmado
- [ ] Os dois leram o `MODULE_CONTRACT.md` inteiro e concordam que ele responde
      "como eu crio um módulo novo sem perguntar nada pro outro"

## Depois disso

Dividam por módulo, não por camada — ex: um fica em `modules/nucleo/crm` +
`modules/nucleo/kanban-universal`, o outro começa `modules/verticais/estetica-capilar`.
Cada um segue o `MODULE_CONTRACT.md` isoladamente. Só voltem a se coordenar em conjunto
se algo exigir mudar `src/core/` ou `src/shared/` — mudança em core sempre é revisada
pelos dois, porque afeta todo módulo já construído.
