import { getTenantClient } from '#core/db/tenantClient.js';

/** Lista apenas os quadros que o usuário autenticado pode acessar. */
export function buscarBoardsPorTenant(context) {
  const { tenantId, userId, role } = context;
  const canManage = ['DONO', 'MASTER'].includes(role);
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
    SELECT b.id, b.board_type AS "boardType", b.nome, b.created_at AS "createdAt",
      (SELECT count(*)::int FROM modulo_kanban_universal.board_members m
       JOIN public.usuarios u ON u.tenant_id = m.tenant_id AND u.id = m.usuario_id
       WHERE m.tenant_id = b.tenant_id AND m.board_id = b.id AND u.ativo = true
      ) AS "totalParticipantes"
    FROM modulo_kanban_universal.boards b
    WHERE b.tenant_id = ${tenantId}::uuid
      AND (${canManage} OR EXISTS (
        SELECT 1 FROM modulo_kanban_universal.board_members m
        JOIN public.usuarios u ON u.tenant_id = m.tenant_id AND u.id = m.usuario_id
        WHERE m.tenant_id = ${tenantId}::uuid AND m.board_id = b.id
          AND m.usuario_id = ${userId}::uuid AND u.ativo = true
      ))
    ORDER BY b.created_at DESC NULLS LAST, b.id
  `,
  );
}
