import { z } from 'zod';
import { TEXT_LIMITS } from '#shared/constants/index.js';
import { FIELD_DEFINITION_TIPOS } from '../constants.js';

// Campos comuns entre criar e editar — evita repetir label/tipo/opcoes três
// vezes (criar, editar, e de novo se um terceiro schema precisar deles).
const camposDefinicao = {
  label: z
    .string({
      required_error: 'Informe o nome do campo',
      invalid_type_error: 'Informe um nome válido',
    })
    .trim()
    .min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH, 'Informe o nome do campo'),
  tipo: z.enum(FIELD_DEFINITION_TIPOS, {
    required_error: 'Informe o tipo do campo',
    invalid_type_error: 'Tipo de campo inválido',
  }),
  opcoes: z.array(z.string()).optional(),
  obrigatorio: z.boolean({
    required_error: 'Informe se o campo é obrigatório',
    invalid_type_error: 'Informe se o campo é obrigatório',
  }),
};

export const criarDefinicaoBodySchema = z.object({
  ...camposDefinicao,
  ordem: z
    .number({
      required_error: 'Informe a ordem do campo',
      invalid_type_error: 'Informe uma ordem válida',
    })
    .int('A ordem deve ser um número inteiro'),
});

// Sem `ordem` (isso é só de `PUT .../reorder`) e sem `chave` (nunca editável
// — ver `editarCampoPersonalizado` em crm-fields.repository.js).
export const editarDefinicaoBodySchema = z.object(camposDefinicao);

// `id` vem da URL (`/crm/field-definitions/:id`), nunca do body — mesmo
// padrão de `idParamSchema` em admin-tenants.routes.js.
export const definicaoIdParamSchema = z.object({
  id: z.string({ required_error: 'Informe o id do campo' }).uuid('Id de campo inválido'),
});
