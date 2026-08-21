import { z } from 'zod';
import { PASSWORD_ACTIVATION, PASSWORD_POLICY } from '#core/auth/constants.js';
import { TEXT_LIMITS } from '#shared/constants/index.js';

const activationCodePattern = new RegExp(`^\\d{${PASSWORD_ACTIVATION.CODE_LENGTH}}$`);

const loginBodySchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .transform((email) => email.toLowerCase()),
});

const passwordLoginBodySchema = loginBodySchema.extend({
  senha: z.string().min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH),
});

const verifyCodeBodySchema = loginBodySchema.extend({
  codigo: z
    .string()
    .regex(
      activationCodePattern,
      `O código deve conter ${PASSWORD_ACTIVATION.CODE_LENGTH} dígitos`,
    ),
});

const activatePasswordBodySchema = z.object({
  activationToken: z.string().min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH),
  senha: z
    .string()
    .min(
      PASSWORD_POLICY.MIN_LENGTH,
      `A senha deve ter pelo menos ${PASSWORD_POLICY.MIN_LENGTH} caracteres`,
    ),
});

const refreshBodySchema = z.object({
  refreshToken: z.string().min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH),
});

export {
  activatePasswordBodySchema,
  loginBodySchema,
  passwordLoginBodySchema,
  refreshBodySchema,
  verifyCodeBodySchema,
};
