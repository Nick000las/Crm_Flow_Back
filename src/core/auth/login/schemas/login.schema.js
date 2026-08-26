/**
 * Schemas Zod do fluxo de login/ativação. Pasta própria porque são 5 schemas
 * (mais que os ~2 que justificariam inline no controller) — mesmo critério
 * documentado em MODULE_CONTRACT.md §2, ainda que este código não seja mais
 * um módulo sob esse contrato (ver docs/decisoes-pendentes-auth.md).
 */
import { z } from 'zod';
import { PASSWORD_ACTIVATION, PASSWORD_POLICY } from '#core/auth/constants.js';
import { TEXT_LIMITS } from '#shared/constants/index.js';

const activationCodePattern = new RegExp(
  `^\\d{${PASSWORD_ACTIVATION.CODE_LENGTH}}$`
);

/** @param {string} message */
function requiredString(message) {
  return z.string({ required_error: message, invalid_type_error: message });
}

export const loginBodySchema = z.object({
  email: requiredString('Informe o e-mail')
    .trim()
    .min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH, 'Informe o e-mail')
    .email('Informe um e-mail válido')
    .transform((email) => email.toLowerCase()),
});

export const passwordLoginBodySchema = loginBodySchema.extend({
  senha: requiredString('Informe a senha').min(
    TEXT_LIMITS.NON_EMPTY_MIN_LENGTH,
    'Informe a senha'
  ),
});

export const verifyCodeBodySchema = loginBodySchema.extend({
  verificationCode: requiredString('Informe o código').regex(
    activationCodePattern,
    `O código deve conter ${PASSWORD_ACTIVATION.CODE_LENGTH} dígitos`
  ),
});

export const activatePasswordBodySchema = z.object({
  senha: requiredString('Informe a senha').min(
    PASSWORD_POLICY.MIN_LENGTH,
    `A senha deve ter pelo menos ${PASSWORD_POLICY.MIN_LENGTH} caracteres`
  ),
});

export const refreshBodySchema = z.object({
  refreshToken: requiredString('Refresh token não informado').min(
    TEXT_LIMITS.NON_EMPTY_MIN_LENGTH,
    'Refresh token não informado'
  ),
});
