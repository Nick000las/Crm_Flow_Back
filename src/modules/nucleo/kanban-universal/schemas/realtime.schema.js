/**
 * @file Valida a estrutura de entrada de realtime, na área de Kanban, antes da execução dos
 * casos de uso.
 */
import { z } from 'zod';

import { QUADRO_ENTIDADE } from '../constants.js';

export const socketIdentitySchema = z.object({
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum(['MASTER', 'DONO', 'OPERADOR']),
  exp: z.number().int().positive(),
});

export const quadroWatchSchema = z
  .object({
    boardType: z.string().regex(/^[a-z0-9_]+$/),
    quadroRef: z.string().trim().min(1).max(QUADRO_ENTIDADE.MAX_REFERENCIA),
  })
  .strict();

export const watchSchema = z
  .object({
    boardId: z.string().uuid(),
    cardId: z.string().uuid().optional(),
  })
  .strict();
