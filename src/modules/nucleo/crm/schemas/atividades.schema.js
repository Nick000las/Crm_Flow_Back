import { z } from 'zod';
import { PAGINATION, TEXT_LIMITS } from '#shared/constants/index.js';
import { LIMITES_ATIVIDADE, PAGINACAO_EVENTOS } from '../constants.js';

// Atividades e histórico do lead (M6). Se o `tipo` é uma opção ativa da
// lista "Tipo de atividade" é regra por tenant — `atividades.service.js`.

export const atividadeParamSchema = z.object({
  id: z.string({ required_error: 'Informe o id do lead' }).uuid('Id de lead inválido'),
  atividadeId: z.string({ required_error: 'Informe o id da atividade' }).uuid('Id de atividade inválido'),
});

const tipo = z
  .string({ required_error: 'Informe o tipo da atividade', invalid_type_error: 'Informe o tipo da atividade' })
  .trim()
  .min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH, 'Informe o tipo da atividade');

const titulo = z
  .string({ required_error: 'Informe o título da atividade', invalid_type_error: 'Informe o título da atividade' })
  .trim()
  .min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH, 'Informe o título da atividade')
  .max(LIMITES_ATIVIDADE.TITULO, `O título vai até ${LIMITES_ATIVIDADE.TITULO} caracteres`);

const notas = z
  .string({ invalid_type_error: 'Notas inválidas' })
  .trim()
  .max(LIMITES_ATIVIDADE.NOTAS, `As notas vão até ${LIMITES_ATIVIDADE.NOTAS} caracteres`)
  .nullable();

const agendadaPara = z.coerce.date({ invalid_type_error: 'Informe uma data válida' }).nullable();

const concluida = z.boolean({ invalid_type_error: 'Informe se a atividade está concluída' });

// POST /crm/leads/:id/atividades — `concluida: true` registra algo que já
// aconteceu (ligação feita); sem ele, a atividade nasce em aberto.
export const criarAtividadeBodySchema = z
  .object({ tipo, titulo, notas: notas.optional(), agendadaPara: agendadaPara.optional(), concluida: concluida.optional() })
  .strict();

// PUT /crm/leads/:id/atividades/:atividadeId — parcial; `concluida` conclui ou reabre.
export const editarAtividadeBodySchema = z
  .object({ tipo, titulo, notas, agendadaPara, concluida })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Informe ao menos um campo da atividade');

// GET /crm/leads/:id/historico?pagina=&tamanho=
export const historicoQuerySchema = z.object({
  pagina: z.coerce.number().int().min(PAGINATION.MIN_PAGE).default(PAGINATION.DEFAULT_PAGE),
  tamanho: z.coerce
    .number()
    .int()
    .min(PAGINATION.MIN_ITEMS_PER_PAGE)
    .max(PAGINACAO_EVENTOS.TAMANHO_MAXIMO)
    .default(PAGINACAO_EVENTOS.TAMANHO_PADRAO),
});
