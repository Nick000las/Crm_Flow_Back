// Utilitários genéricos, SEM regra de negócio e SEM acesso a dado.

/**
 * @param {string} telefone
 * @returns {string}
 */
export function formatarTelefoneBR(telefone) {
  const digitos = telefone.replace(/\D/g, '');
  if (digitos.length === 11) return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)}-${digitos.slice(7)}`;
  if (digitos.length === 10) return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 6)}-${digitos.slice(6)}`;
  return telefone;
}

/**
 * @param {number} valorEmCentavos
 * @returns {string}
 */
export function formatarMoedaBRL(valorEmCentavos) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valorEmCentavos / 100);
}

/**
 * @param {Date} data
 * @returns {string}
 */
export function formatarDataBR(data) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(data);
}
