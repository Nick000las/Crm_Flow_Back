import { z } from 'zod';
import { TEXT_LIMITS } from '#shared/constants/index.js';
import { CAMADA_2_COLUNAS } from '../constants.js';

// Body de PUT /crm/field-visibility é o array na raiz (mesmo formato de
// PUT /crm/field-definitions/reorder) — parcial: só as colunas enviadas
// são alteradas, as demais mantêm o estado atual (ou o default, se nunca
// configuradas — ver field-visibility.service.js).
export const definirVisibilidadeBodySchema = z
  .array(
    z.object({
      coluna: z.enum(CAMADA_2_COLUNAS, {
        required_error: 'Informe a coluna',
        invalid_type_error: 'Coluna de campo inválida',
      }),
      visivel: z.boolean({
        required_error: 'Informe se o campo é visível',
        invalid_type_error: 'Informe se o campo é visível',
      }),
      ordem: z
        .number({
          required_error: 'Informe a ordem do campo',
          invalid_type_error: 'Informe uma ordem válida',
        })
        .int('A ordem deve ser um número inteiro'),
      obrigatorio: z.boolean({
        required_error: 'Informe se o campo é obrigatório',
        invalid_type_error: 'Informe se o campo é obrigatório',
      }),
    }),
  )
  .min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH, 'Informe ao menos um campo para atualizar');
