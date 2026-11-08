import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { HTTP_STATUS } from '#shared/constants/index.js';
import {
  chaveDosLinks,
  cifrarToken,
  decifrarToken,
  gerarToken,
  hashDoToken,
} from './token-formulario.service.js';

const BYTES_DA_CHAVE = 32;
const CHAVE = randomBytes(BYTES_DA_CHAVE);
const TAMANHO_BASE64URL = 43;

describe('token do link de formulário', () => {
  it('é aleatório, base64url, com 43 caracteres', () => {
    const a = gerarToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a).toHaveLength(TAMANHO_BASE64URL);
    expect(gerarToken()).not.toBe(a);
  });

  it('o hash é estável e não contém o token', () => {
    const token = gerarToken();
    expect(hashDoToken(token).equals(hashDoToken(token))).toBe(true);
    expect(hashDoToken(token).toString('utf8')).not.toContain(token);
  });

  it('cifrar e decifrar devolve o mesmo token; cada cifra é diferente', () => {
    const token = gerarToken();
    const a = cifrarToken(token, CHAVE);
    expect(decifrarToken(a, CHAVE)).toBe(token);
    expect(cifrarToken(token, CHAVE).equals(a)).toBe(false);
  });

  it('outra chave ou um byte trocado não decifra', () => {
    const guardado = cifrarToken(gerarToken(), CHAVE);
    expect(() => decifrarToken(guardado, randomBytes(BYTES_DA_CHAVE))).toThrow();
    const adulterado = Buffer.from(guardado);
    adulterado[adulterado.length - 1] ^= 1;
    expect(() => decifrarToken(adulterado, CHAVE)).toThrow();
  });

  it('sem chave ou com chave curta: 503 FORMS_UNAVAILABLE', () => {
    for (const ambiente of [{}, { FORMS_TOKEN_KEY: Buffer.from('curta').toString('base64') }]) {
      expect(() => chaveDosLinks(ambiente)).toThrow(
        expect.objectContaining({
          statusCode: HTTP_STATUS.SERVICE_UNAVAILABLE,
          code: 'FORMS_UNAVAILABLE',
        }),
      );
    }
    expect(chaveDosLinks({ FORMS_TOKEN_KEY: CHAVE.toString('base64') }).equals(CHAVE)).toBe(true);
  });
});
