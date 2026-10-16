import { BRAZIL_PHONE } from '#shared/constants/index.js';
import { emailSchema } from '#shared/validators/index.js';
import { TIPOS_CAMPO, TIPOS_LISTA } from '../constants.js';

/**
 * Regras por tipo de campo (docs/crm/plano-configuracoes.md, M2.3) —
 * funções puras, uma fonte só pro formulário/PUT (`leads.service.js`), a
 * planilha (`import.service.js`) e o filtro (`lead-filter.service.js`),
 * pra personalizados e pros nativos do mesmo tipo (e-mail, telefone). Tipo
 * novo entra aqui (validar, normalizar, converter célula, texto de busca)
 * e em `OPERADORES_POR_TIPO` (constants.js), nunca como `switch` espalhado.
 *
 * Formato gravado em `custom_fields`:
 * - `texto`/`texto_longo`/`url`: string; `email`: string minúscula;
 * - `telefone`: só dígitos, sem DDI 55 (10 ou 11 dígitos);
 * - `numero`/`monetario`: number (`monetario` em reais, até 2 casas);
 * - `data`: string ISO; `booleano`: boolean;
 * - `selecao`: uma das opções; `selecao_multipla`: lista de opções.
 */

export const LIMITE_TEXTO_LONGO = 10_000;
const CASAS_DECIMAIS_MONETARIO = 2;
const BASE_DECIMAL = 10;
const FATOR_CENTAVOS = BASE_DECIMAL ** CASAS_DECIMAIS_MONETARIO;
const DDI_BRASIL = '55';
const PROTOCOLOS_URL = new Set(['http:', 'https:']);
const PADRAO_DATA_BR = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const VALORES_VERDADEIROS = new Set(['sim', 's', 'true', 'verdadeiro', '1', 'x', 'yes']);
const VALORES_FALSOS = new Set(['não', 'nao', 'n', 'false', 'falso', '0', 'no']);

/** @param {string} texto */
export function somenteDigitos(texto) {
  return texto.replace(/\D/g, '');
}

/**
 * Vazio pra fins de obrigatoriedade: ausente, `null`, texto vazio ou lista
 * vazia.
 *
 * @param {unknown} valor
 */
export function valorAusente(valor) {
  return valor === undefined || valor === null || valor === '' || (Array.isArray(valor) && valor.length === 0);
}

/**
 * Texto de filtro na mesma forma em que o valor é gravado — pra
 * "(11) 99999-0000" achar o que foi salvo como "11999990000". Diferente de
 * `normalizarValorDoTipo`, aceita pedaço de valor (busca parcial).
 *
 * @param {string} tipo
 * @param {string} texto
 */
export function textoDeBusca(tipo, texto) {
  if (tipo === TIPOS_CAMPO.TELEFONE) return somenteDigitos(texto) || texto;
  if (tipo === TIPOS_CAMPO.EMAIL) return texto.trim().toLowerCase();
  return texto;
}

/**
 * Telefone BR em dígitos (DDD + número), aceitando máscara e DDI 55.
 *
 * @param {string} texto
 * @returns {string | null} `null` se não for um telefone BR válido
 */
export function normalizarTelefone(texto) {
  let digitos = somenteDigitos(texto);
  if (digitos.length > BRAZIL_PHONE.MOBILE_LENGTH && digitos.startsWith(DDI_BRASIL)) {
    digitos = digitos.slice(DDI_BRASIL.length);
  }
  const valido = digitos.length >= BRAZIL_PHONE.LANDLINE_LENGTH && digitos.length <= BRAZIL_PHONE.MOBILE_LENGTH;
  return valido ? digitos : null;
}

/** @param {string} texto */
function urlValida(texto) {
  try {
    const url = new URL(texto);
    return PROTOCOLOS_URL.has(url.protocol) && url.hostname.length > 0;
  } catch {
    return false;
  }
}

/** Folga pro erro de ponto flutuante (`10.1 * 100` = `1010.0000000000001`). */
const TOLERANCIA_CENTAVOS = 1e-6;

