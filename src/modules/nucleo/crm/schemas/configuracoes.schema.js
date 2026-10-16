import { z } from 'zod';
import { TEXT_LIMITS } from '#shared/constants/index.js';
import { LISTA_CONTEXTOS_VISIBILIDADE } from '../constants.js';

const booleano = (mensagem) => z.boolean({ required_error: mensagem, invalid_type_error: mensagem });

// Parcial: só os contextos enviados mudam. `.strict()` rejeita contexto
// inventado em vez de ignorá-lo em silêncio.
const visibilidadeSchema = z
  .object(
    Object.fromEntries(
      LISTA_CONTEXTOS_VISIBILIDADE.map((contexto) => [contexto, booleano('Informe verdadeiro ou falso').optional()]),
    ),
  )
  .strict();

export const campoIdParamSchema = z.object({
  id: z.string({ required_error: 'Informe o id do campo' }).uuid('Id de campo inválido'),
});

// PUT /crm/configuracoes/campos/:id — `label: null` volta ao nome padrão
// (só campo do sistema). Ao menos uma mudança.
export const atualizarCampoBodySchema = z
  .object({
    label: z
      .string({ invalid_type_error: 'Informe um nome válido' })
      .trim()
      .min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH, 'Informe o nome do campo')
      .nullable()
      .optional(),
    obrigatorio: booleano('Informe se o campo é obrigatório').optional(),
    visibilidade: visibilidadeSchema.optional(),
  })
  .strict()
  .refine(
    (body) => body.label !== undefined || body.obrigatorio !== undefined || body.visibilidade !== undefined,
    'Informe ao menos uma mudança',
  );

// PUT /crm/configuracoes/campos/ordem — todos os campos, na ordem nova.
export const reordenarCamposBodySchema = z.object({
  ids: z
    .array(z.string().uuid('Id de campo inválido'))
    .min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH, 'Informe a ordem dos campos'),
});

// GET /crm/leads/fields?contexto= — campos de uma tela só (M2).
export const contextoCamposQuerySchema = z.object({
  contexto: z
    .enum(/** @type {[string, ...string[]]} */ ([...LISTA_CONTEXTOS_VISIBILIDADE]), {
      errorMap: () => ({ message: `Contexto deve ser um de: ${LISTA_CONTEXTOS_VISIBILIDADE.join(', ')}` }),
    })
    .optional(),
});
