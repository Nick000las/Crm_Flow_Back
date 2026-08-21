import {
  HTTP_ERROR_STATUS_RANGE,
} from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';

const KNOWN_ERROR_CODES = new Set(Object.values(ERROR_CODES));
const ALLOWED_PUBLIC_HEADERS = new Set(['retry-after']);

/**
 * Erro operacional seguro para retornar ao cliente.
 * Erros desconhecidos nunca devem ser convertidos em AppError apenas para
 * expor sua mensagem; o handler global os transforma em INTERNAL_ERROR.
 */
export class AppError extends Error {
  /**
   * @param {{
   *   code: string,
   *   message: string,
   *   statusCode: number,
   *   fields?: Record<string, string[]>,
   *   details?: unknown,
   *   headers?: Record<string, string>,
   *   cause?: unknown,
   * }} input
   */
  constructor({ code, message, statusCode, fields, details, headers, cause }) {
    assertPublicError({ code, message, statusCode, fields, details, headers });

    super(message, cause === undefined ? undefined : { cause });
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.fields = fields;
    this.details = details;
    this.headers = headers;
  }
}

/**
 * @param {{
 *   code: unknown,
 *   message: unknown,
 *   statusCode: unknown,
 *   fields: unknown,
 *   details: unknown,
 *   headers: unknown,
 * }} input
 */
function assertPublicError({ code, message, statusCode, fields, details, headers }) {
  if (
    !Number.isInteger(statusCode) ||
    statusCode < HTTP_ERROR_STATUS_RANGE.MIN ||
    statusCode > HTTP_ERROR_STATUS_RANGE.MAX
  ) {
    throw new TypeError('AppError exige um status HTTP de erro válido');
  }

  if (typeof code !== 'string' || !KNOWN_ERROR_CODES.has(code)) {
    throw new TypeError('AppError exige um código público conhecido');
  }

  if (typeof message !== 'string' || message.trim().length === 0) {
    throw new TypeError('AppError exige uma mensagem pública não vazia');
  }

  if (fields !== undefined && !isPublicFieldMap(fields)) {
    throw new TypeError('AppError recebeu erros de campo inválidos');
  }

  if (details !== undefined && !isJsonSerializable(details)) {
    throw new TypeError('AppError recebeu detalhes não serializáveis');
  }

  if (headers !== undefined && !areAllowedPublicHeaders(headers)) {
    throw new TypeError('AppError recebeu headers públicos não permitidos');
  }
}

/** @param {unknown} value */
function isPublicFieldMap(value) {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (messages) =>
        Array.isArray(messages) &&
        messages.length > 0 &&
        messages.every(
          (message) => typeof message === 'string' && message.trim().length > 0,
        ),
    )
  );
}

/** @param {unknown} value */
function isJsonSerializable(value) {
  try {
    return JSON.stringify(value) !== undefined;
  } catch {
    return false;
  }
}

/** @param {unknown} value */
function areAllowedPublicHeaders(value) {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([name, headerValue]) =>
        ALLOWED_PUBLIC_HEADERS.has(name.toLowerCase()) &&
        typeof headerValue === 'string',
    )
  );
}

/** @param {unknown} value */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
