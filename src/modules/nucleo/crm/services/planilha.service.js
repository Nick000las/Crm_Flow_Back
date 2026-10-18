import { Buffer } from 'node:buffer';
import ExcelJS from 'exceljs';
import { AppError } from '#core/errors/app-error.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
import { EXPORTACAO, IMPORTACAO } from '../constants.js';

/**
 * SERVICE: leitura/escrita de .xlsx, sem regra de negócio de lead — só
 * converte planilha ↔ linhas. Recebe/devolve `Buffer`, não conhece HTTP.
 *
 * @typedef {string | number | boolean | Date | null} ValorCelula
 * @typedef {{ numero: number, valores: Record<string, ValorCelula> }} LinhaPlanilha
 */

const LINHA_CABECALHO = 1;

/**
 * Lê a primeira aba: linha 1 é o cabeçalho (nomes das colunas), dados a
 * partir da linha 2. Linhas totalmente vazias são ignoradas. `numero` é o
 * número real da linha na planilha, pro relatório de erro apontar a linha
 * que o usuário vê no Excel.
 *
 * @param {Buffer} buffer
 * @returns {Promise<{ colunas: string[], linhas: LinhaPlanilha[] }>}
 */
export async function lerPlanilha(buffer) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw erroDePlanilha('O arquivo não é uma planilha .xlsx válida');
  }

  const aba = workbook.worksheets[0];
  if (!aba || aba.actualRowCount <= LINHA_CABECALHO) {
    throw erroDePlanilha('A planilha está vazia — a primeira linha deve ter os nomes das colunas e as seguintes, os dados');
  }
  if (aba.actualRowCount - LINHA_CABECALHO > IMPORTACAO.MAX_LINHAS) {
    throw erroDePlanilha(`A planilha tem mais de ${IMPORTACAO.MAX_LINHAS} linhas — divida em arquivos menores`);
  }

  /** @type {{ indice: number, nome: string }[]} */
  const colunas = [];
  aba.getRow(LINHA_CABECALHO).eachCell((celula, indice) => {
    const nome = valorDaCelula(celula.value);
    if (nome !== null) colunas.push({ indice, nome: String(nome) });
  });

  if (colunas.length === 0) {
    throw erroDePlanilha('A primeira linha da planilha deve ter os nomes das colunas');
  }
  const nomes = colunas.map((coluna) => coluna.nome);
  const repetida = nomes.find((nome, i) => nomes.indexOf(nome) !== i);
  if (repetida) {
    throw erroDePlanilha(`A coluna "${repetida}" aparece mais de uma vez no cabeçalho`);
  }

  /** @type {LinhaPlanilha[]} */
  const linhas = [];
  aba.eachRow((linha, numero) => {
    if (numero <= LINHA_CABECALHO) return;

    /** @type {Record<string, ValorCelula>} */
    const valores = {};
    let vazia = true;
    for (const { indice, nome } of colunas) {
      const valor = valorDaCelula(linha.getCell(indice).value);
      valores[nome] = valor;
      if (valor !== null) vazia = false;
    }
    if (!vazia) linhas.push({ numero, valores });
  });

  return { colunas: nomes, linhas };
}

/**
 * @param {string[]} cabecalho
 * @param {unknown[][]} linhas
 * @returns {Promise<Buffer>}
 */
export async function gerarPlanilha(cabecalho, linhas) {
  const workbook = new ExcelJS.Workbook();
  const aba = workbook.addWorksheet('Leads');

  aba.addRow(cabecalho).font = { bold: true };
  for (const linha of linhas) {
    aba.addRow(linha);
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/**
 * CSV pro Excel pt-BR (M10): `;`, BOM UTF-8, CRLF, número com vírgula
 * decimal e data `dd/mm/aaaa` — o Excel abre com acento e reconhece
 * número e data. Mesmos valores do .xlsx (`valorParaPlanilha`).
 *
 * @param {string[]} cabecalho
 * @param {unknown[][]} linhas
 * @returns {Buffer}
 */
export function gerarCsv(cabecalho, linhas) {
  const texto = [cabecalho, ...linhas]
    .map((linha) => linha.map(celulaCsv).join(EXPORTACAO.CSV_SEPARADOR))
    .join(EXPORTACAO.CSV_QUEBRA_LINHA);
  return Buffer.from(`${EXPORTACAO.CSV_BOM}${texto}${EXPORTACAO.CSV_QUEBRA_LINHA}`, 'utf8');
}

// Texto que o Excel leria como fórmula (CSV injection): vai com um apóstrofo na frente.
const INICIO_DE_FORMULA = /^[=+\-@\t\r]/;
const PRECISA_DE_ASPAS = /[";\r\n]/;

/** @param {unknown} valor */
function celulaCsv(valor) {
  if (valor === null || valor === undefined) return '';
  let texto;
  if (valor instanceof Date) {
    // UTC, como o .xlsx grava a data.
    texto = Number.isNaN(valor.getTime()) ? '' : valor.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
  } else if (typeof valor === 'number') {
    texto = String(valor).replace('.', ',');
  } else {
    texto = String(valor);
    if (INICIO_DE_FORMULA.test(texto)) texto = `'${texto}`;
  }
  return PRECISA_DE_ASPAS.test(texto) ? `"${texto.replaceAll('"', '""')}"` : texto;
}

/**
 * Normaliza os formatos de célula do exceljs (rich text, hyperlink,
 * fórmula, erro) pra um valor primitivo. Texto vazio vira `null`.
 *
 * @param {ExcelJS.CellValue} valor
 * @returns {ValorCelula}
 */
export function valorDaCelula(valor) {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) return valor;
  if (typeof valor === 'string') {
    const texto = valor.trim();
    return texto.length > 0 ? texto : null;
  }
  if (typeof valor === 'number' || typeof valor === 'boolean') return valor;

  if (typeof valor === 'object') {
    if ('richText' in valor) return valorDaCelula(valor.richText.map((parte) => parte.text).join(''));
    if ('formula' in valor || 'sharedFormula' in valor) return valorDaCelula(valor.result ?? null);
    if ('text' in valor) return valorDaCelula(valor.text);
  }

  // Erro de fórmula (#N/A etc.) ou formato desconhecido — trata como vazio.
  return null;
}

/** @param {string} mensagem */
function erroDePlanilha(mensagem) {
  return new AppError({
    statusCode: HTTP_STATUS.BAD_REQUEST,
    code: ERROR_CODES.VALIDATION_ERROR,
    message: mensagem,
    fields: { arquivo: [mensagem] },
  });
}
