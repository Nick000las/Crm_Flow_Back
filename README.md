# CRM Flow Backend

Base modular do backend CRM Flow em Node.js, Fastify, Prisma e PostgreSQL.

## Requisitos

- Node.js 20.11 ou superior
- pnpm 11
- PostgreSQL 14+ com `pgcrypto`, `vector` e `btree_gist` para aplicar as migrations

## Rodando localmente

```bash
pnpm install
cp .env.example .env
pnpm db:generate
pnpm dev
```

Edite o `.env` antes de acessar rotas protegidas ou o banco. O servidor inicia em
`http://localhost:3000` por padrão e expõe `GET /health` sem autenticação.

```bash
curl http://localhost:3000/health
```

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
