import { z } from 'zod';
import { DIAS_ESFRIAR } from '../constants.js';

// Lead esfriando (M9). Forma só: se a key existe e se o status esfria
// (categoria aberta) é regra por tenant (`inatividade.service.js`).

const diasSchema = z
  .number({ invalid_type_error: 'Informe os dias como número (ou null para desligar)' })
  .int('Os dias devem ser um número inteiro')
  .min(DIAS_ESFRIAR.MIN, `Use no mínimo ${DIAS_ESFRIAR.MIN} dia`)
  .max(DIAS_ESFRIAR.MAX, `Use no máximo ${DIAS_ESFRIAR.MAX} dias`)
  .nullable();

/** PUT /crm/configuracoes/inatividade — `{ status: { <key>: dias | null } }`. */
export const salvarInatividadeBodySchema = z
  .object({
    status: z
      .record(z.string().min(1), diasSchema)
      .refine((mapa) => Object.keys(mapa).length > 0, 'Informe ao menos um status'),
  })
  .strict();
