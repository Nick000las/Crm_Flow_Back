export const ROLES = Object.freeze({ MASTER: 'MASTER', DONO: 'DONO', OPERADOR: 'OPERADOR' });

export const TENANT_STATUS = Object.freeze({
  TRIAL: 'trial',
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  SUSPENSO: 'suspenso',
  CANCELADO: 'cancelado',
});

/** @typedef {typeof TENANT_STATUS[keyof typeof TENANT_STATUS]} TenantStatus */
