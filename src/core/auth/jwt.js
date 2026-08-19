import jwt from 'jsonwebtoken';

/** @typedef {import('#core/types/module.js').TenantContext} TenantContext */

const ACCESS_TOKEN_TTL = '15m'; // Bloco 8.2
const REFRESH_TOKEN_TTL = '7d';

const JWT_SECRET = requireEnv('JWT_SECRET');
const JWT_REFRESH_SECRET = requireEnv('JWT_REFRESH_SECRET');

/**
 * @param {TenantContext} ctx
 * @returns {string}
 */
export function signAccessToken(ctx) {
  return jwt.sign(ctx, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
}

/**
 * @param {string} userId
 * @returns {string}
 */
export function signRefreshToken(userId) {
  return jwt.sign({ userId }, JWT_REFRESH_SECRET, { expiresIn: REFRESH_TOKEN_TTL });
}

/**
 * @param {string} token
 * @returns {TenantContext}
 */
export function verifyAccessToken(token) {
  return /** @type {TenantContext} */ (jwt.verify(token, JWT_SECRET));
}

/**
 * @param {string} token
 * @returns {{ userId: string }}
 */
export function verifyRefreshToken(token) {
  return /** @type {{ userId: string }} */ (jwt.verify(token, JWT_REFRESH_SECRET));
}

/**
 * @param {string} name
 * @returns {string}
 */
function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return value;
}
