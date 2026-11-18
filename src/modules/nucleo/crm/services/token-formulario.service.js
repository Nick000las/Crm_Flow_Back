/**
 * @file A chave do ambiente, lida a cada uso: trocar o `.env` e reiniciar basta.
 */
import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { AppError } from '#core/errors/app-error.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';

/**
 * Token do link de formulário (FM2). 32 bytes aleatórios em base64url: não é
 * id nem uuid, e não dá para adivinhar. No banco só ficam o SHA-256, para a
 * busca, e uma cópia cifrada com AES-256-GCM, para "copiar de novo" devolver
 * o mesmo link. A chave vem de FORMS_TOKEN_KEY.
 */

const BYTES_DO_TOKEN = 32;
const BYTES_DA_CHAVE = 32;
const BYTES_DO_IV = 12;
const BYTES_DA_TAG = 16;
const ALGORITMO = 'aes-256-gcm';

/** @returns {string} */
export function gerarToken() {
  return randomBytes(BYTES_DO_TOKEN).toString('base64url');
}

/**
 * @param {string} token
 * @returns {Buffer}
 */
export function hashDoToken(token) {
  return createHash('sha256').update(token, 'utf8').digest();
}

/**
 * A chave do ambiente, lida a cada uso: trocar o `.env` e reiniciar basta.
 *
 * @param {NodeJS.ProcessEnv} [ambiente]
 * @returns {Buffer}
 */
export function chaveDosLinks(ambiente = process.env) {
  const chave = ambiente.FORMS_TOKEN_KEY ? Buffer.from(ambiente.FORMS_TOKEN_KEY, 'base64') : null;

  if (!chave || chave.length !== BYTES_DA_CHAVE) {
    throw new AppError({
      statusCode: HTTP_STATUS.SERVICE_UNAVAILABLE,
      code: ERROR_CODES.FORMS_UNAVAILABLE,
      message: 'Os links de formulário não estão configurados neste servidor',
    });
  }

  return chave;
}

/**
 * @param {string} token
 * @param {Buffer} chave
 * @returns {Buffer} iv, tag e texto cifrado, nessa ordem
 */
export function cifrarToken(token, chave) {
  const iv = randomBytes(BYTES_DO_IV);
  const cifra = createCipheriv(ALGORITMO, chave, iv);
  const texto = Buffer.concat([cifra.update(token, 'utf8'), cifra.final()]);

  return Buffer.concat([iv, cifra.getAuthTag(), texto]);
}

/**
 * @param {Buffer} guardado saída de `cifrarToken`
 * @param {Buffer} chave
 * @returns {string}
 */
export function decifrarToken(guardado, chave) {
  const iv = guardado.subarray(0, BYTES_DO_IV);
  const tag = guardado.subarray(BYTES_DO_IV, BYTES_DO_IV + BYTES_DA_TAG);
  const decifra = createDecipheriv(ALGORITMO, chave, iv);

  decifra.setAuthTag(tag);

  return Buffer.concat([
    decifra.update(guardado.subarray(BYTES_DO_IV + BYTES_DA_TAG)),
    decifra.final(),
  ]).toString('utf8');
}
