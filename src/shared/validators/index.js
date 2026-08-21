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
