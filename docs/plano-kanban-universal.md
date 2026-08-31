# Plano de Implementação — Kanban Universal

## Objetivo

Construir um único motor de Kanban multi-tenant que possa ser reutilizado por
CRM, projetos e módulos verticais. O motor deve cuidar de quadros, colunas,
cards, ordenação, movimentação, comentários e eventos em tempo real, sem
incorporar regras específicas de um domínio.

Este plano detalha o item 1.6.1 e os requisitos de estado descritos no
`MASTER_DOCUMENT.md`.

## Arquitetura

O Kanban é um módulo de produto e deve permanecer em:

```text
src/modules/nucleo/kanban-universal/
├── index.js
├── controllers/
│   ├── boards.controller.js
│   ├── colunas.controller.js
│   ├── cards.controller.js
│   └── comments.controller.js
├── services/
│   ├── boards.service.js
│   ├── colunas.service.js
│   ├── cards.service.js
│   └── comments.service.js
├── adapters/
│   ├── boards.repository.js
│   ├── colunas.repository.js
│   ├── cards.repository.js
│   └── comments.repository.js
├── schemas/
├── types/
└── prisma/
```

A direção de dependência obrigatória é:

```text
controller -> service -> adapter -> getTenantClient -> PostgreSQL
```

- Controller: protocolo HTTP, validação Zod e formatação da resposta.
- Service: regras de movimentação, permissão, ordenação e conflito.
- Adapter: SQL, transações e filtro explícito por `tenant_id`.
- `src/api/routes`: somente rotas de infraestrutura global. O Kanban não
  deve ser implementado nessa pasta.

## Modelo de dados

```text
Tenant
└── Board
    ├── Colunas ordenadas
    │   └── Cards ordenados
    │       ├── Responsável
    │       ├── Dados extras
    │       └── Comentários
    └── board_type
```

### Responsabilidade das tabelas

- `boards`: quadro de um tenant e seu tipo, como `crm_leads`, `projetos` ou
  `postagens_agencia`.
- `colunas`: etapas e ordem visual dentro de um board.
- `cards`: título, coluna atual, ordem, responsável e dados adicionais.
- `card_comments`: comentários e chat interno do card.

### Decisão obrigatória: CRM e Kanban

Hoje existem dois estados independentes:

- `modulo_crm.leads.funil_estagio_id`;
- `modulo_kanban_universal.cards.coluna_id`.

Antes de integrar o CRM ao motor universal, deve existir uma única fonte de
verdade para a etapa. A recomendação é:

1. O CRM continua sendo dono dos dados do lead: nome, telefone, valor,
   origem e demais campos relacionais.
2. O Kanban passa a ser dono do estado visual: board, coluna e ordem.
3. Uma relação explícita associa o lead ao card, preferencialmente por uma
   tabela `modulo_crm.lead_kanban_cards` com `tenant_id`, `lead_id` e
   `card_id`.
4. `dados_extras` guarda apenas dados flexíveis de apresentação; ele não
   deve duplicar campos relacionais críticos do lead.
5. `funil_estagio_id` não deve continuar como uma segunda etapa gravável
   depois da migração. Durante a transição, qualquer compatibilidade deve
   ter prazo para remoção e teste contra divergência.

## Integridade e isolamento

Todas as operações devem passar por `getTenantClient(tenantId, callback)`.
RLS continua obrigatório em todas as tabelas que possuem `tenant_id`.

Além do RLS, o banco deve impedir estados estruturalmente inválidos:

- Uma coluna deve pertencer ao mesmo tenant do board.
- Um card deve pertencer ao mesmo tenant e board da coluna.
- O responsável deve pertencer ao tenant do card.
- Um comentário deve pertencer ao mesmo tenant do card e do usuário.
- A API nunca deve aceitar `tenant_id` enviado no body.

Criar constraints compostas que incluam `tenant_id`, `board_id` e os IDs
relacionados. Antes de ativá-las, executar uma consulta de auditoria para
detectar registros antigos inconsistentes.

Toda alteração deve entrar em uma migration nova. Não editar a migration
`0001_init` depois que ela já tiver sido aplicada em algum ambiente.

## Contrato HTTP proposto

### Boards

```http
GET    /kanban/boards
POST   /kanban/boards
GET    /kanban/boards/:boardId
PATCH  /kanban/boards/:boardId
DELETE /kanban/boards/:boardId
```

`GET /kanban/boards/:boardId` deve poder entregar a tela inicial em uma
única requisição, retornando board, colunas ordenadas e cards ordenados.

### Colunas

```http
POST   /kanban/boards/:boardId/colunas
PATCH  /kanban/colunas/:colunaId
PATCH  /kanban/boards/:boardId/colunas/reordenar
DELETE /kanban/colunas/:colunaId
```

Uma coluna com cards não deve ser excluída silenciosamente. A API deve exigir
uma coluna de destino ou rejeitar a operação com conflito.

### Cards

```http
GET    /kanban/boards/:boardId/cards
POST   /kanban/boards/:boardId/cards
GET    /kanban/cards/:cardId
PATCH  /kanban/cards/:cardId
PATCH  /kanban/cards/:cardId/mover
DELETE /kanban/cards/:cardId
```

Corpo inicial da movimentação:

```json
{
  "novaColunaId": "uuid",
  "novaOrdem": 2,
  "expectedUpdatedAt": "2026-08-31T12:00:00.000Z"
}
```

