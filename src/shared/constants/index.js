export const ROLES = Object.freeze({ MASTER: 'MASTER', DONO: 'DONO', OPERADOR: 'OPERADOR' });

export const TENANT_STATUS = Object.freeze({
  TRIAL: 'trial',
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  SUSPENSO: 'suspenso',
  CANCELADO: 'cancelado',
});

export const HTTP_STATUS = Object.freeze({
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
});

export const HTTP_ERROR_STATUS_RANGE = Object.freeze({
  MIN: 400,
  MAX: 599,
});

export const TIME_UNITS = Object.freeze({
  MILLISECONDS_PER_SECOND: 1_000,
});

/** Fuso padrão de tenant novo (espelha o DEFAULT de `tenants.fuso_horario`). */
export const FUSO_HORARIO_PADRAO = 'America/Sao_Paulo';

export const TEXT_LIMITS = Object.freeze({
  NON_EMPTY_MIN_LENGTH: 1,
});

export const PAGINATION = Object.freeze({
  MIN_PAGE: 1,
  DEFAULT_PAGE: 1,
  MIN_ITEMS_PER_PAGE: 1,
  DEFAULT_ITEMS_PER_PAGE: 20,
  MAX_ITEMS_PER_PAGE: 100,
});

export const BRAZIL_PHONE = Object.freeze({
  AREA_CODE_LENGTH: 2,
  LANDLINE_LENGTH: 10,
  MOBILE_LENGTH: 11,
  LANDLINE_PREFIX_END: 6,
  MOBILE_PREFIX_END: 7,
});

/**
 * Documentos brasileiros. CNPJ inclui o alfanumérico (IN RFB 2.229/2024):
 * 12 posições [0-9A-Z] + 2 dígitos verificadores, cada caractere valendo
 * o código ASCII − 48 no cálculo (0–9 = 0–9, A = 17 … Z = 42).
 */
export const BRAZIL_DOCUMENTS = Object.freeze({
  CPF_LENGTH: 11,
  CNPJ_LENGTH: 14,
  CEP_LENGTH: 8,
  CHECK_DIGITS: 2,
  MODULO: 11,
  /** Resto abaixo disso → dígito 0. */
  MIN_REMAINDER: 2,
  CPF_FIRST_WEIGHT: 10,
  CNPJ_MAX_WEIGHT: 9,
  CNPJ_MIN_WEIGHT: 2,
  CHAR_OFFSET: 48,
  CPF_MASK: /^(\d{3})(\d{3})(\d{3})(\d{2})$/,
  CNPJ_MASK: /^([0-9A-Z]{2})([0-9A-Z]{3})([0-9A-Z]{3})([0-9A-Z]{4})(\d{2})$/,
  CEP_MASK: /^(\d{5})(\d{3})$/,
});

export const CURRENCY = Object.freeze({
  CENTS_PER_UNIT: 100,
});

/** @typedef {typeof TENANT_STATUS[keyof typeof TENANT_STATUS]} TenantStatus */
