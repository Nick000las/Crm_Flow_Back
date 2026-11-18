/**
 * @file Valida a estrutura de entrada de flow, na área de Kanban, antes da execução dos casos
 * de uso.
 */
import { z } from 'zod';

const MAX_DAYS = 365;
const MAX_TASK_TITLE = 200;
const MAX_LABEL_NAME = 30;

export const MAX_BATCH_CARDS = 100;
export const MAX_DEPENDENCIES = 50;
export const automationSchema = z
  .object({
    concluir: z.boolean().optional(),
    responsavelId: z.string().uuid().nullable().optional(),
    prazoDias: z.number().int().min(0).max(MAX_DAYS).nullable().optional(),
    tarefa: z.string().trim().max(MAX_TASK_TITLE).optional(),
  })
  .strict();
export const flowRulesSchema = z
  .object({
    exigirResponsavel: z.boolean().optional(),
    exigirPrazo: z.boolean().optional(),
    exigirChecklist: z.boolean().optional(),
    diasSemMovimento: z.number().int().positive().max(MAX_DAYS).nullable().optional(),
    automacao: automationSchema.optional(),
  })
  .strict();
export const batchSchema = z
  .object({
    cards: z
      .array(z.object({ id: z.string().uuid(), expectedUpdatedAt: z.string().datetime() }).strict())
      .min(1)
      .max(MAX_BATCH_CARDS)
      .refine(
        (items) => new Set(items.map((item) => item.id)).size === items.length,
        'Não repita cards.',
      ),
    acao: z.enum(['mover', 'atribuir', 'etiquetar', 'arquivar']),
    colunaId: z.string().uuid().optional(),
    responsavelId: z.string().uuid().nullable().optional(),
    etiqueta: z
      .object({
        id: z.string().uuid(),
        nome: z.string().trim().min(1).max(MAX_LABEL_NAME),
        cor: z.enum(['azul', 'verde', 'amarelo', 'vermelho', 'roxo', 'cinza']),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const field = { mover: 'colunaId', atribuir: 'responsavelId', etiquetar: 'etiqueta' }[
      data.acao
    ];

    if (field && data[field] === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field],
        message: 'Informe o destino da ação.',
      });
    }
  });
