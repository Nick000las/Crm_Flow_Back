import { z } from 'zod';
import { FILTRO_OPERADORES, LISTA_CATEGORIAS_STATUS, LISTA_TIPOS_REGRA } from '../constants.js';

// Regras de campo (M8). Forma só: se o campo existe, se o operador serve
// pro tipo dele e se os status existem é regra por tenant (`regras.service.js`).

const enumDe = (valores, mensagem) =>
  z.enum(/** @type {[string, ...string[]]} */ ([...valores]), { errorMap: () => ({ message: mensagem }) });

const uuid = (mensagem) => z.string({ required_error: mensagem, invalid_type_error: mensagem }).uuid(mensagem);

const condicaoPorStatus = z
  .object({
    status: z.array(z.string().min(1)).optional(),
    categorias: z.array(enumDe(LISTA_CATEGORIAS_STATUS, 'Categoria deve ser aberto, ganho ou perdido')).optional(),
  })
  .strict();

const condicaoCondicional = z
  .object({
    campoId: uuid('Escolha o campo da condição'),
    operador: enumDe(FILTRO_OPERADORES, `Operador deve ser um de: ${FILTRO_OPERADORES.join(', ')}`),
    valor: z.unknown().optional(),
  })
  .strict();

const efeito = z
  .object({
    obrigatorio: z.boolean().optional(),
    visivel: z.boolean().optional(),
  })
  .strict();

// POST /crm/configuracoes/regras
export const criarRegraBodySchema = z.discriminatedUnion(
  'kind',
  [
    z
      .object({
        kind: z.literal('required_from_status'),
        campoId: uuid('Escolha o campo'),
        condicao: condicaoPorStatus,
        ativo: z.boolean().optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('conditional'),
        campoId: uuid('Escolha o campo'),
        condicao: condicaoCondicional,
        efeito,
        ativo: z.boolean().optional(),
      })
      .strict(),
  ],
  { errorMap: () => ({ message: `Tipo de regra deve ser um de: ${LISTA_TIPOS_REGRA.join(', ')}` }) },
);

// PUT /crm/configuracoes/regras/:id — parcial; o `kind` não muda. A
// condição é conferida contra o tipo da regra no service.
export const editarRegraBodySchema = z
  .object({
    campoId: uuid('Escolha o campo'),
    condicao: z.union([condicaoCondicional, condicaoPorStatus]),
    efeito,
    ativo: z.boolean(),
  })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Informe o que mudar na regra');

export const regraIdParamSchema = z.object({
  id: uuid('Id de regra inválido'),
});
