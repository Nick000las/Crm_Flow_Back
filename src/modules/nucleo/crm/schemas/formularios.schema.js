import { z } from 'zod';
import { TEXT_LIMITS } from '#shared/constants/index.js';
import { LIMITES_FORMULARIO, LISTA_POLITICAS_ESCRITA } from '../constants.js';

const id = (mensagem) => z.string({ required_error: mensagem }).uuid(mensagem);
const booleano = z.boolean({ invalid_type_error: 'Informe verdadeiro ou falso' });

/** Texto opcional: `null` ou vazio apaga. */
const textoOpcional = (maximo, mensagem) =>
  z
    .string({ invalid_type_error: 'Informe um texto válido' })
    .trim()
    .max(maximo, mensagem)
    .nullable()
    .optional();

const nome = z
  .string({
    required_error: 'Informe o nome do formulário',
    invalid_type_error: 'Informe um nome válido',
  })
  .trim()
  .min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH, 'Informe o nome do formulário')
  .max(LIMITES_FORMULARIO.NOME, `Use no máximo ${LIMITES_FORMULARIO.NOME} caracteres`);

const validadeDias = z
  .number({ invalid_type_error: 'Informe a validade em dias' })
  .int('Informe a validade em dias inteiros')
  .min(LIMITES_FORMULARIO.VALIDADE_MIN_DIAS, 'O link vale ao menos 1 dia')
  .max(
    LIMITES_FORMULARIO.VALIDADE_MAX_DIAS,
    `O link vale no máximo ${LIMITES_FORMULARIO.VALIDADE_MAX_DIAS} dias`,
  );

const item = z
  .object({
    campoId: id('Escolha um campo'),
    obrigatorio: booleano.optional(),
    politica: z
      .enum(/** @type {[string, ...string[]]} */ ([...LISTA_POLITICAS_ESCRITA]), {
        errorMap: () => ({ message: 'Política deve ser overwrite ou fill_if_empty' }),
      })
      .optional(),
  })
  .strict();

const rascunho = z
  .object({
    secoes: z
      .array(
        z
          .object({
            titulo: textoOpcional(
              LIMITES_FORMULARIO.TITULO_SECAO,
              `Use no máximo ${LIMITES_FORMULARIO.TITULO_SECAO} caracteres`,
            ),
            itens: z.array(item).max(LIMITES_FORMULARIO.ITENS),
          })
          .strict(),
      )
      .max(LIMITES_FORMULARIO.SECOES, `No máximo ${LIMITES_FORMULARIO.SECOES} seções`),
    introducao: textoOpcional(
      LIMITES_FORMULARIO.INTRODUCAO,
      `Use no máximo ${LIMITES_FORMULARIO.INTRODUCAO} caracteres`,
    ),
    termo: textoOpcional(
      LIMITES_FORMULARIO.TERMO,
      `Use no máximo ${LIMITES_FORMULARIO.TERMO} caracteres`,
    ),
  })
  .strict();

export const formularioParamSchema = z.object({ id: id('Id de formulário inválido') });

export const versaoParamSchema = formularioParamSchema.extend({
  versaoId: id('Id de versão inválido'),
});

// POST /crm/configuracoes/formularios
export const criarFormularioBodySchema = z
  .object({
    nome,
    descricao: textoOpcional(
      LIMITES_FORMULARIO.DESCRICAO,
      `Use no máximo ${LIMITES_FORMULARIO.DESCRICAO} caracteres`,
    ),
    validadeDias: validadeDias.optional(),
  })
  .strict();

// PUT /crm/configuracoes/formularios/:id — parcial, ao menos uma mudança.
export const editarFormularioBodySchema = criarFormularioBodySchema
  .extend({
    nome: nome.optional(),
    ativo: booleano.optional(),
    rascunho: rascunho.optional(),
  })
  .strict()
  .refine(
    (body) => Object.values(body).some((valor) => valor !== undefined),
    'Informe ao menos uma mudança',
  );
