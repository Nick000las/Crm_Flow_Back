import {
  exigirParticipacao,
  listarParticipantes,
  salvarParticipantes,
} from './board-members.repository.js';
import { getTenantClient } from '#core/db/tenantClient.js';
import { AppError } from '#core/errors/app-error.js';
import { HTTP_STATUS } from '#shared/constants/index.js';

function fail(message, conflict = false) {
  throw new AppError({
    code: conflict ? 'RESOURCE_CONFLICT' : 'RESOURCE_NOT_FOUND',
    statusCode: conflict ? HTTP_STATUS.CONFLICT : HTTP_STATUS.NOT_FOUND,
    message,
  });
}
const present = (row) =>
  row &&
  Object.fromEntries(
    Object.entries(row)
      .filter(([key]) => key !== 'tenant_id')
      .map(([key, value]) => [
        key === 'order' ? 'ordem' : key.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
        value,
      ]),
  );

// Todas as mutações do tenant são serializadas antes de ler o estado.
// O lock transacional também protege inserções e reordenações concorrentes.
export function executar(tenantId, action, id, data = {}, context = {}, change) {
  return getTenantClient(tenantId, async (tx) => {
    const enabled =
      await tx.$queryRaw`SELECT id FROM tenant_modules WHERE tenant_id = ${tenantId}::uuid AND module_key = 'kanban_universal' AND disabled_at IS NULL`;
    if (!enabled.length) {
      throw new AppError({
        code: 'FORBIDDEN',
        statusCode: HTTP_STATUS.FORBIDDEN,
        message: 'O módulo Kanban não está ativo para esta empresa.',
      });
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId}, 0))`;
    const boards =
      await tx.$queryRaw`SELECT * FROM modulo_kanban_universal.boards WHERE tenant_id = ${tenantId}::uuid ORDER BY created_at, id`;
    const columns =
      await tx.$queryRaw`SELECT * FROM modulo_kanban_universal.colunas WHERE tenant_id = ${tenantId}::uuid ORDER BY "order", id`;
    const allCards =
      await tx.$queryRaw`SELECT * FROM modulo_kanban_universal.cards WHERE tenant_id = ${tenantId}::uuid ORDER BY "order", id`;
    const cards = allCards.filter((item) => !item.archived_at);
    const reads = [
      'board.get',
      'board.members',
      'card.get',
      'card.list',
      'comment.list',
      'members',
      'archive.list',
      'activity.list',
      'email.get',
    ];
    if (!reads.includes(action)) {
      await tx.$queryRaw`SELECT set_config('app.current_user_id', ${context.userId ?? ''}, true)`;
    }
    if (action === 'email.get') {
      const rows =
        await tx.$queryRaw`SELECT enabled FROM modulo_kanban_universal.email_preferences WHERE tenant_id=${tenantId}::uuid AND usuario_id=${context.userId}::uuid`;
      return { enabled: rows[0]?.enabled ?? true };
    }
    if (action === 'email.update') {
      await tx.$executeRaw`INSERT INTO modulo_kanban_universal.email_preferences(tenant_id,usuario_id,enabled) VALUES(${tenantId}::uuid,${context.userId}::uuid,${data.enabled}) ON CONFLICT(tenant_id,usuario_id) DO UPDATE SET enabled=EXCLUDED.enabled`;
      return { enabled: data.enabled };
    }
    const board = boards.find((b) => b.id === id);
    const column = columns.find((c) => c.id === id);
    const card = allCards.find((c) => c.id === id);
    // Resolve também recursos indiretos antes de autorizar (cards, colunas, comentários).
    let resourceBoardId = board?.id ?? column?.board_id ?? card?.board_id;
    if (action === 'comment.delete') {
      const comments = await tx.$queryRaw`
        SELECT c.board_id, c.id AS card_id FROM modulo_kanban_universal.card_comments m
        JOIN modulo_kanban_universal.cards c ON c.tenant_id = m.tenant_id AND c.id = m.card_id
        WHERE m.tenant_id = ${tenantId}::uuid AND m.id = ${id}::uuid
      `;
      resourceBoardId = comments[0]?.board_id;
      if (change) {
        change.cardId = comments[0]?.card_id;
      }
    }
    if (resourceBoardId) {
      await exigirParticipacao(tx, tenantId, resourceBoardId, context, !reads.includes(action));
    }
    if (change && resourceBoardId) {
      change.boardId = resourceBoardId;
      change.cardId ??= card?.id;
      change.previousUserIds = (await listarParticipantes(tx, tenantId, resourceBoardId))
        .filter((user) => user.ativo)
        .map((user) => user.id);
    }
    if (
      card?.archived_at &&
      !reads.includes(action) &&
      !['card.restore', 'card.delete'].includes(action)
    ) {
      fail('Restaure o card antes de alterá-lo.', true);
    }
    const requireBoard = () => board || fail('Quadro não encontrado.');
    const requireColumn = () => column || fail('Coluna não encontrada.');
    const requireCard = () => card || fail('Card não encontrado.');
    const validColumn = (columnId, boardId) =>
      columns.find((c) => c.id === columnId && c.board_id === boardId) ||
      fail('A coluna não pertence ao quadro.', true);
    async function assignable() {
      if (!data.responsavelId) {
        return;
      }
      const participants = await listarParticipantes(tx, tenantId, resourceBoardId);
      const users = participants.filter((user) => user.id === data.responsavelId && user.ativo);
      if (!users.length) {
        fail('O responsável deve ser um participante ativo do quadro.', true);
      }
    }
    async function reorder(items, columnId) {
      for (const [order, item] of items.entries()) {
        await tx.$executeRaw`UPDATE modulo_kanban_universal.cards SET "order" = ${order}, coluna_id = ${columnId}::uuid WHERE tenant_id = ${tenantId}::uuid AND id = ${item.id}::uuid`;
      }
    }
    if (action === 'board.get') {
      requireBoard();
      const participantes = await listarParticipantes(tx, tenantId, id);
      return {
        ...present(board),
        canEdit:
          ['DONO', 'MASTER'].includes(context.role) ||
          participantes.find((member) => member.id === context.userId)?.permissao !== 'leitor',
        participantes,
        colunas: columns
          .filter((c) => c.board_id === id)
          .map((c) => ({
            ...present(c),
            cards: cards.filter((k) => k.coluna_id === c.id).map(present),
          })),
      };
    }
    if (action === 'activity.list') {
      requireCard();
      return await tx.$queryRaw`
        SELECT a.id,a.action,a.details,a.created_at AS "createdAt",u.nome AS autor
        FROM modulo_kanban_universal.activities a
        LEFT JOIN public.usuarios u ON u.tenant_id=a.tenant_id AND u.id=a.actor_id
        WHERE a.tenant_id=${tenantId}::uuid AND a.card_id=${id}::uuid
        ORDER BY a.created_at DESC,a.id DESC LIMIT 100
      `;
    }
    if (action === 'archive.list') {
      requireBoard();
      return allCards.filter((item) => item.board_id === id && item.archived_at).map(present);
    }
    if (['card.archive', 'card.restore'].includes(action)) {
      requireCard();
      if (
        data.expectedUpdatedAt &&
        new Date(data.expectedUpdatedAt).getTime() !== new Date(card.updated_at).getTime()
      ) {
        fail('Este card mudou. Atualize antes de continuar.', true);
      }
      const restoring = action === 'card.restore';
      const archivedAt = restoring ? null : new Date();
      const order = cards.filter(
        (item) => item.coluna_id === card.coluna_id && item.id !== id,
      ).length;
      const result = (
        await tx.$queryRaw`UPDATE modulo_kanban_universal.cards SET archived_at=${archivedAt}, "order"=${order}, updated_at=now() WHERE tenant_id=${tenantId}::uuid AND id=${id}::uuid RETURNING *`
      )[0];
      await reorder(
        cards.filter((item) => item.coluna_id === card.coluna_id && item.id !== id),
        card.coluna_id,
      );
      return present(result);
    }
    if (action === 'board.members') {
      requireBoard();
      return listarParticipantes(tx, tenantId, id);
    }
    if (action === 'board.members.update') {
      requireBoard();
      return salvarParticipantes(tx, tenantId, id, data.participantes, data.permissoes);
    }
    if (action === 'board.create') {
      const created = (
        await tx.$queryRaw`
        INSERT INTO modulo_kanban_universal.boards (tenant_id, nome, board_type)
        VALUES (${tenantId}::uuid, ${data.nome}, ${data.boardType}) RETURNING *
      `
      )[0];
      if (change) {
        change.boardId = created.id;
      }
      // O criador participa inicialmente, além da equipe escolhida.
      const ids = [...new Set([context.userId, ...(data.participantes ?? [])])];
      const participantes = await salvarParticipantes(
        tx,
        tenantId,
        created.id,
        ids,
        data.permissoes,
      );
      // Colunas e equipe usam a mesma transação: falha desfaz a criação inteira.
      const initialColumns = data.colunasIniciais ?? [];
      if (initialColumns.length) {
        await tx.$executeRaw`
          INSERT INTO modulo_kanban_universal.colunas (tenant_id, board_id, nome, "order")
          SELECT ${tenantId}::uuid, ${created.id}::uuid, nome, (posicao - 1)::integer
          FROM unnest(${initialColumns}::text[]) WITH ORDINALITY AS etapas(nome, posicao)
        `;
      }
      return { ...present(created), participantes };
    }
    if (action === 'board.update') {
      requireBoard();
      const updated = (
        await tx.$queryRaw`
        UPDATE modulo_kanban_universal.boards SET nome = ${data.nome}
        WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid RETURNING *
      `
      )[0];
      const participantes =
        data.participantes === undefined
          ? await listarParticipantes(tx, tenantId, id)
          : await salvarParticipantes(tx, tenantId, id, data.participantes, data.permissoes);
      return { ...present(updated), participantes };
    }
    if (action === 'board.delete') {
      requireBoard();
      await tx.$executeRaw`DELETE FROM modulo_kanban_universal.cards WHERE tenant_id = ${tenantId}::uuid AND board_id = ${id}::uuid`;
      await tx.$executeRaw`DELETE FROM modulo_kanban_universal.boards WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`;
      return null;
    }
    if (action === 'column.create') {
      requireBoard();
      const order = columns.filter((c) => c.board_id === id).length;
      return present(
        (
          await tx.$queryRaw`INSERT INTO modulo_kanban_universal.colunas (tenant_id, board_id, nome, "order", wip_limit) VALUES (${tenantId}::uuid, ${id}::uuid, ${data.nome}, ${order}, ${data.wipLimit ?? null}) RETURNING *`
        )[0],
      );
    }
    if (action === 'column.update') {
      requireColumn();
      return present(
        (
          await tx.$queryRaw`UPDATE modulo_kanban_universal.colunas SET nome = ${data.nome}, wip_limit = ${data.wipLimit === undefined ? column.wip_limit : data.wipLimit} WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid RETURNING *`
        )[0],
      );
    }
    if (action === 'column.reorder') {
      requireBoard();
      const ids = columns.filter((c) => c.board_id === id).map((c) => c.id);
      if (
        data.ids.length !== ids.length ||
        new Set(data.ids).size !== ids.length ||
        data.ids.some((i) => !ids.includes(i))
      ) {
        fail('Envie todas as colunas do quadro uma única vez.', true);
      }
      for (const [order, columnId] of data.ids.entries()) {
        await tx.$executeRaw`UPDATE modulo_kanban_universal.colunas SET "order" = ${order} WHERE tenant_id = ${tenantId}::uuid AND id = ${columnId}::uuid`;
      }
      return null;
    }
    if (action === 'column.delete') {
      requireColumn();
      if (allCards.some((c) => c.coluna_id === id)) {
        fail('Mova os cards, inclusive arquivados, antes de excluir a coluna.', true);
      }
      await tx.$executeRaw`DELETE FROM modulo_kanban_universal.colunas WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`;
      return null;
    }
    if (action === 'card.list') {
      requireBoard();
      return cards.filter((c) => c.board_id === id).map(present);
    }
    if (action === 'card.get') {
      requireCard();
      return present(card);
    }
    if (action === 'card.create') {
      requireBoard();
      validColumn(data.colunaId, id);
      await assignable();
      const order = cards.filter((c) => c.coluna_id === data.colunaId).length;
      return present(
        (
          await tx.$queryRaw`INSERT INTO modulo_kanban_universal.cards (tenant_id, board_id, coluna_id, titulo, responsavel_id, dados_extras, "order") VALUES (${tenantId}::uuid, ${id}::uuid, ${data.colunaId}::uuid, ${data.titulo}, ${data.responsavelId ?? null}::uuid, ${JSON.stringify(data.dadosExtras ?? {})}::jsonb, ${order}) RETURNING *`
        )[0],
      );
    }
    if (action === 'card.update') {
      requireCard();
      if (
        data.expectedUpdatedAt &&
        new Date(data.expectedUpdatedAt).getTime() !== new Date(card.updated_at).getTime()
      ) {
        fail(
          'Este card foi alterado por outra pessoa. Carregue a versão atual antes de salvar.',
          true,
        );
      }
      await assignable();
      const details = { ...card.dados_extras, ...data.dadosExtras };
      if (details.prazoConcluido === true && card.dados_extras?.prazoConcluido !== true) {
        await tx.$executeRaw`INSERT INTO modulo_kanban_universal.activities(tenant_id,board_id,card_id,actor_id,action)
          VALUES(${tenantId}::uuid,${card.board_id}::uuid,${id}::uuid,${context.userId}::uuid,'card.complete')`;
      }
      return present(
        (
          await tx.$queryRaw`UPDATE modulo_kanban_universal.cards SET titulo = ${data.titulo ?? card.titulo}, responsavel_id = ${data.responsavelId === undefined ? card.responsavel_id : data.responsavelId}::uuid, dados_extras = ${JSON.stringify(details)}::jsonb WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid RETURNING *`
        )[0],
      );
    }
    if (action === 'card.move') {
      requireCard();
      validColumn(data.novaColunaId, card.board_id);
      const target = cards.filter((c) => c.coluna_id === data.novaColunaId && c.id !== id);
      target.splice(Math.min(data.novaOrdem, target.length), 0, card);
      if (card.coluna_id !== data.novaColunaId) {
        await reorder(
          cards.filter((c) => c.coluna_id === card.coluna_id && c.id !== id),
          card.coluna_id,
        );
      }
      await reorder(target, data.novaColunaId);
      if (card.coluna_id === data.novaColunaId) {
        await tx.$executeRaw`INSERT INTO modulo_kanban_universal.activities(tenant_id,board_id,card_id,actor_id,action,details)
          VALUES(${tenantId}::uuid,${card.board_id}::uuid,${id}::uuid,${context.userId}::uuid,'card.move',${JSON.stringify({ colunaId: card.coluna_id, novaOrdem: data.novaOrdem })}::jsonb)`;
      }
      const result = (
        await tx.$queryRaw`SELECT * FROM modulo_kanban_universal.cards WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`
      )[0];
      return {
        ...present(result),
        conflito: Boolean(
          data.expectedUpdatedAt &&
          new Date(data.expectedUpdatedAt).getTime() !== new Date(card.updated_at).getTime(),
        ),
      };
    }
    if (action === 'card.delete') {
      requireCard();
      await tx.$executeRaw`DELETE FROM modulo_kanban_universal.cards WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`;
      await reorder(
        cards.filter((c) => c.coluna_id === card.coluna_id && c.id !== id),
        card.coluna_id,
      );
      return null;
    }
    if (action === 'comment.list') {
      requireCard();
      return (
        await tx.$queryRaw`SELECT c.*, u.nome AS autor FROM modulo_kanban_universal.card_comments c LEFT JOIN usuarios u ON u.id = c.usuario_id AND u.tenant_id = c.tenant_id WHERE c.tenant_id = ${tenantId}::uuid AND c.card_id = ${id}::uuid ORDER BY c.created_at, c.id`
      ).map(present);
    }
    if (action === 'comment.create') {
      requireCard();
      return present(
        (
          await tx.$queryRaw`INSERT INTO modulo_kanban_universal.card_comments (tenant_id, card_id, usuario_id, conteudo, mencionados) VALUES (${tenantId}::uuid, ${id}::uuid, ${context.userId}::uuid, ${data.conteudo}, ${data.mencionados ?? []}::uuid[]) RETURNING *`
        )[0],
      );
    }
    if (action === 'comment.delete') {
      const comment = (
        await tx.$queryRaw`SELECT * FROM modulo_kanban_universal.card_comments WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`
      )[0];
      if (!comment) {
        fail('Comentário não encontrado.');
      }
      if (context.role === 'OPERADOR' && comment.usuario_id !== context.userId) {
        throw new AppError({
          code: 'FORBIDDEN',
          statusCode: HTTP_STATUS.FORBIDDEN,
          message: 'Você só pode excluir seus comentários.',
        });
      }
      await tx.$executeRaw`DELETE FROM modulo_kanban_universal.card_comments WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`;
      return null;
    }
    if (action === 'members') {
      if (!['DONO', 'MASTER'].includes(context.role)) {
        throw new AppError({
          code: 'FORBIDDEN',
          statusCode: HTTP_STATUS.FORBIDDEN,
          message: 'A lista da empresa é restrita à gestão de quadros.',
        });
      }
      return (
        await tx.$queryRaw`SELECT id, nome, ativo FROM usuarios WHERE tenant_id = ${tenantId}::uuid AND ativo = true ORDER BY nome`
      ).map(present);
    }
    throw new Error('Operação Kanban desconhecida');
  });
}
export function verificarModulo(tenantId) {
  return getTenantClient(tenantId, async (tx) => {
    const rows =
      await tx.$queryRaw`SELECT id FROM tenant_modules WHERE tenant_id = ${tenantId}::uuid AND module_key = 'kanban_universal' AND disabled_at IS NULL`;
    if (!rows.length) {
      throw new AppError({
        code: 'FORBIDDEN',
        statusCode: HTTP_STATUS.FORBIDDEN,
        message: 'O módulo Kanban não está ativo para esta empresa.',
      });
    }
  });
}

/** Retorna os metadados apenas depois que o gateway confirmou a transação. */
export async function executarComEvento(tenantId, action, id, data, context) {
  const event = { tenantId, type: action, actorId: context.userId };
  const value = await executar(tenantId, action, id, data, context, event);
  if (action === 'card.create') {
    event.cardId = value.id;
  }
  event.conflito = value?.conflito ?? false;
  return { value, event };
}
