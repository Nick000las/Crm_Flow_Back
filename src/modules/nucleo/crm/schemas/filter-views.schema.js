import { z } from 'zod';
import { TEXT_LIMITS } from '#shared/constants/index.js';
import { filtroLeadsSchema } from './leads-search.schema.js';

export const salvarViewBodySchema = z.object({
  nome: z
    .string({ required_error: 'Informe o nome da view', invalid_type_error: 'Informe um nome válido' })
    .trim()
    .min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH, 'Informe o nome da view'),
  filtros: filtroLeadsSchema,
});

export const viewIdParamSchema = z.object({
  id: z.string({ required_error: 'Informe o id da view' }).uuid('Id de view inválido'),
});
