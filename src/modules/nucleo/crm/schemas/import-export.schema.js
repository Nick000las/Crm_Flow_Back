import { z } from 'zod';
import { TEXT_LIMITS } from '#shared/constants/index.js';
import { ESTRATEGIAS_DUPLICATA, FORMATOS_EXPORTACAO, LISTA_FORMATOS_EXPORTACAO, SITUACOES_LEAD } from '../constants.js';
import { filtroLeadsSchema } from './leads-search.schema.js';

/**
 * Campos de texto do multipart de POST /crm/import/validate. `mapeamento`
 * chega como string JSON (multipart não tem objeto aninhado):
 * `{ "Nome da coluna na planilha": "chaveDoCampo" }`.
 */
export const validarImportacaoCamposSchema = z.object({
  mapeamento: z
    .string({ required_error: 'Informe o mapeamento das colunas' })
    .transform((texto, ctx) => {
      try {
        return JSON.parse(texto);
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Mapeamento deve ser um JSON válido' });
        return z.NEVER;
      }
    })
    .pipe(
      z
        .record(z.string().min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH))
        .refine((mapa) => Object.keys(mapa).length > 0, 'Mapeie ao menos uma coluna'),
    ),
  estrategiaDuplicata: z.enum(ESTRATEGIAS_DUPLICATA, {
    required_error: 'Informe o que fazer com leads duplicados',
    invalid_type_error: 'Estratégia de duplicata inválida',
  }),
});

// POST /crm/import/:jobId/confirm (M7) — body opcional: a ação de cada
// linha duplicada apontada no validate (`{ "12": "atualizar" }`).
export const confirmarImportacaoBodySchema = z
  .object({
    acoes: z
      .record(
        z.string().regex(/^\d+$/, 'Informe o número da linha'),
        z.enum(ESTRATEGIAS_DUPLICATA, { errorMap: () => ({ message: 'Ação deve ser pular, atualizar ou criar' }) }),
      )
      .optional(),
  })
  .strict();

export const importJobIdParamSchema = z.object({
  jobId: z.string({ required_error: 'Informe o id da importação' }).uuid('Id de importação inválido'),
});

export const exportarLeadsBodySchema = z.object({
  // Omitidas (M10, `crm.massa`): as colunas da tabela do usuário — o service
  // resolve pelo layout; sem a flag, continua obrigatório escolher.
  colunas: z
    .array(z.string().min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH))
    .min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH, 'Escolha ao menos uma coluna')
    .optional(),
  // `csv` (M10) exige `crm.massa`.
  formato: z
    .enum(/** @type {[string, ...string[]]} */ ([...LISTA_FORMATOS_EXPORTACAO]), {
      errorMap: () => ({ message: `Formato deve ser um de: ${LISTA_FORMATOS_EXPORTACAO.join(', ')}` }),
    })
    .default(FORMATOS_EXPORTACAO.XLSX),
  // A lixeira não sai em planilha (M5).
  filtro: filtroLeadsSchema
    .refine((filtro) => filtro.situacao !== SITUACOES_LEAD.LIXEIRA, {
      message: 'A lixeira não pode ser exportada',
      path: ['situacao'],
    })
    .optional(),
});
