import { getTenantClient } from '#core/db/tenantClient.js';
import { AppError } from '#core/errors/app-error.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { exigirParticipacao } from './board-members.repository.js';

export function autenticarConexao(context) {
  return getTenantClient(context.tenantId, async (tx) => {
    const users = await tx.$queryRaw`
      SELECT u.role FROM public.usuarios u
      JOIN public.tenant_modules m ON m.tenant_id = u.tenant_id
      WHERE u.tenant_id = ${context.tenantId}::uuid AND u.id = ${context.userId}::uuid
        AND u.ativo = true AND m.module_key = 'kanban_universal' AND m.disabled_at IS NULL
    `;
    if (!users.length) {
      throw new AppError({
        code: 'FORBIDDEN',
        statusCode: HTTP_STATUS.FORBIDDEN,
        message: 'Acesso ao Kanban indisponível.',
      });
    }
    return { ...context, role: users[0].role };
  });
}

export function autorizarSala(context, boardId, cardId) {
  return getTenantClient(context.tenantId, async (tx) => {
    const rows = await tx.$queryRaw`
      SELECT b.id FROM modulo_kanban_universal.boards b
      JOIN public.tenant_modules m ON m.tenant_id = b.tenant_id
      WHERE b.tenant_id = ${context.tenantId}::uuid AND b.id = ${boardId}::uuid
        AND m.module_key = 'kanban_universal' AND m.disabled_at IS NULL
    `;
    if (!rows.length) {
      throw new AppError({
        code: 'RESOURCE_NOT_FOUND',
        statusCode: HTTP_STATUS.NOT_FOUND,
        message: 'Quadro não encontrado.',
      });
    }
    await exigirParticipacao(tx, context.tenantId, boardId, context);
    if (cardId) {
      const cards = await tx.$queryRaw`
        SELECT id FROM modulo_kanban_universal.cards
        WHERE tenant_id = ${context.tenantId}::uuid AND board_id = ${boardId}::uuid AND id = ${cardId}::uuid
      `;
      if (!cards.length) {
        throw new AppError({
          code: 'RESOURCE_NOT_FOUND',
          statusCode: HTTP_STATUS.NOT_FOUND,
          message: 'Card não encontrado.',
        });
      }
    }
  });
}

/** Revalida os destinatários após o commit; salas antigas não concedem acesso. */
export function listarDestinatarios(tenantId, boardId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
    SELECT DISTINCT u.id FROM public.usuarios u
    JOIN public.tenant_modules tm ON tm.tenant_id = u.tenant_id
      AND tm.module_key = 'kanban_universal' AND tm.disabled_at IS NULL
    LEFT JOIN modulo_kanban_universal.board_members bm
      ON bm.tenant_id = u.tenant_id AND bm.usuario_id = u.id AND bm.board_id = ${boardId}::uuid
    WHERE u.tenant_id = ${tenantId}::uuid AND u.ativo = true
      AND (u.role IN ('DONO', 'MASTER') OR bm.usuario_id IS NOT NULL)
  `,
  );
}
