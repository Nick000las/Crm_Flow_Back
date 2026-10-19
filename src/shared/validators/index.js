import { z } from 'zod';
import { BRAZIL_DOCUMENTS, BRAZIL_PHONE, PAGINATION } from '#shared/constants/index.js';

const { CHAR_OFFSET, CHECK_DIGITS, MIN_REMAINDER, MODULO } = BRAZIL_DOCUMENTS;

/** Dígito verificador mod 11 a partir dos pesos. @param {number[]} valores @param {number[]} pesos */
function digitoVerificador(valores, pesos) {
  const resto = valores.reduce((soma, valor, i) => soma + valor * pesos[i], 0) % MODULO;
  return resto < MIN_REMAINDER ? 0 : MODULO - resto;
}

/** @param {string} texto */
function todosIguais(texto) {
  return [...texto].every((caractere) => caractere === texto[0]);
}

/**
 * CPF com dígitos verificadores corretos. Recebe só os 11 dígitos (sem
 * máscara); "111.111.111-11" e afins, que passam no cálculo, são recusados.
 *
 * @param {string} cpf
 */
export function cpfValido(cpf) {
  if (!new RegExp(`^\\d{${BRAZIL_DOCUMENTS.CPF_LENGTH}}$`).test(cpf) || todosIguais(cpf)) return false;
  const digitos = [...cpf].map(Number);
  const base = BRAZIL_DOCUMENTS.CPF_LENGTH - CHECK_DIGITS;
  for (let posicao = base; posicao < BRAZIL_DOCUMENTS.CPF_LENGTH; posicao += 1) {
    const pesos = Array.from({ length: posicao }, (_, i) => posicao + 1 - i);
    if (digitoVerificador(digitos.slice(0, posicao), pesos) !== digitos[posicao]) return false;
  }
  return true;
}

/** Pesos do CNPJ: da direita pra esquerda 2..9, repetindo. @param {number} tamanho */
function pesosCnpj(tamanho) {
  const ciclo = BRAZIL_DOCUMENTS.CNPJ_MAX_WEIGHT - BRAZIL_DOCUMENTS.CNPJ_MIN_WEIGHT + 1;
  return Array.from({ length: tamanho }, (_, i) => BRAZIL_DOCUMENTS.CNPJ_MIN_WEIGHT + ((tamanho - 1 - i) % ciclo));
}

/**
 * CNPJ numérico ou alfanumérico (12 posições [0-9A-Z] + 2 dígitos) com
 * dígitos verificadores corretos. Recebe a forma canônica: sem máscara,
 * maiúsculas.
 *
 * @param {string} cnpj
 */
export function cnpjValido(cnpj) {
  const base = BRAZIL_DOCUMENTS.CNPJ_LENGTH - CHECK_DIGITS;
  if (!new RegExp(`^[0-9A-Z]{${base}}\\d{${CHECK_DIGITS}}$`).test(cnpj) || todosIguais(cnpj)) return false;
  const valores = [...cnpj].map((caractere) => caractere.charCodeAt(0) - CHAR_OFFSET);
  for (let posicao = base; posicao < BRAZIL_DOCUMENTS.CNPJ_LENGTH; posicao += 1) {
    if (digitoVerificador(valores.slice(0, posicao), pesosCnpj(posicao)) !== valores[posicao]) return false;
  }
  return true;
}

const brazilPhonePattern = new RegExp(
  `^\\d{${BRAZIL_PHONE.LANDLINE_LENGTH},${BRAZIL_PHONE.MOBILE_LENGTH}}$`,
);

export const telefoneSchema = z
  .string()
  .regex(
    brazilPhonePattern,
    `Telefone deve ter ${BRAZIL_PHONE.LANDLINE_LENGTH} ou ${BRAZIL_PHONE.MOBILE_LENGTH} dígitos, sem formatação`,
  );

export const uuidSchema = z.string().uuid();

export const emailSchema = z.string().email();

export const paginacaoSchema = z.object({
  page: z.coerce.number().int().min(PAGINATION.MIN_PAGE).default(PAGINATION.DEFAULT_PAGE),
  perPage: z.coerce
    .number()
    .int()
    .min(PAGINATION.MIN_ITEMS_PER_PAGE)
    .max(PAGINATION.MAX_ITEMS_PER_PAGE)
    .default(PAGINATION.DEFAULT_ITEMS_PER_PAGE),
});

/**
 * Nome IANA canônico de um fuso (`america/sao_paulo` → `America/Sao_Paulo`),
 * ou `null` se o `Intl` do Node não o reconhece. Valida pelo próprio
 * runtime em vez de uma lista fixa, que envelheceria com o tzdata.
 *
 * @param {string} fuso
 * @returns {string | null}
 */
export function normalizarFusoHorario(fuso) {
  try {
    return new Intl.DateTimeFormat('pt-BR', { timeZone: fuso }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

export const fusoHorarioSchema = z
  .string()
  .trim()
  .transform((fuso, ctx) => {
    const canonico = normalizarFusoHorario(fuso);
    if (!canonico) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Fuso horário inválido — use um nome IANA, ex: America/Sao_Paulo',
      });
      return z.NEVER;
    }
    return canonico;
  });
