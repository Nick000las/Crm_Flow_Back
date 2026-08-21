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

export const CURRENCY = Object.freeze({
  CENTS_PER_UNIT: 100,
});

/** @typedef {typeof TENANT_STATUS[keyof typeof TENANT_STATUS]} TenantStatus */
