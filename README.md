# CRM Flow Backend

Base modular do backend CRM Flow em Node.js, Fastify, Prisma e PostgreSQL.

## Requisitos

- Node.js 20.11 ou superior
- pnpm 11
- Redis 7+ para distribuição dos eventos Socket.IO
- PostgreSQL 14+ com `pgcrypto`, `vector` e `btree_gist` para aplicar as migrations

## Rodando localmente

```bash
pnpm install
cp .env.example .env
pnpm db:generate
docker compose up -d redis
pnpm dev
```

Edite o `.env` antes de iniciar o servidor. `REDIS_URL` deve apontar para o Redis
compartilhado pelas instâncias do backend; por padrão usa `redis://127.0.0.1:6379`.
O `compose.yaml` oferece um Redis local com persistência AOF. Se usar um Redis
gerenciado, configure a URL correspondente e dispense o comando Docker. O servidor inicia em
`http://localhost:3000` por padrão e expõe `GET /health` sem autenticação.

```bash
curl http://localhost:3000/health
```

## Sessão persistente

O frontend inicializa por `GET /auth/session` (ou `?scope=admin`). Sem sessão
válida, recebe `200` com `{ accessToken: null, user: null }`; com cookie válido,
recebe usuário e access token. Cookies legados são migrados nesse bootstrap.
Rotas protegidas continuam respondendo 401 para acesso não autenticado.

`GET /me` restaura a sessão de tenant; `GET /me?scope=admin` restaura a sessão
MASTER. A resposta é `{ statusCode, data: { accessToken, user } }`, com usuário
ativo revalidado, MFA, módulos e flags atuais. A rota também aceita Bearer.
Respostas usam `Cache-Control: no-store`.

Login, ativação de senha e MFA gravam o refresh em cookie httpOnly, sem expô-lo
no corpo. Tenant usa `refresh_token` e MASTER usa `admin_refresh_token`, ambos
com `Path=/`, `SameSite=Lax` e `Secure` em produção. Front e API devem compartilhar
o mesmo site. `/auth/refresh` aceita `{ scope: 'tenant' | 'admin' }`; o escopo
admin exige usuário MASTER. Cookies antigos com `Path=/auth` são migrados no
refresh. Logout remove apenas o cookie da área autenticada, nos dois paths.

`/auth/me` continua disponível para clientes anteriores. Access tokens emitidos
antes do logout permanecem válidos até expirar.

## Banco de dados

```bash
# Desenvolvimento
pnpm db:migrate

# Deploy
pnpm db:migrate:deploy
```

## Qualidade

```bash
pnpm check
```

Os testes que exigem PostgreSQL são ignorados quando `DATABASE_URL` não está definida.

## Contrato de erros HTTP

Toda resposta de erro usa o status HTTP correspondente e o mesmo envelope:

```json
{
  "statusCode": 400,
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Revise os campos destacados",
    "fields": {
      "email": ["Informe um e-mail válido"]
    }
  },
  "requestId": "req-1"
}
```

- `error.code` é estável e deve orientar fluxos no cliente.
- `error.message` é uma mensagem pública, segura e pronta para exibição.
- `error.fields` e `error.details` são opcionais.
- `requestId` permite correlacionar a resposta com os logs do servidor.
- Erros inesperados nunca expõem stack, SQL ou mensagens internas.

## Estrutura

```text
src/
├── api/                 # bootstrap HTTP, plugins, rotas globais e módulos registrados
├── core/                # auth, configuração, banco, erros e contratos compartilhados
├── modules/
│   ├── nucleo/          # CRM, Kanban, agendamento e pagamento
│   └── verticais/       # módulos específicos de nicho
└── shared/              # constantes, formatadores e validadores sem regra de negócio
```

Cada módulo mantém o fluxo `controller → service → adapter`. Acesso multi-tenant ao
banco deve passar por `getTenantClient()` dentro de `adapters/`.

## Kanban em tempo real

Socket.IO usa o mesmo servidor HTTP, endpoint de transporte `/socket.io` e
namespace `/kanban`. Galeria, quadros, comentários e equipes atualizam por eventos.
O frontend recupera o estado por HTTP ao reconectar e renova o access token na
expiração. Consulte [o contrato do Kanban](docs/kanban-implementado.md).

Para os testes com PostgreSQL e Redis de teste configurados:

```sh
KANBAN_TEST_REDIS_URL=redis://127.0.0.1:6379 pnpm test:kanban:integration
```
