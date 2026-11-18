/**
 * @file Valida a estrutura de entrada de quadro, na área de Kanban, antes da execução dos casos
 * de uso.
 */
import { z } from 'zod';

import { QUADRO_ENTIDADE } from '../constants.js';

// Quadros de entidade (M2). Os valores são opacos para o motor: quem sabe o
// que é um `quadroRef`, uma coluna ou um filtro é o provedor.
const referencia = z.string().trim().min(1).max(QUADRO_ENTIDADE.MAX_REFERENCIA);
const filtros = z.record(z.unknown()).optional();
const ordem = z.record(z.unknown()).optional();

export const quadroParamsSchema = z.object({
  boardType: z.string().regex(/^[a-z0-9_]+$/),
  quadroRef: referencia,
});

export const cardParamsSchema = quadroParamsSchema.extend({ entidadeId: referencia });

export const buscarCardsBodySchema = z
  .object({
    colunaRef: referencia,
    filtros,
    ordem,
    cursor: z.string().min(1).max(QUADRO_ENTIDADE.MAX_CURSOR).optional(),
    limite: z
      .number()
      .int()
      .min(QUADRO_ENTIDADE.MIN_LIMITE)
      .max(QUADRO_ENTIDADE.MAX_LIMITE)
      .default(QUADRO_ENTIDADE.LIMITE_PADRAO),
  })
  .strict();

export const buscarCardsPorIdsBodySchema = z
  .object({
    ids: z.array(referencia).min(QUADRO_ENTIDADE.MIN_LIMITE).max(QUADRO_ENTIDADE.MAX_LIMITE),
    filtros,
  })
  .strict();

export const resumoColunaBodySchema = z.object({ colunaRef: referencia, filtros }).strict();

export const criarCardBodySchema = z
  .object({ colunaRef: referencia, dados: z.record(z.unknown()) })
  .strict();

export const moverCardBodySchema = z
  .object({
    colunaDestino: referencia,
    expectedUpdatedAt: z.string().datetime().optional(),
    filtros,
    campos: z.record(z.unknown()).optional(),
  })
  .strict();