/** @param {number} valor */
function temNoMaximoDuasCasas(valor) {
  const centavos = valor * FATOR_CENTAVOS;
  return Math.abs(centavos - Math.round(centavos)) < TOLERANCIA_CENTAVOS;
}

/**
 * Valor já no formato de API/JSON (não vazio — obrigatoriedade é checada
 * à parte) é aceitável pro tipo?
 *
 * @param {string} tipo
 * @param {unknown} valor
 * @param {readonly string[] | null | undefined} opcoes
 */
export function valorValidoParaTipo(tipo, valor, opcoes) {
  switch (tipo) {
    case TIPOS_CAMPO.TEXTO:
      return typeof valor === 'string';
    case TIPOS_CAMPO.TEXTO_LONGO:
      return typeof valor === 'string' && valor.length <= LIMITE_TEXTO_LONGO;
    case TIPOS_CAMPO.NUMERO:
      return typeof valor === 'number' && Number.isFinite(valor);
    case TIPOS_CAMPO.MONETARIO:
      return typeof valor === 'number' && Number.isFinite(valor) && temNoMaximoDuasCasas(valor);
    case TIPOS_CAMPO.DATA:
      return typeof valor === 'string' && !Number.isNaN(Date.parse(valor));
    case TIPOS_CAMPO.BOOLEANO:
      return typeof valor === 'boolean';
    case TIPOS_CAMPO.SELECAO:
      return Boolean(opcoes?.includes(/** @type {string} */ (valor)));
    case TIPOS_CAMPO.SELECAO_MULTIPLA:
      return Array.isArray(valor) && valor.every((item) => opcoes?.includes(item));
    case TIPOS_CAMPO.TELEFONE:
      return typeof valor === 'string' && normalizarTelefone(valor) !== null;
    case TIPOS_CAMPO.EMAIL:
      return typeof valor === 'string' && emailSchema.safeParse(valor.trim()).success;
    case TIPOS_CAMPO.URL:
      return typeof valor === 'string' && urlValida(valor.trim());
    default:
      return false;
  }
}

/**
 * Forma canônica de gravação (só depois de `valorValidoParaTipo`). Tipo
 * sem normalização devolve o valor como veio.
 *
 * @param {string} tipo
 * @param {unknown} valor
 */
export function normalizarValorDoTipo(tipo, valor) {
  if (typeof valor !== 'string') return valor;
  switch (tipo) {
    case TIPOS_CAMPO.TELEFONE:
      return normalizarTelefone(valor) ?? valor;
    case TIPOS_CAMPO.EMAIL:
      return valor.trim().toLowerCase();
    case TIPOS_CAMPO.URL:
      return valor.trim();
    default:
      return valor;
  }
}

/**
 * Célula de planilha → valor no formato gravado, pra qualquer tipo (o
 * import só decide pra onde o valor vai). Erro vira mensagem pro
 * relatório, nunca exceção — o relatório junta todas as linhas.
 *
 * @param {{ tipo: string, label: string, opcoes?: readonly string[] | null }} campo
 * @param {string | number | boolean | Date} bruto  nunca `null` aqui
 * @returns {{ valor: unknown } | { erro: string }}
 */
