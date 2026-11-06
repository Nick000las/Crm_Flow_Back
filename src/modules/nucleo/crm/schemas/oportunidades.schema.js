import { z } from 'zod';
import { TEXT_LIMITS } from '#shared/constants/index.js';
import { LIMITES_OPORTUNIDADE } from '../constants.js';

const titulo = z
  .string({ invalid_type_error: 'Informe um título válido' })
  .trim()
  .max(LIMITES_OPORTUNIDADE.TITULO, 'Título muito longo')
  .nullable()
  .optional();
const valor = z.number({ invalid_type_error: 'Informe um valor válido' }).nullable().optional();
const probabilidadeFechamento = z
  .number({ invalid_type_error: 'Informe um número válido' })
  .nullable()
  .optional();
const dataPrevistaFechamento = z.coerce
  .date({ invalid_type_error: 'Informe uma data válida' })
  .nullable()
  .optional();
const responsavelId = z
  .string({ invalid_type_error: 'Informe um responsável válido' })
  .uuid('Informe um responsável válido')
  .nullable()
  .optional();
const status = z
  .string({ required_error: 'Informe o status', invalid_type_error: 'Informe um status válido' })
  .trim()
  .min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH, 'Informe o status');
const motivoPerda = z
  .string({ invalid_type_error: 'Informe um motivo válido' })
  .nullable()
  .optional();
const expectedUpdatedAt = z
  .string({
    required_error: 'Informe a versão que você está editando',
    invalid_type_error: 'Informe uma versão válida',
  })
  .datetime({ message: 'Informe uma versão válida', offset: true });

export const oportunidadeParamSchema = z.object({
  id: z.string({ required_error: 'Informe a oportunidade' }).uuid('Id de oportunidade inválido'),
});

// POST /crm/leads/:id/oportunidades — sem pipeline, o padrão; sem status, o primeiro aberto.
export const criarOportunidadeBodySchema = z
  .object({
    pipelineId: z.string().uuid('Id de pipeline inválido').optional(),
    status: status.optional(),
    titulo,
    valor,
    probabilidadeFechamento,
    dataPrevistaFechamento,
    motivoPerda,
    responsavelId,
  })
  .strict();

// PUT /crm/oportunidades/:id — parcial; a versão é obrigatória (P8).
export const editarOportunidadeBodySchema = z
  .object({
    titulo,
    valor,
    probabilidadeFechamento,
    dataPrevistaFechamento,
    responsavelId,
    expectedUpdatedAt,
  })
  .strict();

// PATCH /crm/oportunidades/:id/status — versão antiga grava e devolve `conflito: true` (P8).
export const mudarStatusBodySchema = z
  .object({ status, motivoPerda, expectedUpdatedAt: expectedUpdatedAt.optional() })
  .strict();
