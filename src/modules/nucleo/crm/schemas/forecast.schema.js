import { z } from 'zod';
import { PAGINATION } from '#shared/constants/index.js';
import {
  AGRUPAMENTOS_FORECAST,
  BLOCOS_FORECAST,
  LIMITES_FORECAST,
  TIPOS_MES_FORECAST,
} from '../constants.js';

/** `AAAA-MM`, mês de 01 a 12. */
const PADRAO_MES = /^\d{4}-(0[1-9]|1[0-2])$/;

const mes = (mensagem) =>
  z.string({ invalid_type_error: mensagem }).regex(PADRAO_MES, mensagem).optional();

const pipelineId = z.string().uuid('Id de pipeline inválido').optional();
const responsavelId = z.string().uuid('Informe um responsável válido').optional();

/**
 * @param {Record<string, string>} valores
 * @param {string} mensagem
 */
const umDe = (valores, mensagem) =>
  z.enum(/** @type {[string, ...string[]]} */ (Object.values(valores)), {
    errorMap: () => ({ message: mensagem }),
  });

// GET /crm/forecast. Sem período, o padrão sai do mês atual no fuso do tenant
// (no service, que conhece o fuso); `de > ate` e o limite de meses também.
export const forecastQuerySchema = z
  .object({
    de: mes('Informe o mês inicial no formato AAAA-MM'),
    ate: mes('Informe o mês final no formato AAAA-MM'),
    pipelineId,
    responsavelId,
    agrupar: umDe(
      AGRUPAMENTOS_FORECAST,
      `Agrupe por: ${Object.values(AGRUPAMENTOS_FORECAST).join(', ')}`,
    ).default(AGRUPAMENTOS_FORECAST.TOTAL),
  })
  .superRefine((query, ctx) => {
    // As chaves de status são de cada pipeline.
    if (query.agrupar === AGRUPAMENTOS_FORECAST.STATUS && !query.pipelineId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['agrupar'],
        message: 'Escolha um pipeline para agrupar por status',
      });
    }
  });

// GET /crm/forecast/oportunidades: um mês (com o tipo) ou um bloco. A paginação
// segue a do módulo (`pagina`/`tamanho`, como em GET /crm/leads).
export const oportunidadesDoForecastQuerySchema = z
  .object({
    mes: mes('Informe o mês no formato AAAA-MM'),
    tipo: umDe(TIPOS_MES_FORECAST, 'Tipo deve ser realizado ou aberto').optional(),
    bloco: umDe(
      BLOCOS_FORECAST,
      `Bloco deve ser um de: ${Object.values(BLOCOS_FORECAST).join(', ')}`,
    ).optional(),
    de: mes('Informe o mês inicial no formato AAAA-MM'),
    ate: mes('Informe o mês final no formato AAAA-MM'),
    pipelineId,
    responsavelId,
    pagina: z.coerce.number().int().min(PAGINATION.MIN_PAGE).default(PAGINATION.DEFAULT_PAGE),
    tamanho: z.coerce
      .number()
      .int()
      .min(PAGINATION.MIN_ITEMS_PER_PAGE)
      .max(LIMITES_FORECAST.TAMANHO_MAXIMO)
      .default(LIMITES_FORECAST.TAMANHO_PADRAO),
  })
  .superRefine((query, ctx) => {
    if (Boolean(query.mes) === Boolean(query.bloco)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mes'],
        message: 'Informe um mês ou um bloco (um dos dois)',
      });
    }
    if (query.mes && !query.tipo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tipo'],
        message: 'Informe o tipo: realizado ou aberto',
      });
    }
  });

// POST /crm/forecast/data-prevista. A data é obrigatória: `null` viraria 1970
// no `coerce`, por isso ela passa como texto antes.
export const dataPrevistaEmLoteBodySchema = z
  .object({
    oportunidadeIds: z
      .array(z.string().uuid('Id de oportunidade inválido'), {
        required_error: 'Informe as oportunidades',
        invalid_type_error: 'Informe as oportunidades',
      })
      .min(1, 'Informe ao menos uma oportunidade')
      .max(
        LIMITES_FORECAST.IDS_POR_LOTE,
        `Use no máximo ${LIMITES_FORECAST.IDS_POR_LOTE} oportunidades`,
      )
      .refine((ids) => new Set(ids).size === ids.length, 'Não repita oportunidades'),
    dataPrevistaFechamento: z
      .string({
        required_error: 'Informe a data prevista',
        invalid_type_error: 'Informe uma data válida',
      })
      .pipe(z.coerce.date({ errorMap: () => ({ message: 'Informe uma data válida' }) })),
  })
  .strict();
