import { z } from 'zod';
import { TEXT_LIMITS } from '#shared/constants/index.js';
import { LIMITES_FORMULARIO, LISTA_POLITICAS_ESCRITA, TIPOS_PERGUNTA } from '../constants.js';

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

/** Item que pede um campo da pessoa. `preencher`: vem com o valor salvo (FM2b). */
const itemCampo = z
  .object({
    campoId: id('Escolha um campo'),
    obrigatorio: booleano.optional(),
    politica: z
      .enum(/** @type {[string, ...string[]]} */ ([...LISTA_POLITICAS_ESCRITA]), {
        errorMap: () => ({ message: 'Política deve ser overwrite ou fill_if_empty' }),
      })
      .optional(),
    preencher: booleano.optional(),
  })
  .strict();

const textoObrigatorio = (maximo, mensagem) =>
  z
    .string({ required_error: mensagem, invalid_type_error: mensagem })
    .trim()
    .min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH, mensagem)
    .max(maximo, `Use no máximo ${maximo} caracteres`);

/**
 * Pergunta própria do formulário (FM2b): a resposta fica só na resposta do
 * formulário. Sem `id`, o servidor gera um; mande o mesmo `id` nas próximas
 * edições para a pergunta ser reconhecida entre versões.
 */
const itemPergunta = z
  .object({
    pergunta: z
      .object({
        id: id('Id de pergunta inválido').optional(),
        rotulo: textoObrigatorio(LIMITES_FORMULARIO.ROTULO_PERGUNTA, 'Escreva a pergunta'),
        ajuda: textoOpcional(
          LIMITES_FORMULARIO.AJUDA_PERGUNTA,
          `Use no máximo ${LIMITES_FORMULARIO.AJUDA_PERGUNTA} caracteres`,
        ),
        tipo: z.enum(/** @type {[string, ...string[]]} */ ([...TIPOS_PERGUNTA]), {
          errorMap: () => ({ message: 'Escolha um tipo de resposta válido' }),
        }),
        opcoes: z
          .array(textoObrigatorio(LIMITES_FORMULARIO.OPCAO_PERGUNTA, 'Escreva a opção'))
          .max(
            LIMITES_FORMULARIO.OPCOES_PERGUNTA,
            `No máximo ${LIMITES_FORMULARIO.OPCOES_PERGUNTA} opções`,
          )
          .nullable()
          .optional(),
        sensivel: booleano.optional(),
      })
      .strict(),
    obrigatorio: booleano.optional(),
  })
  .strict();

/**
 * Campo ou pergunta, escolhido pela chave `pergunta`. Uma `z.union` juntaria
 * os erros dos dois numa mensagem só; assim o erro aponta o que falta.
 */
const item = z.unknown().transform((valor, ctx) => {
  const ehPergunta = Boolean(valor) && typeof valor === 'object' && 'pergunta' in valor;
  const resultado = (ehPergunta ? itemPergunta : itemCampo).safeParse(valor);
  if (resultado.success) return resultado.data;
  for (const problema of resultado.error.issues) ctx.addIssue(problema);
  return z.NEVER;
});

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

// Ficha (FM2): `/crm/leads/:id/formularios/...`. `id` é o lead, como nas
// outras rotas da ficha (o hook de visibilidade confere por ele).
export const linkDoFormularioParamSchema = z.object({
  id: id('Id de lead inválido'),
  formId: id('Id de formulário inválido'),
});

export const linkParamSchema = z.object({
  id: id('Id de lead inválido'),
  linkId: id('Id de link inválido'),
});

export const leadDoFormularioParamSchema = z.object({ id: id('Id de lead inválido') });

// POST /crm/leads/:id/formularios/:formId/link — a oportunidade é só referência.
export const criarLinkBodySchema = z
  .object({ oportunidadeId: id('Id de oportunidade inválido').nullable().optional() })
  .strict()
  .default({});
