import { Buffer } from 'node:buffer';
import 'dotenv/config';
import { z } from 'zod';
import { JWT_SECRET_MIN_LENGTH } from '#core/auth/constants.js';
import { TEXT_LIMITS } from '#shared/constants/index.js';

const MIN_NETWORK_PORT = 1;
const MAX_NETWORK_PORT = 65_535;
const DEFAULT_APP_PORT = 3_000;
const DEFAULT_SMTP_PORT = 587;
const DEFAULT_SMTP_TIMEOUT_MS = 10_000;
const FORMS_TOKEN_KEY_BYTES = 32;

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_NAME: z.string().min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH).default('crm-flow-back'),
    HOST: z.string().min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH).default('0.0.0.0'),
    PORT: z.coerce
      .number()
      .int()
      .min(MIN_NETWORK_PORT)
      .max(MAX_NETWORK_PORT)
      .default(DEFAULT_APP_PORT),
    REDIS_URL: z.string().min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH).optional(),
    SOCKET_REDIS_PREFIX: z.string().min(1).default('flow-crm:socket.io'),
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
    // Role `app_tenant` (migration 0004) — sem privilégio de dono, é por
    // onde getTenantClient() conecta pra RLS ser garantia real do Postgres.
    TENANT_DATABASE_URL: z.string().min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH).optional(),
    FRONTEND_URL: z.string().url().optional(),
    // Formulários (FM2): chave AES-256 do link guardado, 32 bytes em base64.
    // Opcional no bootstrap: sem ela, só gerar link responde 503.
    FORMS_TOKEN_KEY: z.preprocess(
      (valor) => (valor === '' ? undefined : valor),
      z
        .string()
        .refine(
          (valor) => Buffer.from(valor, 'base64').length === FORMS_TOKEN_KEY_BYTES,
          'FORMS_TOKEN_KEY deve ter 32 bytes em base64',
        )
        .optional(),
    ),
    KANBAN_EMAIL_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
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
    SMTP_TIMEOUT_MS: z.coerce.number().int().positive().default(DEFAULT_SMTP_TIMEOUT_MS),
    // Fila de importação do CRM (BullMQ). Opcional no bootstrap: sem ela o
    // servidor sobe normal e só POST /crm/import/:jobId/confirm responde 503.
    // Rate limit do worker na consulta de CNPJ (CRM, M11b): no máximo
    // CNPJ_LIMITE_MAX consultas a cada CNPJ_LIMITE_JANELA_MS. Sem elas, o
    // padrão do módulo.
    CNPJ_LIMITE_MAX: z.coerce.number().int().positive().optional(),
    CNPJ_LIMITE_JANELA_MS: z.coerce.number().int().positive().optional(),
  })
  .superRefine((data, ctx) => {
    // Falha rápido em vez de deixar getTenantClient() conectar com URL vazia
    // e reintroduzir o bypass de RLS por acidente de configuração.
    if (data.DATABASE_URL && !data.TENANT_DATABASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TENANT_DATABASE_URL'],
        message:
          'TENANT_DATABASE_URL é obrigatório quando DATABASE_URL está definido — getTenantClient() não pode usar o role de dono.',
      });
    }
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
  return (
    value
      .split(',')
      // Header Origin do navegador nunca tem barra final; sem isso,
      // "http://localhost:5173/" no .env nunca casa e o CORS bloqueia tudo.
      .map((origin) => origin.trim().replace(/\/+$/, ''))
      .filter(Boolean)
  );
}
