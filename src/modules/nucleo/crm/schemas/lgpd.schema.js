import { z } from 'zod';
import { LISTA_BASES_LEGAIS } from '../constants.js';

// Base legal LGPD (M15). `obrigatoria` liga a obrigatoriedade do campo
// "Base legal" (formulário e import); `basePadrao` = a base dos leads
// criados à mão sem uma escolhida (`null` = sem padrão).
export const salvarLgpdBodySchema = z
  .object({
    basePadrao: z
      .enum(/** @type {[string, ...string[]]} */ ([...LISTA_BASES_LEGAIS]), {
        errorMap: () => ({ message: `Base legal deve ser uma de: ${LISTA_BASES_LEGAIS.join(', ')}` }),
      })
      .nullable(),
    obrigatoria: z.boolean({
      required_error: 'Informe se a base legal é obrigatória',
      invalid_type_error: 'Informe se a base legal é obrigatória',
    }),
  })
  .strict();
