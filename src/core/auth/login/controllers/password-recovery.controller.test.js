import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HTTP_STATUS } from '#shared/constants/index.js';

import { requestPasswordRecovery, resetPassword } from '../services/password-recovery.service.js';
import { forgotPassword, recoverPassword } from './password-recovery.controller.js';

vi.mock('../services/password-recovery.service.js', () => ({
  requestPasswordRecovery: vi.fn(),
  resetPassword: vi.fn(),
}));

const apps = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.resetAllMocks();
});

function buildApp() {
  const app = Fastify();

  apps.push(app);
  app.decorate('config', {});
  app.post('/auth/password/forgot', forgotPassword);
  app.post('/auth/password/reset', recoverPassword);

  app.setErrorHandler((error, request, reply) =>
    reply
      .code(error.name === 'ZodError' ? HTTP_STATUS.BAD_REQUEST : HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .send({ message: 'Entrada inválida' }),
  );

  return app;
}

describe('HTTP de recuperação', () => {
  it('normaliza o e-mail sem exigir autenticação', async () => {
    requestPasswordRecovery.mockResolvedValue({ message: 'Verifique seu e-mail' });

    const response = await buildApp().inject({
      method: 'POST',
      url: '/auth/password/forgot',
      payload: { email: ' TESTE@EXAMPLE.INVALID ' },
    });

    expect(response.statusCode).toBe(HTTP_STATUS.OK);
    expect(response.headers['cache-control']).toBe('no-store');

    expect(requestPasswordRecovery).toHaveBeenCalledWith({
      email: 'teste@example.invalid',
      emailConfig: {},
    });
  });

  it.each([
    { email: 'inválido', verificationCode: '123456', senha: 'senha-segura' },
    { email: 'teste@example.invalid', verificationCode: '123', senha: 'senha-segura' },
    { email: 'teste@example.invalid', verificationCode: '123456', senha: 'curta' },
  ])('valida e-mail, código e política de senha', async (payload) => {
    const response = await buildApp().inject({
      method: 'POST',
      url: '/auth/password/reset',
      payload,
    });

    expect(response.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it('redefine a senha sem emitir sessão nem cookie', async () => {
    resetPassword.mockResolvedValue({ message: 'Senha redefinida' });

    const response = await buildApp().inject({
      method: 'POST',
      url: '/auth/password/reset',
      payload: {
        email: 'teste@example.invalid',
        verificationCode: '123456',
        senha: 'senha-segura',
      },
    });

    expect(response.statusCode).toBe(HTTP_STATUS.OK);
    expect(response.json().data).toEqual({ message: 'Senha redefinida' });
    expect(response.headers['set-cookie']).toBeUndefined();
  });
});
