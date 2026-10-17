import { z } from 'zod';
import { TEXT_LIMITS } from '#shared/constants/index.js';
import { LIMITES_LAYOUT } from '../constants.js';

// Forma do layout (M4). Se cada referência é um campo ativo e permitido é
// regra de negócio por tenant — `layout.service.js`.
const referencia = z
  .string({ invalid_type_error: 'Referência de campo inválida' })
  .min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH, 'Referência de campo inválida');

const secao = z
  .object({
    nome: z
      .string({ required_error: 'Informe o nome da seção', invalid_type_error: 'Informe o nome da seção' })
      .trim()
      .min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH, 'Informe o nome da seção')
      .max(LIMITES_LAYOUT.NOME_SECAO, `O nome da seção vai até ${LIMITES_LAYOUT.NOME_SECAO} caracteres`),
    campos: z.array(referencia),
  })
  .strict();

const propriedades = {
  identificador: referencia,
  subtitulo: z.array(referencia).max(LIMITES_LAYOUT.SUBTITULO, `Subtítulo: até ${LIMITES_LAYOUT.SUBTITULO} campos`),
  destaques: z.array(referencia).max(LIMITES_LAYOUT.DESTAQUES, `Destaques: até ${LIMITES_LAYOUT.DESTAQUES} campos`),
  secoes: z.array(secao).max(LIMITES_LAYOUT.SECOES, `Até ${LIMITES_LAYOUT.SECOES} seções`),
  colunas: z.array(referencia),
};

// PUT /crm/layout/padrao — completo.
export const layoutPadraoBodySchema = z.object(propriedades).strict();

// PUT /crm/layout/meu — parcial; o que não vier segue o padrão.
export const layoutMeuBodySchema = z
  .object(propriedades)
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Informe ao menos uma parte do layout');
