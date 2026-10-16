import { z } from 'zod';
import { TEXT_LIMITS } from '#shared/constants/index.js';
import { LISTA_CATEGORIAS_STATUS, LISTA_TIPOS_LISTA, PADRAO_COR } from '../constants.js';

const enumDe = (valores, mensagem) =>
  z.enum(/** @type {[string, ...string[]]} */ ([...valores]), { errorMap: () => ({ message: mensagem }) });

const nome = z
  .string({ required_error: 'Informe o nome da opção', invalid_type_error: 'Informe um nome válido' })
  .trim()
  .min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH, 'Informe o nome da opção');

const cor = z
  .string({ invalid_type_error: 'Informe uma cor válida' })
  .regex(PADRAO_COR, 'Use uma cor no formato #RRGGBB')
  .nullable();

const categoria = enumDe(LISTA_CATEGORIAS_STATUS, `Categoria deve ser uma de: ${LISTA_CATEGORIAS_STATUS.join(', ')}`);

export const tipoListaParamSchema = z.object({
  tipo: enumDe(LISTA_TIPOS_LISTA, `Lista deve ser uma de: ${LISTA_TIPOS_LISTA.join(', ')}`),
});

export const opcaoParamSchema = tipoListaParamSchema.extend({
  id: z.string({ required_error: 'Informe o id da opção' }).uuid('Id de opção inválido'),
});

// POST /crm/configuracoes/listas/:tipo — `category` só (e sempre) em status.
export const criarOpcaoBodySchema = z
  .object({ label: nome, color: cor.optional(), category: categoria.optional() })
  .strict();

// PUT /crm/configuracoes/listas/:tipo/:id — parcial; `color: null` limpa.
export const atualizarOpcaoBodySchema = z
  .object({
    label: nome.optional(),
    color: cor.optional(),
    category: categoria.optional(),
    ativo: z.boolean({ invalid_type_error: 'Informe verdadeiro ou falso' }).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Informe ao menos uma mudança');

// PUT /crm/configuracoes/listas/:tipo/ordem — todas as opções da lista.
export const reordenarListaBodySchema = z.object({
  ids: z
    .array(z.string().uuid('Id de opção inválido'))
    .min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH, 'Informe a ordem das opções'),
});
