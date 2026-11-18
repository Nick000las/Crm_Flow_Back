/**
 * @file Leituras e gravações da equipe do quadro dentro da transação autorizada.
 * @layer repository
 */
/** Helpers recebem a transação já aberta pelo gateway multi-tenant. */
export async function listarParticipantes(tx, tenantId, boardId) {
  return tx.$queryRaw`
    SELECT
      u.id,
      u.nome,
      u.ativo,
      m.permissao
    FROM
      modulo_kanban_universal.board_members m
      JOIN public.usuarios u ON u.tenant_id = m.tenant_id
      AND u.id = m.usuario_id
    WHERE
      m.tenant_id = ${tenantId}::uuid
      AND m.board_id = ${boardId}::uuid
    ORDER BY
      u.nome,
      u.id
  `;
}

export async function buscarUsuariosAtivos(tx, tenantId, ids) {
  return tx.$queryRaw`
    SELECT
      id
    FROM
      public.usuarios
    WHERE
      tenant_id = ${tenantId}::uuid
      AND ativo = TRUE
      AND id = ANY (${ids}::UUID[])
  `;
}

export async function gravarParticipantes(tx, tenantId, boardId, ids, permissions) {
  await tx.$executeRaw`
    DELETE FROM modulo_kanban_universal.board_members
    WHERE
      tenant_id = ${tenantId}::uuid
      AND board_id = ${boardId}::uuid
      AND NOT (usuario_id = ANY (${ids}::UUID[]))
  `;

  if (ids.length) {
    await tx.$executeRaw`
      INSERT INTO
        modulo_kanban_universal.board_members (tenant_id, board_id, usuario_id)
      SELECT
        ${tenantId}::uuid,
        ${boardId}::uuid,
        usuario_id
      FROM
        unnest(${ids}::UUID[]) AS participantes (usuario_id)
      ON CONFLICT (tenant_id, board_id, usuario_id) DO NOTHING
    `;
  }

  if (permissions) {
    await tx.$executeRaw`
      UPDATE modulo_kanban_universal.board_members m
      SET
        permissao = p.permissao
      FROM
        jsonb_to_recordset(${JSON.stringify(permissions)}::jsonb) AS p (id uuid, permissao text)
      WHERE
        m.tenant_id = ${tenantId}::uuid
        AND m.board_id = ${boardId}::uuid
        AND m.usuario_id = p.id
    `;
  }

  // Um usuário removido da equipe deixa de ser responsável pelos cards do quadro.
  await tx.$executeRaw`
    UPDATE modulo_kanban_universal.cards
    SET
      responsavel_id = NULL
    WHERE
      tenant_id = ${tenantId}::uuid
      AND board_id = ${boardId}::uuid
      AND responsavel_id IS NOT NULL
      AND NOT (responsavel_id = ANY (${ids}::UUID[]))
  `;
}
