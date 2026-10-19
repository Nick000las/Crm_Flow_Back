// Utilitários genéricos, SEM regra de negócio e SEM acesso a dado.
import { BRAZIL_DOCUMENTS, BRAZIL_PHONE, CURRENCY } from '#shared/constants/index.js';

/**
 * Aplica a máscara se o texto (já sem pontuação) tiver o tamanho certo;
 * senão devolve como veio.
 *
 * @param {string} texto
 * @param {RegExp} padrao
 * @param {(...partes: string[]) => string} montar
 */
function mascarar(texto, padrao, montar) {
  const partes = padrao.exec(texto);
  return partes ? montar(...partes.slice(1)) : texto;
}

/** `12345678909` → `123.456.789-09`. @param {string} cpf */
export function formatarCpf(cpf) {
  return mascarar(cpf.replace(/\D/g, ''), BRAZIL_DOCUMENTS.CPF_MASK, (a, b, c, d) => `${a}.${b}.${c}-${d}`);
}

/** `12ABC34501DE35` → `12.ABC.345/01DE-35` (numérico ou alfanumérico). @param {string} cnpj */
export function formatarCnpj(cnpj) {
  return mascarar(
    cnpj.replace(/[^0-9A-Za-z]/g, '').toUpperCase(),
    BRAZIL_DOCUMENTS.CNPJ_MASK,
    (a, b, c, d, e) => `${a}.${b}.${c}/${d}-${e}`,
  );
}

/** `01310100` → `01310-100`. @param {string} cep */
export function formatarCep(cep) {
  return mascarar(cep.replace(/\D/g, ''), BRAZIL_DOCUMENTS.CEP_MASK, (a, b) => `${a}-${b}`);
}

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
