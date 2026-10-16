import { z } from 'zod';
import { BRAZIL_PHONE, PAGINATION } from '#shared/constants/index.js';

const brazilPhonePattern = new RegExp(
  `^\\d{${BRAZIL_PHONE.LANDLINE_LENGTH},${BRAZIL_PHONE.MOBILE_LENGTH}}$`,
);

export const telefoneSchema = z
  .string()
  .regex(
    brazilPhonePattern,
    `Telefone deve ter ${BRAZIL_PHONE.LANDLINE_LENGTH} ou ${BRAZIL_PHONE.MOBILE_LENGTH} dígitos, sem formatação`,
  );

export const uuidSchema = z.string().uuid();

export const emailSchema = z.string().email();

export const paginacaoSchema = z.object({
  page: z.coerce.number().int().min(PAGINATION.MIN_PAGE).default(PAGINATION.DEFAULT_PAGE),
  perPage: z.coerce
    .number()
    .int()
    .min(PAGINATION.MIN_ITEMS_PER_PAGE)
    .max(PAGINATION.MAX_ITEMS_PER_PAGE)
    .default(PAGINATION.DEFAULT_ITEMS_PER_PAGE),
});

/**
 * Nome IANA canônico de um fuso (`america/sao_paulo` → `America/Sao_Paulo`),
 * ou `null` se o `Intl` do Node não o reconhece. Valida pelo próprio
 * runtime em vez de uma lista fixa, que envelheceria com o tzdata.
 *
 * @param {string} fuso
 * @returns {string | null}
 */
export function normalizarFusoHorario(fuso) {
  try {
    return new Intl.DateTimeFormat('pt-BR', { timeZone: fuso }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

export const fusoHorarioSchema = z
  .string()
  .trim()
  .transform((fuso, ctx) => {
    const canonico = normalizarFusoHorario(fuso);
    if (!canonico) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Fuso horário inválido — use um nome IANA, ex: America/Sao_Paulo',
      });
      return z.NEVER;
    }
    return canonico;
  });
