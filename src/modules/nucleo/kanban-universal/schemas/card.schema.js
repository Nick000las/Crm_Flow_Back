import { z } from 'zod';

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 20000;
const MAX_LABELS = 12;
const MAX_LABEL_NAME = 30;
const MAX_CHECKLIST_ITEMS = 100;
const DATE_LENGTH = 10;
const uuid = z.string().uuid();
const title = z.string().trim().min(1).max(MAX_TITLE);
const uniqueIds = (items) => new Set(items.map((item) => item.id)).size === items.length;

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, DATE_LENGTH) === value;
  }, 'Informe uma data válida.');

// Campos específicos de cada tipo de quadro continuam disponíveis no JSON.
// Campos comuns têm contrato explícito e não recebem defaults durante PATCH.
export const cardDetailsSchema = z
  .object({
    descricao: z.string().max(MAX_DESCRIPTION).optional(),
    prioridade: z.enum(['sem_prioridade', 'baixa', 'media', 'alta', 'urgente']).optional(),
    prazo: date.nullable().optional(),
    prazoConcluido: z.boolean().optional(),
    etiquetas: z
      .array(
        z
          .object({
            id: uuid,
            nome: z.string().trim().min(1).max(MAX_LABEL_NAME),
            cor: z.enum(['azul', 'verde', 'amarelo', 'vermelho', 'roxo', 'cinza']),
          })
          .strict(),
      )
      .max(MAX_LABELS)
      .refine(uniqueIds, 'Não repita etiquetas.')
      .optional(),
    checklist: z
      .array(
        z
          .object({
            id: uuid,
            titulo: title,
            concluido: z.boolean(),
          })
          .strict(),
      )
      .max(MAX_CHECKLIST_ITEMS)
      .refine(uniqueIds, 'Não repita itens do checklist.')
      .optional(),
  })
  .passthrough();

export const cardSchema = z
  .object({
    titulo: title,
    responsavelId: uuid.nullable().optional(),
    dadosExtras: cardDetailsSchema.optional(),
  })
  .strict();

export const cardUpdateSchema = cardSchema
  .partial()
  .extend({
    expectedUpdatedAt: z.string().datetime().optional(),
  })
  .refine((value) => ['titulo', 'responsavelId', 'dadosExtras'].some((key) => key in value), {
    message: 'Informe pelo menos um campo para atualizar.',
  });
