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

const loginBodySchema = z.object({
  email: requiredString('Informe o e-mail')
    .trim()
    .min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH, 'Informe o e-mail')
    .email('Informe um e-mail válido')
    .transform((email) => email.toLowerCase()),
});

const passwordLoginBodySchema = loginBodySchema.extend({
  senha: requiredString('Informe a senha').min(
    TEXT_LIMITS.NON_EMPTY_MIN_LENGTH,
    'Informe a senha'
  ),
});

const verifyCodeBodySchema = loginBodySchema.extend({
  verificationCode: requiredString('Informe o código').regex(
    activationCodePattern,
    `O código deve conter ${PASSWORD_ACTIVATION.CODE_LENGTH} dígitos`
  ),
});

const activatePasswordBodySchema = z.object({
  senha: requiredString('Informe a senha').min(
    PASSWORD_POLICY.MIN_LENGTH,
    `A senha deve ter pelo menos ${PASSWORD_POLICY.MIN_LENGTH} caracteres`
  ),
});

const refreshBodySchema = z.object({
  refreshToken: requiredString('Refresh token não informado').min(
    TEXT_LIMITS.NON_EMPTY_MIN_LENGTH,
    'Refresh token não informado'
  ),
});

export {
  activatePasswordBodySchema,
  loginBodySchema,
  passwordLoginBodySchema,
  refreshBodySchema,
  verifyCodeBodySchema,
};
