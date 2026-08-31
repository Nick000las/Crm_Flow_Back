import { AppError } from '#core/errors/app-error.js';
import { HTTP_STATUS } from '#shared/constants/index.js';

/** Helpers recebem a transação já aberta pelo gateway multi-tenant. */
export async function listarParticipantes(tx, tenantId, boardId) {
  return tx.$queryRaw`
    SELECT u.id, u.nome, u.ativo, m.permissao
    FROM modulo_kanban_universal.board_members m
    JOIN public.usuarios u ON u.tenant_id = m.tenant_id AND u.id = m.usuario_id
    WHERE m.tenant_id = ${tenantId}::uuid AND m.board_id = ${boardId}::uuid
    ORDER BY u.nome, u.id
  `;
}

export async function exigirParticipacao(tx, tenantId, boardId, context, writing = false) {
  if (['DONO', 'MASTER'].includes(context.role)) {
    return;
  }
  const participants = await listarParticipantes(tx, tenantId, boardId);
  if (!participants.some((user) => user.id === context.userId && user.ativo)) {
    // Evita revelar a existência de quadros aos quais o operador não tem acesso.
    throw new AppError({
      code: 'RESOURCE_NOT_FOUND',
      statusCode: HTTP_STATUS.NOT_FOUND,
      message: 'Quadro não encontrado.',
    });
  }
  if (writing && participants.find((user) => user.id === context.userId)?.permissao === 'leitor') {
    throw new AppError({
      code: 'FORBIDDEN',
      statusCode: HTTP_STATUS.FORBIDDEN,
      message: 'Seu acesso a este quadro permite apenas leitura.',
    });
  }
}

export async function salvarParticipantes(tx, tenantId, boardId, ids, permissions) {
  const users = await tx.$queryRaw`
    SELECT id FROM public.usuarios
    WHERE tenant_id = ${tenantId}::uuid AND ativo = true
      AND id = ANY(${ids}::uuid[])
  `;
  if (users.length !== ids.length) {
    throw new AppError({
      code: 'RESOURCE_CONFLICT',
      statusCode: HTTP_STATUS.CONFLICT,
      message: 'Selecione apenas usuários ativos desta empresa.',
    });
  }
  await tx.$executeRaw`
    DELETE FROM modulo_kanban_universal.board_members
    WHERE tenant_id = ${tenantId}::uuid AND board_id = ${boardId}::uuid
      AND NOT (usuario_id = ANY(${ids}::uuid[]))
  `;
  if (ids.length) {
    await tx.$executeRaw`
      INSERT INTO modulo_kanban_universal.board_members (tenant_id, board_id, usuario_id)
      SELECT ${tenantId}::uuid, ${boardId}::uuid, usuario_id
      FROM unnest(${ids}::uuid[]) AS participantes(usuario_id)
      ON CONFLICT (tenant_id, board_id, usuario_id) DO NOTHING
    `;
  }
  if (permissions) {
    if (
      new Set(permissions.map((item) => item.id)).size !== permissions.length ||
      permissions.some((item) => !ids.includes(item.id))
    ) {
      throw new AppError({
        code: 'RESOURCE_CONFLICT',
        statusCode: HTTP_STATUS.CONFLICT,
        message: 'Permissões devem corresponder aos participantes selecionados.',
      });
    }
    await tx.$executeRaw`
      UPDATE modulo_kanban_universal.board_members m SET permissao=p.permissao
      FROM jsonb_to_recordset(${JSON.stringify(permissions)}::jsonb) AS p(id uuid, permissao text)
      WHERE m.tenant_id=${tenantId}::uuid AND m.board_id=${boardId}::uuid AND m.usuario_id=p.id
    `;
  }
  // Um usuário removido da equipe deixa de ser responsável pelos cards do quadro.
  await tx.$executeRaw`
    UPDATE modulo_kanban_universal.cards SET responsavel_id = NULL
    WHERE tenant_id = ${tenantId}::uuid AND board_id = ${boardId}::uuid
      AND responsavel_id IS NOT NULL
      AND NOT (responsavel_id = ANY(${ids}::uuid[]))
  `;
  return listarParticipantes(tx, tenantId, boardId);
}
