/**
 * @file Adapta requisições HTTP de kanban, na área de Kanban, para os serviços e formata suas
 * respostas.
 */
import { z } from 'zod';

import { sendSuccess } from '#shared/http/response.js';

import { TIPOS_QUADRO } from '../constants.js';
import { cardSchema, cardUpdateSchema } from '../schemas/card.schema.js';
import { batchSchema, flowRulesSchema } from '../schemas/flow.schema.js';
import { operarKanban } from '../services/kanban.service.js';
import { apresentarVinculos } from '../services/vinculo.service.js';

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
    regrasFluxo: flowRulesSchema.optional(),
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
      const valor = await operarKanban(req.tenantContext, action, id, data, app.publicarKanban);

      return sendSuccess(
        reply,
        await apresentarVinculos(req.tenantContext, action, valor, req.log),
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
  route('get', '/kanban/boards/:id/relatorio', 'report.get');
  route('get', '/kanban/boards/:id/metricas', 'metrics.get');
  route('post', '/kanban/boards/:id/cards/lote', 'card.batch', batchSchema);

  route(
    'post',
    '/kanban/cards/:id/duplicar',
    'card.duplicate',
    z.object({ modelo: z.boolean().default(false) }).strict(),
  );

  route(
    'put',
    '/kanban/cards/:id/seguir',
    'card.follow',
    z.object({ seguindo: z.boolean() }).strict(),
  );

  route(
    'patch',
    '/kanban/comments/:id',
    'comment.update',
    z.object({ conteudo: z.string().trim().min(1).max(MAX_COMMENT) }).strict(),
  );

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
        boardType: z.enum(TIPOS_QUADRO),
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