export function converterCelula(campo, bruto) {
  const texto = bruto instanceof Date ? bruto.toISOString() : String(bruto).trim();

  switch (campo.tipo) {
    case TIPOS_CAMPO.TEXTO:
      return { valor: texto };
    case TIPOS_CAMPO.NUMERO: {
      const numero = typeof bruto === 'number' ? bruto : converterNumero(texto);
      return Number.isFinite(numero) ? { valor: numero } : { erro: `"${campo.label}" espera um número` };
    }
    case TIPOS_CAMPO.DATA: {
      const data = bruto instanceof Date ? bruto : converterData(texto);
      return data && !Number.isNaN(data.getTime())
        ? { valor: data.toISOString() }
        : { erro: `"${campo.label}" espera uma data (dd/mm/aaaa)` };
    }
    case TIPOS_CAMPO.BOOLEANO: {
      const normalizado = String(bruto).trim().toLowerCase();
      if (bruto === true || VALORES_VERDADEIROS.has(normalizado)) return { valor: true };
      if (bruto === false || VALORES_FALSOS.has(normalizado)) return { valor: false };
      return { erro: `"${campo.label}" espera sim ou não` };
    }
    case TIPOS_CAMPO.SELECAO: {
      const opcao = casarOpcao(campo, texto);
      return opcao !== undefined ? { valor: opcao } : { erro: `"${texto}" não é uma opção de "${campo.label}"` };
    }
    case TIPOS_CAMPO.SELECAO_MULTIPLA: {
      const itens = texto.split(/[,;]/).map((item) => item.trim()).filter(Boolean);
      const valores = itens.map((item) => casarOpcao(campo, item));
      const invalido = itens.find((_, i) => valores[i] === undefined);
      return invalido === undefined
        ? { valor: valores }
        : { erro: `"${invalido}" não é uma opção de "${campo.label}"` };
    }
    case TIPOS_CAMPO.TEXTO_LONGO:
      return texto.length <= LIMITE_TEXTO_LONGO
        ? { valor: texto }
        : { erro: `"${campo.label}" passa de ${LIMITE_TEXTO_LONGO} caracteres` };
    case TIPOS_CAMPO.MONETARIO: {
      const numero = typeof bruto === 'number' ? bruto : converterNumero(texto.replace(/^R\$\s*/i, ''));
      return Number.isFinite(numero)
        ? { valor: Math.round(numero * FATOR_CENTAVOS) / FATOR_CENTAVOS }
        : { erro: `"${campo.label}" espera um valor em reais` };
    }
    case TIPOS_CAMPO.TELEFONE: {
      const telefone = normalizarTelefone(texto);
      return telefone ? { valor: telefone } : { erro: `Telefone inválido em "${campo.label}": "${texto}"` };
    }
    case TIPOS_CAMPO.EMAIL:
      return emailSchema.safeParse(texto).success
        ? { valor: texto.toLowerCase() }
        : { erro: `E-mail inválido em "${campo.label}": "${texto}"` };
    case TIPOS_CAMPO.URL:
      return urlValida(texto) ? { valor: texto } : { erro: `"${campo.label}" espera um link (http/https)` };
    default:
      return { erro: `Tipo de campo "${campo.tipo}" não suportado` };
  }
}

/**
 * Casa sem diferenciar maiúscula/minúscula e devolve a opção canônica.
 * Campo de lista (M3) aceita a key ou o nome de uma opção ATIVA e devolve
 * a key; tag é livre (vira opção ao gravar). Sem `opcoes`, qualquer valor.
 *
 * @param {{ opcoes?: readonly string[] | null, lista?: string | null, opcoesLista?: { key: string, label: string, ativo: boolean }[] }} campo
 * @param {string} valor
 */
function casarOpcao(campo, valor) {
  const alvo = valor.toLowerCase();
  if (campo.lista === TIPOS_LISTA.TAG) return valor;
  if (campo.opcoesLista) {
    return campo.opcoesLista.find(
      (opcao) => opcao.ativo && (opcao.key.toLowerCase() === alvo || opcao.label.toLowerCase() === alvo),
    )?.key;
  }
  if (!campo.opcoes) return valor;
  return campo.opcoes.find((opcao) => opcao.toLowerCase() === alvo);
}

/** Aceita `1234.5`, `1234,5` e `1.234,50`. @param {string} texto */
function converterNumero(texto) {
  const limpo = texto.replace(/\s/g, '');
  const normalizado = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo;
  return normalizado.length > 0 ? Number(normalizado) : Number.NaN;
}

/** Aceita `dd/mm/aaaa` e ISO. @param {string} texto */
function converterData(texto) {
  const br = PADRAO_DATA_BR.exec(texto);
  if (br) {
    const [, dia, mes, ano] = br.map(Number);
    const data = new Date(Date.UTC(ano, mes - 1, dia));
    // `Date.UTC` datas impossíveis (31/02 → 03/03) em vez de falhar.
    const valida = data.getUTCDate() === dia && data.getUTCMonth() === mes - 1;
    return valida ? data : null;
  }
  return new Date(texto);
}
