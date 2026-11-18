/**
 * @file Consulta usuários conectados, recursos de salas e destinatários no tenant.
 * @layer repository
 */
import { getTenantClient } from '#core/db/tenantClient.js';

import { listarParticipantes } from './board-members.repository.js';

export function buscarUsuarioDaConexao(context) {
  return getTenantClient(context.tenantId, async (tx) => {
    const users = await tx.$queryRaw`
      SELECT
        u.role
      FROM
        public.usuarios u
        JOIN public.tenant_modules m ON m.tenant_id = u.tenant_id
      WHERE
        u.tenant_id = ${context.tenantId}::uuid
        AND u.id = ${context.userId}::uuid
        AND u.ativo = TRUE
        AND m.module_key = 'kanban_universal'
        AND m.disabled_at IS NULL
    `;

    return users[0];
  });
}

export function buscarDadosDaSala(context, boardId, cardId) {
  return getTenantClient(context.tenantId, async (tx) => {
    const boards = await tx.$queryRaw`
      SELECT
        b.id
      FROM
        modulo_kanban_universal.boards b
        JOIN public.tenant_modules m ON m.tenant_id = b.tenant_id
      WHERE
        b.tenant_id = ${context.tenantId}::uuid
        AND b.id = ${boardId}::uuid
        AND m.module_key = 'kanban_universal'
        AND m.disabled_at IS NULL
    `;
    const participants = await listarParticipantes(tx, context.tenantId, boardId);
    const cards = cardId
      ? await tx.$queryRaw`
        SELECT
          id
        FROM
          modulo_kanban_universal.cards
        WHERE
          tenant_id = ${context.tenantId}::uuid
          AND board_id = ${boardId}::uuid
          AND id = ${cardId}::uuid
      `
      : [];

    return { boards, participants, cards };
  });
}

/** Revalida os destinatários após o commit; salas antigas não concedem acesso. */
export function listarDestinatarios(tenantId, boardId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT DISTINCT
        u.id
      FROM
        public.usuarios u
        JOIN public.tenant_modules tm ON tm.tenant_id = u.tenant_id
        AND tm.module_key = 'kanban_universal'
        AND tm.disabled_at IS NULL
        LEFT JOIN modulo_kanban_universal.board_members bm ON bm.tenant_id = u.tenant_id
        AND bm.usuario_id = u.id
        AND bm.board_id = ${boardId}::uuid
      WHERE
        u.tenant_id = ${tenantId}::uuid
        AND u.ativo = TRUE
        AND (
          u.role IN ('DONO', 'MASTER')
          OR bm.usuario_id IS NOT NULL
        )
    `,
  );
}
