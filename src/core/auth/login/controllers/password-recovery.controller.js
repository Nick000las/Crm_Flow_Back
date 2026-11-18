import { sendSuccess } from '#shared/http/response.js';
import { loginBodySchema, resetPasswordBodySchema } from '../schemas/login.schema.js';
import { requestPasswordRecovery, resetPassword } from '../services/password-recovery.service.js';

export async function forgotPassword(request, reply) {
  const body = loginBodySchema.parse(request.body);
  const result = await requestPasswordRecovery({ ...body, emailConfig: request.server.config });
  reply.header('Cache-Control', 'no-store');
  return sendSuccess(reply, result);
}

export async function recoverPassword(request, reply) {
  const body = resetPasswordBodySchema.parse(request.body);
  const result = await resetPassword(body);
  reply.header('Cache-Control', 'no-store');
  return sendSuccess(reply, result);
}
