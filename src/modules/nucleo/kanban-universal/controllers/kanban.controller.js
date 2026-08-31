import { z } from 'zod';
import { sendSuccess } from '#shared/http/response.js';
import { cardSchema, cardUpdateSchema } from '../schemas/card.schema.js';
import { operarKanban } from '../services/kanban.service.js';
const MAX_NAME = 200;
const MAX_INITIAL_COLUMNS = 10;
const MAX_COMMENT = 10000;
const MAX_WIP_LIMIT = 10000;
const uuid = z.string().uuid();
const permissions = z.array(
  z.object({ id: uuid, permissao: z.enum(['editor', 'leitor']) }).strict(),
);
const columnSchema = z
  .object({
    nome: z.string().trim().min(1).max(MAX_NAME),
    wipLimit: z.number().int().positive().max(MAX_WIP_LIMIT).nullable().optional(),
  })
  .strict();
const name = z.string().trim().min(1).max(MAX_NAME);
const participantes = z
  .array(uuid)
  .refine((ids) => new Set(ids).size === ids.length, { message: 'Não repita participantes.' });
export function registrarRotasKanbanCompleto(app) {
  const route = (method, path, action, schema) =>
    app[method](path, async (req, reply) => {
      const id = req.params.id ? uuid.parse(req.params.id) : undefined;
      const data = schema ? schema.parse(req.body) : undefined;
      return sendSuccess(
        reply,
        await operarKanban(req.tenantContext, action, id, data, app.publicarKanban),
      );
    });
  route('get', '/kanban/membros', 'members');
  route('get', '/kanban/email-preferences', 'email.get');
  route(
    'put',
    '/kanban/email-preferences',
    'email.update',
    z.object({ enabled: z.boolean() }).strict(),
  );
  route('get', '/kanban/boards/:id/arquivados', 'archive.list');
  route('get', '/kanban/cards/:id/activities', 'activity.list');
  route(
    'patch',
    '/kanban/cards/:id/arquivar',
    'card.archive',
    z.object({ expectedUpdatedAt: z.string().datetime().optional() }).strict(),
  );
  route(
    'patch',
    '/kanban/cards/:id/restaurar',
    'card.restore',
    z.object({ expectedUpdatedAt: z.string().datetime().optional() }).strict(),
  );
  route(
    'post',
    '/kanban/boards',
    'board.create',
    z
      .object({
        nome: name,
        boardType: name,
        participantes: participantes.default([]),
        permissoes: permissions.optional(),
        colunasIniciais: z.array(name).max(MAX_INITIAL_COLUMNS).optional(),
      })
      .strict(),
  );
  route('get', '/kanban/boards/:id', 'board.get');
  route(
    'patch',
    '/kanban/boards/:id',
    'board.update',
    z
      .object({
        nome: name,
        participantes: participantes.optional(),
        permissoes: permissions.optional(),
      })
      .strict(),
  );
  route('get', '/kanban/boards/:id/membros', 'board.members');
  route(
    'put',
    '/kanban/boards/:id/membros',
    'board.members.update',
    z.object({ participantes }).strict(),
  );
  route('delete', '/kanban/boards/:id', 'board.delete');
  route('post', '/kanban/boards/:id/colunas', 'column.create', columnSchema);
  route(
    'patch',
    '/kanban/boards/:id/colunas/reordenar',
    'column.reorder',
    z.object({ ids: z.array(uuid) }).strict(),
  );
  route('patch', '/kanban/colunas/:id', 'column.update', columnSchema);
  route('delete', '/kanban/colunas/:id', 'column.delete');
  route('get', '/kanban/boards/:id/cards', 'card.list');
  route('post', '/kanban/boards/:id/cards', 'card.create', cardSchema.extend({ colunaId: uuid }));
  route('get', '/kanban/cards/:id', 'card.get');
  route('patch', '/kanban/cards/:id', 'card.update', cardUpdateSchema);
  route(
    'patch',
    '/kanban/cards/:id/mover',
    'card.move',
    z
      .object({
        novaColunaId: uuid,
        novaOrdem: z.number().int().nonnegative(),
        expectedUpdatedAt: z.string().datetime().optional(),
      })
      .strict(),
  );
  route('delete', '/kanban/cards/:id', 'card.delete');
  route('get', '/kanban/cards/:id/comments', 'comment.list');
  route(
    'post',
    '/kanban/cards/:id/comments',
    'comment.create',
    z
      .object({
        conteudo: z.string().trim().min(1).max(MAX_COMMENT),
        mencionados: participantes.optional(),
      })
      .strict(),
  );
  route('delete', '/kanban/comments/:id', 'comment.delete');
}
