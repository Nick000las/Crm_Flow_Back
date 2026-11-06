import { z } from 'zod';
import { TEXT_LIMITS } from '#shared/constants/index.js';
import { REGRAS_DONO_ATENDIMENTO, TIPOS_PIPELINE } from '../constants.js';

const enumDe = (valores, mensagem) =>
  z.enum(/** @type {[string, ...string[]]} */ ([...valores]), {
    errorMap: () => ({ message: mensagem }),
  });

const id = (mensagem) => z.string({ required_error: mensagem }).uuid(mensagem);

const nome = z
  .string({
    required_error: 'Informe o nome do pipeline',
    invalid_type_error: 'Informe um nome válido',
  })
  .trim()
  .min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH, 'Informe o nome do pipeline');

export const pipelineParamSchema = z.object({ id: id('Id de pipeline inválido') });

export const statusParamSchema = pipelineParamSchema.extend({
  opcaoId: id('Id de status inválido'),
});

// POST /crm/configuracoes/pipelines
export const criarPipelineBodySchema = z
  .object({
    nome,
    tipo: enumDe(
      Object.values(TIPOS_PIPELINE),
      'Tipo deve ser vendas (sales) ou atendimento (service)',
    ),
  })
  .strict();

// PUT /crm/configuracoes/pipelines/:id — parcial; a automação também.
export const atualizarPipelineBodySchema = z
  .object({
    nome: nome.optional(),
    ativo: z.boolean({ invalid_type_error: 'Informe verdadeiro ou falso' }).optional(),
    automacao: z
      .object({
        ativa: z.boolean({ invalid_type_error: 'Informe verdadeiro ou falso' }).optional(),
        origemId: id('Id de pipeline inválido').nullable().optional(),
        statusInicial: z.string().nullable().optional(),
        regraDoDono: enumDe(
          Object.values(REGRAS_DONO_ATENDIMENTO),
          `Regra deve ser uma de: ${Object.values(REGRAS_DONO_ATENDIMENTO).join(', ')}`,
        ).optional(),
        donoId: id('Id de usuário inválido').nullable().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Informe ao menos uma mudança');
