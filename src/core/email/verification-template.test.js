import { describe, expect, it } from 'vitest';

import { renderVerificationEmail } from './verification-template.js';

const CODE = '012345';
const EXPIRATION_MINUTES = 10;

describe('template de códigos do Flow CRM', () => {
  it.each(['activation', 'recovery', 'login'])(
    'renderiza %s em HTML e texto sem alterar o código',
    (purpose) => {
      const message = renderVerificationEmail({
        purpose,
        code: CODE,
        expirationMinutes: EXPIRATION_MINUTES,
      });

      expect(message.html).toContain('<html lang="pt-BR">');
      expect(message.html).toContain(CODE);
      expect(message.text).toContain(`Seu código de verificação é ${CODE}.`);
      expect(message.html).toContain('10 minutos');
      expect(message.text).toContain('10 minutos');
      expect(message.html).not.toMatch(/<(?:script|img|iframe)\b/i);
      expect(message.html).not.toMatch(/(?:src|href)="https?:/i);
      expect(message.text).not.toMatch(/<\/?(?:table|td|tr|h1)>/);
    },
  );

  it('diferencia o contexto de criação, recuperação e login', () => {
    const render = (purpose) =>
      renderVerificationEmail({ purpose, code: CODE, expirationMinutes: EXPIRATION_MINUTES }).text;

    expect(render('activation')).toContain('Crie sua senha');
    expect(render('recovery')).toContain('Recupere seu acesso');
    expect(render('login')).toContain('Confirme seu acesso');
  });

  it('escapa conteúdo dinâmico no HTML', () => {
    const code = '<img src=x onerror="alert(1)">&';
    const message = renderVerificationEmail({
      purpose: 'login',
      code,
      expirationMinutes: EXPIRATION_MINUTES,
    });

    expect(message.html).not.toContain(code);
    expect(message.html).toContain('&lt;img');
    expect(message.html).toContain('&quot;');
    expect(message.text).toContain(code);
  });

  it('não troca a finalidade por uma variante desconhecida', () => {
    expect(() =>
      renderVerificationEmail({
        purpose: 'other',
        code: CODE,
        expirationMinutes: EXPIRATION_MINUTES,
      }),
    ).toThrow(TypeError);
  });
});
