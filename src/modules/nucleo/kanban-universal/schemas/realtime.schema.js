import { z } from 'zod';

export const socketIdentitySchema = z.object({
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum(['MASTER', 'DONO', 'OPERADOR']),
  exp: z.number().int().positive(),
});

export const watchSchema = z
  .object({
    boardId: z.string().uuid(),
    cardId: z.string().uuid().optional(),
  })
  .strict();
