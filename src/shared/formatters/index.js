// Utilitários genéricos, SEM regra de negócio e SEM acesso a dado.
import { BRAZIL_PHONE, CURRENCY } from '#shared/constants/index.js';

/**
 * @param {string} telefone
 * @returns {string}
 */
export function formatarTelefoneBR(telefone) {
  const digitos = telefone.replace(/\D/g, '');
  if (digitos.length === BRAZIL_PHONE.MOBILE_LENGTH) {
    return `(${digitos.slice(0, BRAZIL_PHONE.AREA_CODE_LENGTH)}) ${digitos.slice(
      BRAZIL_PHONE.AREA_CODE_LENGTH,
      BRAZIL_PHONE.MOBILE_PREFIX_END,
    )}-${digitos.slice(BRAZIL_PHONE.MOBILE_PREFIX_END)}`;
  }
  if (digitos.length === BRAZIL_PHONE.LANDLINE_LENGTH) {
    return `(${digitos.slice(0, BRAZIL_PHONE.AREA_CODE_LENGTH)}) ${digitos.slice(
      BRAZIL_PHONE.AREA_CODE_LENGTH,
      BRAZIL_PHONE.LANDLINE_PREFIX_END,
    )}-${digitos.slice(BRAZIL_PHONE.LANDLINE_PREFIX_END)}`;
  }
  return telefone;
}

/**
 * @param {number} valorEmCentavos
 * @returns {string}
 */
export function formatarMoedaBRL(valorEmCentavos) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    valorEmCentavos / CURRENCY.CENTS_PER_UNIT,
  );
}

/**
 * @param {Date} data
 * @returns {string}
 */
export function formatarDataBR(data) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(data);
}
