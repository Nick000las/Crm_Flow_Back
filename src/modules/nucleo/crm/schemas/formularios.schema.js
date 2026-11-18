/**
 * @file Regra de alerta (FM5): quando a resposta do alvo casa, a pessoa ganha um alerta. O alvo
 * é um item do próprio rascunho; pergunta nova precisa ser salva antes (é quando ganha o id).
 * Operador e valor são conferidos contra o tipo do alvo no service.
 */
import { z } from 'zod';

import { TEXT_LIMITS } from '#shared/constants/index.js';

import {
  FILTRO_OPERADORES,
  LIMITE_NOME_RESPONSAVEL,
  LIMITES_ALERTA,
  LIMITES_FORMULARIO,
  LISTA_NIVEIS_ALERTA,
  LISTA_POLITICAS_ESCRITA,
  LISTA_QUEM_PREENCHE,
  QUEM_PREENCHE,
  TIPOS_PERGUNTA,
} from '../constants.js';

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

  if (resultado.success) {
    return resultado.data;
  }

  for (const problema of resultado.error.issues) {
    ctx.addIssue(problema);
  }

  return z.NEVER;
});

/**
 * Regra de alerta (FM5): quando a resposta do alvo casa, a pessoa ganha um
 * alerta. O alvo é um item do próprio rascunho; pergunta nova precisa ser
 * salva antes (é quando ganha o id). Operador e valor são conferidos contra o
 * tipo do alvo no service.
 */
const alerta = z
  .object({
    id: id('Id de alerta inválido').optional(),
    alvo: z
      .object({
        campoId: id('Escolha o campo do alerta').optional(),
        perguntaId: id('Escolha a pergunta do alerta').optional(),
      })
      .strict()
      .refine(
        (alvo) => Boolean(alvo.campoId) !== Boolean(alvo.perguntaId),
        'Escolha um campo ou uma pergunta',
      ),
    operador: z.enum(/** @type {[string, ...string[]]} */ ([...FILTRO_OPERADORES]), {
      errorMap: () => ({ message: `Operador deve ser um de: ${FILTRO_OPERADORES.join(', ')}` }),
    }),
    valor: z.unknown().optional(),
    nivel: z.enum(/** @type {[string, ...string[]]} */ ([...LISTA_NIVEIS_ALERTA]), {
      errorMap: () => ({ message: 'Nível deve ser info, warning ou critical' }),
    }),
    texto: textoObrigatorio(LIMITES_ALERTA.TEXTO, 'Escreva o texto do alerta'),
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
    alertas: z
      .array(alerta)
      .max(LIMITES_ALERTA.POR_FORMULARIO, `No máximo ${LIMITES_ALERTA.POR_FORMULARIO} alertas`)
      .optional(),
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

// Ficha (FM4): `/crm/leads/:id/formularios/respostas/:respostaId`.
export const respostaParamSchema = z.object({
  id: id('Id de lead inválido'),
  respostaId: id('Id de resposta inválido'),
});

// POST /public/f/:token/respostas (FM4). As respostas são conferidas contra
// a versão do link no service; aqui, a forma e o aceite do termo.
export const enviarRespostaBodySchema = z
  .object({
    respostas: z.record(z.string(), z.unknown(), {
      invalid_type_error: 'Envie as respostas como um objeto',
    }),
    aceite: z.literal(true, {
      errorMap: () => ({ message: 'É preciso aceitar o termo para enviar' }),
    }),
    preenchidoPor: z.enum(/** @type {[string, ...string[]]} */ ([...LISTA_QUEM_PREENCHE]), {
      errorMap: () => ({ message: 'Diga quem está preenchendo' }),
    }),
    nomeResponsavel: textoOpcional(
      LIMITE_NOME_RESPONSAVEL,
      `Use no máximo ${LIMITE_NOME_RESPONSAVEL} caracteres`,
    ),
  })
  .strict()
  .superRefine((corpo, ctx) => {
    if (corpo.preenchidoPor === QUEM_PREENCHE.RESPONSAVEL && !corpo.nomeResponsavel) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['nomeResponsavel'],
        message: 'Informe o nome de quem está preenchendo',
      });
    }
  });

// Ficha (FM5): alertas da pessoa.
export const alertaParamSchema = z.object({
  id: id('Id de lead inválido'),
  alertaId: id('Id de alerta inválido'),
});

// `?todos=true` traz também os já vistos por quem pede.
export const listarAlertasQuerySchema = z
  .object({ todos: z.enum(['true', 'false']).optional() })
  .transform(({ todos }) => ({ todos: todos === 'true' }));
