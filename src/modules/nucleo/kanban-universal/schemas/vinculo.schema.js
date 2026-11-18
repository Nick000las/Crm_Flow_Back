/**
 * @file O tipo é validado pelo registro de provedores: desconhecido responde 404.
 */
import { z } from 'zod';

import { QUADRO_ENTIDADE } from '../constants.js';

export const cardVinculoParamsSchema = z.object({ id: z.string().uuid() }).strict();

/** O tipo é validado pelo registro de provedores: desconhecido responde 404. */
export const entidadeSchema = z
  .object({
    entidadeTipo: z.string().trim().min(1).max(QUADRO_ENTIDADE.MAX_REFERENCIA),
    entidadeId: z.string().uuid(),
  })
  .strict();
