import 'dotenv/config';
import { z } from 'zod';
import { JWT_SECRET_MIN_LENGTH } from '#core/auth/constants.js';
import { TEXT_LIMITS } from '#shared/constants/index.js';

const MIN_NETWORK_PORT = 1;
const MAX_NETWORK_PORT = 65_535;
const DEFAULT_APP_PORT = 3_000;
const DEFAULT_SMTP_PORT = 587;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_NAME: z.string().min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH).default('crm-flow-back'),
  HOST: z.string().min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH).default('0.0.0.0'),
  PORT: z.coerce
    .number()
    .int()
    .min(MIN_NETWORK_PORT)
    .max(MAX_NETWORK_PORT)
    .default(DEFAULT_APP_PORT),
  CORS_ORIGIN: z.string().min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH).default('*'),
  JWT_SECRET: z
    .string()
    .min(
      JWT_SECRET_MIN_LENGTH,
      `JWT_SECRET deve ter pelo menos ${JWT_SECRET_MIN_LENGTH} caracteres`,
    ),
  JWT_REFRESH_SECRET: z
    .string()
    .min(
      JWT_SECRET_MIN_LENGTH,
      `JWT_REFRESH_SECRET deve ter pelo menos ${JWT_SECRET_MIN_LENGTH} caracteres`,
    ),
  DATABASE_URL: z.string().min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH).optional(),
  SMTP_HOST: z.string().min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH).optional(),
  SMTP_PORT: z.coerce
    .number()
    .int()
    .min(MIN_NETWORK_PORT)
    .max(MAX_NETWORK_PORT)
    .default(DEFAULT_SMTP_PORT),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  SMTP_USER: z.string().min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH).optional(),
  SMTP_PASS: z.string().min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH).optional(),
});

/**
 * Carrega e valida a configuração somente durante o bootstrap. Assim, importar
 * services em testes não exige que toda a infraestrutura esteja configurada.
 *
 * @param {NodeJS.ProcessEnv} [source]
 */
export function loadEnv(source = process.env) {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Configuração de ambiente inválida: ${details}`);
  }

  return Object.freeze(result.data);
}

/** @param {string} value */
export function parseCorsOrigins(value) {
  if (value === '*') return '*';
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
