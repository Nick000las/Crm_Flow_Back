import { z } from 'zod';
import { TEXT_LIMITS } from '#shared/constants/index.js';
import { EDICAO_EM_MASSA } from '../constants.js';
import { opcaoDeLista, usuarioResponsavelIdSchema } from './leads.schema.js';

const listaDeTags = z
  .array(z.string({ invalid_type_error: 'Tag inválida' }).trim().min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH, 'Tag vazia'))
  .optional();

// PATCH /crm/leads/bulk (M10). Mesma forma do PUT de um lead para Status,
// Origem e Responsável (`null` tira o responsável); tags somam/tiram sobre
// as que cada lead já tem, em vez de substituir. As regras (opção ativa,
// responsável ativo, M8) são as do PUT, aplicadas lead a lead no service.
export const editarEmMassaBodySchema = z.object({
  ids: z
    .array(z.string({ invalid_type_error: 'Lead inválido' }).uuid('Lead inválido'), {
      required_error: 'Selecione os leads',
    })
    .min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH, 'Selecione ao menos um lead')
    .max(EDICAO_EM_MASSA.MAX_LEADS, `Selecione no máximo ${EDICAO_EM_MASSA.MAX_LEADS} leads`)
    .refine((ids) => new Set(ids).size === ids.length, 'O mesmo lead foi selecionado mais de uma vez'),
  alteracoes: z
    .object(
      {
        status: opcaoDeLista('Status de lead inválido'),
        fonteLead: opcaoDeLista('Origem do lead inválida'),
        usuarioResponsavelId: usuarioResponsavelIdSchema.nullable().optional(),
        tags: z.object({ adicionar: listaDeTags, remover: listaDeTags }).optional(),
      },
      { required_error: 'Informe o que alterar' },
    )
    .refine(
      ({ status, fonteLead, usuarioResponsavelId, tags }) =>
        status !== undefined ||
        fonteLead !== undefined ||
        usuarioResponsavelId !== undefined ||
        Boolean(tags?.adicionar?.length) ||
        Boolean(tags?.remover?.length),
      'Informe ao menos uma alteração',
    ),
});