`expectedUpdatedAt` permite detectar que outro usuário alterou o card desde
a última leitura. A política continua sendo last-write-wins, mas o conflito
fica observável e pode gerar aviso em tempo real.

### Comentários

```http
GET    /kanban/cards/:cardId/comments
POST   /kanban/cards/:cardId/comments
DELETE /kanban/comments/:commentId
```

## Fluxo de movimentação

1. O frontend move o card imediatamente com Optimistic UI.
2. Envia card, coluna de destino, nova posição e versão conhecida.
3. O controller valida UUIDs e body com Zod.
4. O service verifica card, coluna, board, tenant e permissão.
5. O adapter executa toda a reordenação em uma única transação.
6. A API retorna o card persistido com sua nova ordem e `updated_at`.
7. O backend publica o evento na sala do tenant/board.
8. Se houver erro, o frontend executa Noisy Rollback e mostra um toast.
9. Se houver edição concorrente recente, o movimento permanece, mas os
   clientes recebem um aviso informativo.

O repository deve verificar a quantidade de linhas alteradas. Card ou coluna
inexistente não pode resultar em `200 OK` silencioso.

## Autorização

Todas as rotas exigem `authenticateHook`. Também deve existir um gate que
confirme que `kanban_universal` está ativo em `tenant_modules`.

Matriz inicial sugerida:

| Ação                      | MASTER | DONO | OPERADOR |
| ------------------------- | -----: | ---: | -------: |
| Visualizar boards e cards |    Sim |  Sim |      Sim |
| Criar e editar cards      |    Sim |  Sim |      Sim |
| Mover cards               |    Sim |  Sim |      Sim |
| Criar e ordenar colunas   |    Sim |  Sim |      Não |
| Excluir board ou coluna   |    Sim |  Sim |      Não |

A matriz deve ser confirmada com a regra comercial antes da implementação.

## Fases de implementação

### Fase 0 — Decisões e limpeza

- [ ] Confirmar a fonte de verdade da etapa do CRM.
- [ ] Confirmar a matriz de permissões.
- [ ] Confirmar a estratégia de ordenação dos cards.
- [ ] Remover o stub não registrado de `src/api/routes/kanban.routes.js`.
- [ ] Padronizar nomes em português ou inglês sem misturar os dois dentro
      da mesma camada.

### Fase 1 — Banco e leitura do board

- [ ] Criar migration com constraints compostas.
- [ ] Criar índices para board, coluna e ordem.
- [ ] Implementar listagem de boards do tenant.
- [ ] Implementar consulta agregada de board, colunas e cards.
- [ ] Retornar DTO consistente, preferencialmente em `camelCase`.

### Fase 2 — CRUD básico

- [ ] Criar e editar boards.
- [ ] Criar, editar e reordenar colunas.
- [ ] Criar, editar e excluir cards.
- [ ] Aplicar RBAC e gate de módulo ativo.

### Fase 3 — Movimentação robusta

- [ ] Validar coluna de destino no mesmo tenant e board.
- [ ] Reordenar origem e destino atomicamente.
- [ ] Retornar `404` para recurso inexistente.
- [ ] Retornar `409` para estado incompatível.
- [ ] Detectar edição concorrente por timestamp ou versão.
- [ ] Implementar contrato de Optimistic UI e Noisy Rollback.

### Fase 4 — Colaboração

- [ ] Implementar comentários por card.
- [ ] Criar salas em tempo real por tenant/board/card.
- [ ] Publicar criação, edição, movimento e exclusão.
- [ ] Notificar conflitos concorrentes sem bloquear last-write-wins.

### Fase 5 — Integração com CRM e outros módulos

- [ ] Criar associação entre lead e card.
- [ ] Migrar os estágios do CRM para colunas do board correspondente.
- [ ] Impedir dupla gravação de etapa.
- [ ] Documentar como novos `board_type` registram seus schemas de card.
- [ ] Preparar eventos para mini-automações futuras.

## Testes obrigatórios

### Unitários

- Services com adapters mockados.
- Validação de movimento entre boards.
- Reordenação na mesma coluna e entre colunas.
- Permissões por role.
- Tratamento de card/coluna inexistente.

### Integração

- Rotas com `app.inject()` e JWT válido/inválido.
- Transação de movimentação e rollback.
- Constraints de tenant, board e coluna.
- Concorrência de duas movimentações.
- Tenant sem o módulo contratado.

### Segurança

- `pnpm test:rls-coverage`.
- `pnpm test:tenant-isolation`.
- Tentativa de consultar e mover card de outro tenant.
- Tentativa de usar coluna de outro tenant ou board.

## Critérios de conclusão do MVP

- Um tenant consegue criar e consultar seu board com colunas ordenadas.
- Usuários autorizados conseguem criar, editar, mover e excluir cards.
- Movimento e reordenação são atômicos.
- O banco impede referências cruzadas entre tenant, board e coluna.
- Nenhuma operação inexistente retorna sucesso silencioso.
- O frontend consegue aplicar Optimistic UI e Noisy Rollback.
- Dois tenants não conseguem visualizar nem alterar dados um do outro.
- Testes unitários, integração, RLS, isolamento e lint passam no CI.

## Fora do escopo do MVP

- Automações configuráveis por mudança de coluna.
- Histórico analítico completo de permanência por etapa.
- Templates avançados de board.
- Dependências, subtarefas e cronograma de projetos.
- Customização irrestrita do schema de `dados_extras` pelo usuário.
