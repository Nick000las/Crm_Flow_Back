import { z } from 'zod';

export const telefoneSchema = z
  .string()
  .regex(/^\d{10,11}$/, 'Telefone deve ter 10 ou 11 dígitos, sem formatação');

export const uuidSchema = z.string().uuid();

export const emailSchema = z.string().email();

export const paginacaoSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});
