/**
 * @file Consultas e gravações dos quadros nativos: SQL parametrizado e abertura de transações
 * com RLS.
 * @layer repository
 */
import { getAdminClient, getTenantClient } from '#core/db/tenantClient.js';

/** Reutiliza a transação do lote; nunca abre uma conexão sem contexto de tenant. */
export function withKanbanTransaction(tenantId, callback, transaction) {
  return transaction ? callback(transaction) : getTenantClient(tenantId, callback);
}

/** Metadado de plataforma com filtro explícito; conteúdo do quadro usa somente RLS. */
export function findCompanyTimezone(tenantId) {
  return getAdminClient().tenant.findUnique({
    where: { id: tenantId },
    select: { fusoHorario: true },
  });
}

export function findCommentBoard(tx, { tenantId, commentId }) {
  return tx.$queryRaw`
    SELECT
      c.board_id,
      c.id AS card_id
    FROM
      modulo_kanban_universal.card_comments m
      JOIN modulo_kanban_universal.cards c ON c.tenant_id = m.tenant_id
      AND c.id = m.card_id
    WHERE
      m.tenant_id = ${tenantId}::uuid
      AND m.id = ${commentId}::uuid
  `;
}

export function findResourceBoards(tx, { tenantId, resourceId }) {
  return tx.$queryRaw`
    SELECT
      id AS board_id
    FROM
      modulo_kanban_universal.boards
    WHERE
      tenant_id = ${tenantId}::uuid
      AND id = ${resourceId}::uuid
    UNION ALL
    SELECT
      board_id
    FROM
      modulo_kanban_universal.colunas
    WHERE
      tenant_id = ${tenantId}::uuid
      AND id = ${resourceId}::uuid
    UNION ALL
    SELECT
      board_id
    FROM
      modulo_kanban_universal.cards
    WHERE
      tenant_id = ${tenantId}::uuid
      AND id = ${resourceId}::uuid
  `;
}

export function listSnapshotBoards(tx, { tenantId, boardId }) {
  return tx.$queryRaw`
    SELECT
      *
    FROM
      modulo_kanban_universal.boards
    WHERE
      tenant_id = ${tenantId}::uuid
      AND id = ${boardId}::uuid
  `;
}

export function listSnapshotColumns(tx, { tenantId, boardId }) {
  return tx.$queryRaw`
    SELECT
      *
    FROM
      modulo_kanban_universal.colunas
    WHERE
      tenant_id = ${tenantId}::uuid
      AND board_id = ${boardId}::uuid
    ORDER BY
      "order",
      id
  `;
}

export function listSnapshotCards(tx, { tenantId, boardId }) {
  return tx.$queryRaw`
    SELECT
      *
    FROM
      modulo_kanban_universal.cards
    WHERE
      tenant_id = ${tenantId}::uuid
      AND board_id = ${boardId}::uuid
    ORDER BY
      "order",
      id
  `;
}

export function setAuditActor(tx, { actorId }) {
  return tx.$queryRaw`
    SELECT
      set_config('app.current_user_id', ${actorId}, TRUE)
  `;
}

export function findEmailPreference(tx, { tenantId, userId }) {
  return tx.$queryRaw`
    SELECT
      enabled
    FROM
      modulo_kanban_universal.email_preferences
    WHERE
      tenant_id = ${tenantId}::uuid
      AND usuario_id = ${userId}::uuid
  `;
}

export function saveEmailPreference(tx, { tenantId, userId, enabled }) {
  return tx.$executeRaw`
    INSERT INTO
      modulo_kanban_universal.email_preferences (tenant_id, usuario_id, enabled)
    VALUES
      (${tenantId}::uuid, ${userId}::uuid, ${enabled})
    ON CONFLICT (tenant_id, usuario_id) DO UPDATE
    SET
      enabled = EXCLUDED.enabled
  `;
}

export function lockBoard(tx, { boardId }) {
  return tx.$executeRaw`
    SELECT
      pg_advisory_xact_lock(hashtextextended (${boardId}, 0))
  `;
}

export function findAvailableLead(tx, { tenantId, leadId }) {
  return tx.$queryRaw`
    SELECT
      l.id
    FROM
      modulo_crm.leads l
      JOIN public.tenant_modules m ON m.tenant_id = l.tenant_id
      AND m.module_key = 'crm'
      AND m.disabled_at IS NULL
    WHERE
      l.tenant_id = ${tenantId}::uuid
      AND l.id = ${leadId}::uuid
      AND l.deleted_at IS NULL
      AND l.anonimizado_em IS NULL
      AND l.mesclado_em_id IS NULL
    FOR SHARE OF
      l
  `;
}

export function countActiveColumnCards(tx, { tenantId, columnId }) {
  return tx.$queryRaw`
    SELECT
      count(*)::int AS total
    FROM
      modulo_kanban_universal.cards
    WHERE
      tenant_id = ${tenantId}::uuid
      AND coluna_id = ${columnId}::uuid
      AND archived_at IS NULL
  `;
}

export function insertRecurringCard(
  tx,
  { tenantId, boardId, columnId, title, assignee, details, order },
) {
  return tx.$executeRaw`
    INSERT INTO
      modulo_kanban_universal.cards (tenant_id, board_id, coluna_id, titulo, responsavel_id, dados_extras, "order")
    VALUES
      (
        ${tenantId}::uuid,
        ${boardId}::uuid,
        ${columnId}::uuid,
        ${title},
        ${assignee}::uuid,
        ${JSON.stringify(details)}::jsonb,
        ${order}
      )
  `;
}

export function updateCardPosition(tx, { order, columnId, tenantId, cardId }) {
  return tx.$executeRaw`
    UPDATE modulo_kanban_universal.cards
    SET
      "order" = ${order},
      coluna_id = ${columnId}::uuid
    WHERE
      tenant_id = ${tenantId}::uuid
      AND id = ${cardId}::uuid
  `;
}

export function countBoardComments(tx, { tenantId, boardId }) {
  return tx.$queryRaw`
    SELECT
      m.card_id,
      count(*)::int AS total
    FROM
      modulo_kanban_universal.card_comments m
      JOIN modulo_kanban_universal.cards c ON c.tenant_id = m.tenant_id
      AND c.id = m.card_id
    WHERE
      m.tenant_id = ${tenantId}::uuid
      AND c.board_id = ${boardId}::uuid
    GROUP BY
      m.card_id
  `;
}

export function listCardCompletions(tx, { tenantId, boardId }) {
  return tx.$queryRaw`
    SELECT
      c.id,
      c.created_at,
      min(a.created_at) AS completed_at
    FROM
      modulo_kanban_universal.cards c
      JOIN modulo_kanban_universal.activities a ON a.tenant_id = c.tenant_id
      AND a.card_id = c.id
      AND a.action = 'card.complete'
    WHERE
      c.tenant_id = ${tenantId}::uuid
      AND c.board_id = ${boardId}::uuid
      AND c.dados_extras ->> 'prazoConcluido' = 'true'
      AND COALESCE(c.dados_extras ->> 'modelo', 'false') <> 'true'
    GROUP BY
      c.id,
      c.created_at
  `;
}

export function reportStageDurations(tx, { tenantId, boardId }) {
  return tx.$queryRaw`
    WITH
      eventos AS (
        SELECT
          id,
          card_id,
          action,
          details ->> 'colunaId' AS coluna_id,
          created_at,
          lag(details ->> 'colunaId') OVER (
            PARTITION BY
              card_id
            ORDER BY
              created_at,
              id
          ) AS anterior
        FROM
          modulo_kanban_universal.activities
        WHERE
          tenant_id = ${tenantId}::uuid
          AND board_id = ${boardId}::uuid
          AND action IN ('card.create', 'card.move', 'card.archive', 'card.restore')
          AND card_id IN (
            SELECT
              id
            FROM
              modulo_kanban_universal.cards
            WHERE
              tenant_id = ${tenantId}::uuid
              AND COALESCE(dados_extras ->> 'modelo', 'false') <> 'true'
          )
      ),
      etapas AS (
        SELECT
          card_id,
          action,
          coluna_id,
          created_at,
          lead(created_at, 1, now()::timestamp) OVER (
            PARTITION BY
              card_id
            ORDER BY
              created_at,
              id
          ) AS fim
        FROM
          eventos
        WHERE
          action IN ('card.create', 'card.archive', 'card.restore')
          OR coluna_id IS DISTINCT FROM anterior
      )
    SELECT
      c.id,
      c.nome,
      count(DISTINCT e.card_id)::int AS cards,
      COALESCE(
        avg(
          EXTRACT(
            EPOCH
            FROM
              (e.fim - e.created_at)
          )
        ) / 3600,
        0
      )::float AS horas
    FROM
      modulo_kanban_universal.colunas c
      LEFT JOIN etapas e ON e.coluna_id = c.id::text
      AND e.action <> 'card.archive'
    WHERE
      c.tenant_id = ${tenantId}::uuid
      AND c.board_id = ${boardId}::uuid
    GROUP BY
      c.id,
      c.nome,
      c."order"
    ORDER BY
      c."order"
  `;
}

export function listCardActivities(tx, { tenantId, cardId }) {
  return tx.$queryRaw`
    SELECT
      a.id,
      a.action,
      a.details,
      a.created_at AS "createdAt",
      u.nome AS autor
    FROM
      modulo_kanban_universal.activities a
      LEFT JOIN public.usuarios u ON u.tenant_id = a.tenant_id
      AND u.id = a.actor_id
    WHERE
      a.tenant_id = ${tenantId}::uuid
      AND a.card_id = ${cardId}::uuid
    ORDER BY
      a.created_at DESC,
      a.id DESC
    LIMIT
      100
  `;
}

export function updateCardArchive(tx, { archivedAt, order, tenantId, cardId }) {
  return tx.$queryRaw`
    UPDATE modulo_kanban_universal.cards
    SET
      archived_at = ${archivedAt},
      "order" = ${order},
      updated_at = now()
    WHERE
      tenant_id = ${tenantId}::uuid
      AND id = ${cardId}::uuid
    RETURNING
      *
  `;
}

export function insertBoard(tx, { tenantId, name, boardType }) {
  return tx.$queryRaw`
    INSERT INTO
      modulo_kanban_universal.boards (tenant_id, nome, board_type)
    VALUES
      (${tenantId}::uuid, ${name}, ${boardType})
    RETURNING
      *
  `;
}

export function insertInitialColumns(tx, { tenantId, boardId, names }) {
  return tx.$executeRaw`
    INSERT INTO
      modulo_kanban_universal.colunas (tenant_id, board_id, nome, "order")
    SELECT
      ${tenantId}::uuid,
      ${boardId}::uuid,
      nome,
      (posicao - 1)::integer
    FROM
      unnest(${names}::TEXT[]) WITH ORDINALITY AS etapas (nome, posicao)
  `;
}

export function updateBoardName(tx, { name, tenantId, boardId }) {
  return tx.$queryRaw`
    UPDATE modulo_kanban_universal.boards
    SET
      nome = ${name}
    WHERE
      tenant_id = ${tenantId}::uuid
      AND id = ${boardId}::uuid
    RETURNING
      *
  `;
}

export function deleteBoardCards(tx, { tenantId, boardId }) {
  return tx.$executeRaw`
    DELETE FROM modulo_kanban_universal.cards
    WHERE
      tenant_id = ${tenantId}::uuid
      AND board_id = ${boardId}::uuid
  `;
}

export function deleteBoard(tx, { tenantId, boardId }) {
  return tx.$executeRaw`
    DELETE FROM modulo_kanban_universal.boards
    WHERE
      tenant_id = ${tenantId}::uuid
      AND id = ${boardId}::uuid
  `;
}

export function insertColumn(tx, { tenantId, boardId, name, order, wipLimit, rules }) {
  return tx.$queryRaw`
    INSERT INTO
      modulo_kanban_universal.colunas (tenant_id, board_id, nome, "order", wip_limit, regras_fluxo)
    VALUES
      (${tenantId}::uuid, ${boardId}::uuid, ${name}, ${order}, ${wipLimit}, ${JSON.stringify(rules)}::jsonb)
    RETURNING
      *
  `;
}

export function updateColumn(tx, { name, wipLimit, rules, tenantId, columnId }) {
  return tx.$queryRaw`
    UPDATE modulo_kanban_universal.colunas
    SET
      nome = ${name},
      wip_limit = ${wipLimit},
      regras_fluxo = ${JSON.stringify(rules)}::jsonb
    WHERE
      tenant_id = ${tenantId}::uuid
      AND id = ${columnId}::uuid
    RETURNING
      *
  `;
}

export function updateColumnOrder(tx, { order, tenantId, columnId }) {
  return tx.$executeRaw`
    UPDATE modulo_kanban_universal.colunas
    SET
      "order" = ${order}
    WHERE
      tenant_id = ${tenantId}::uuid
      AND id = ${columnId}::uuid
  `;
}

export function deleteColumn(tx, { tenantId, columnId }) {
  return tx.$executeRaw`
    DELETE FROM modulo_kanban_universal.colunas
    WHERE
      tenant_id = ${tenantId}::uuid
      AND id = ${columnId}::uuid
  `;
}

export function updateCardLink(tx, { entityType, entityId, tenantId, cardId }) {
  return tx.$queryRaw`
    UPDATE modulo_kanban_universal.cards
    SET
      entidade_tipo = ${entityType},
      entidade_id = ${entityId}::uuid,
      updated_at = now()
    WHERE
      tenant_id = ${tenantId}::uuid
      AND id = ${cardId}::uuid
    RETURNING
      *
  `;
}

export function insertLinkActivity(tx, { tenantId, boardId, cardId, actorId, action, details }) {
  return tx.$executeRaw`
    INSERT INTO
      modulo_kanban_universal.activities (tenant_id, board_id, card_id, actor_id, action, details)
    VALUES
      (
        ${tenantId}::uuid,
        ${boardId}::uuid,
        ${cardId}::uuid,
        ${actorId}::uuid,
        ${action},
        ${JSON.stringify(details)}::jsonb
      )
  `;
}

export function insertCard(tx, { tenantId, boardId, columnId, title, assignee, details, order }) {
  return tx.$queryRaw`
    INSERT INTO
      modulo_kanban_universal.cards (tenant_id, board_id, coluna_id, titulo, responsavel_id, dados_extras, "order")
    VALUES
      (
        ${tenantId}::uuid,
        ${boardId}::uuid,
        ${columnId}::uuid,
        ${title},
        ${assignee}::uuid,
        ${JSON.stringify(details)}::jsonb,
        ${order}
      )
    RETURNING
      *
  `;
}

export function updateCardDetails(tx, { details, tenantId, cardId }) {
  return tx.$queryRaw`
    UPDATE modulo_kanban_universal.cards
    SET
      dados_extras = ${JSON.stringify(details)}::jsonb
    WHERE
      tenant_id = ${tenantId}::uuid
      AND id = ${cardId}::uuid
    RETURNING
      *
  `;
}

export function insertCardCopy(
  tx,
  { tenantId, boardId, columnId, title, assignee, details, order },
) {
  return tx.$queryRaw`
    INSERT INTO
      modulo_kanban_universal.cards (tenant_id, board_id, coluna_id, titulo, responsavel_id, dados_extras, "order")
    VALUES
      (
        ${tenantId}::uuid,
        ${boardId}::uuid,
        ${columnId}::uuid,
        ${title},
        ${assignee}::uuid,
        ${JSON.stringify(details)}::jsonb,
        ${order}
      )
    RETURNING
      *
  `;
}

export function insertCompletionActivity(tx, { tenantId, boardId, cardId, actorId }) {
  return tx.$executeRaw`
    INSERT INTO
      modulo_kanban_universal.activities (tenant_id, board_id, card_id, actor_id, action)
    VALUES
      (${tenantId}::uuid, ${boardId}::uuid, ${cardId}::uuid, ${actorId}::uuid, 'card.complete')
  `;
}

export function updateCard(tx, { title, assignee, details, tenantId, cardId }) {
  return tx.$queryRaw`
    UPDATE modulo_kanban_universal.cards
    SET
      titulo = ${title},
      responsavel_id = ${assignee}::uuid,
      dados_extras = ${JSON.stringify(details)}::jsonb
    WHERE
      tenant_id = ${tenantId}::uuid
      AND id = ${cardId}::uuid
    RETURNING
      *
  `;
}

export function updateAutomatedCard(tx, { details, assignee, tenantId, cardId }) {
  return tx.$executeRaw`
    UPDATE modulo_kanban_universal.cards
    SET
      dados_extras = ${JSON.stringify(details)}::jsonb,
      responsavel_id = ${assignee}::uuid
    WHERE
      tenant_id = ${tenantId}::uuid
      AND id = ${cardId}::uuid
  `;
}

export function insertAutomatedTask(
  tx,
  { tenantId, boardId, columnId, title, assignee, details, order },
) {
  return tx.$executeRaw`
    INSERT INTO
      modulo_kanban_universal.cards (tenant_id, board_id, coluna_id, titulo, responsavel_id, dados_extras, "order")
    VALUES
      (
        ${tenantId}::uuid,
        ${boardId}::uuid,
        ${columnId}::uuid,
        ${title},
        ${assignee}::uuid,
        ${JSON.stringify(details)}::jsonb,
        ${order}
      )
  `;
}

export function insertMoveActivity(tx, { tenantId, boardId, cardId, actorId, details }) {
  return tx.$executeRaw`
    INSERT INTO
      modulo_kanban_universal.activities (tenant_id, board_id, card_id, actor_id, action, details)
    VALUES
      (
        ${tenantId}::uuid,
        ${boardId}::uuid,
        ${cardId}::uuid,
        ${actorId}::uuid,
        'card.move',
        ${JSON.stringify(details)}::jsonb
      )
  `;
}

export function findCard(tx, { tenantId, cardId }) {
  return tx.$queryRaw`
    SELECT
      *
    FROM
      modulo_kanban_universal.cards
    WHERE
      tenant_id = ${tenantId}::uuid
      AND id = ${cardId}::uuid
  `;
}

export function deleteCard(tx, { tenantId, cardId }) {
  return tx.$executeRaw`
    DELETE FROM modulo_kanban_universal.cards
    WHERE
      tenant_id = ${tenantId}::uuid
      AND id = ${cardId}::uuid
  `;
}

export function listCardComments(tx, { tenantId, cardId }) {
  return tx.$queryRaw`
    SELECT
      c.*,
      u.nome AS autor
    FROM
      modulo_kanban_universal.card_comments c
      LEFT JOIN usuarios u ON u.id = c.usuario_id
      AND u.tenant_id = c.tenant_id
    WHERE
      c.tenant_id = ${tenantId}::uuid
      AND c.card_id = ${cardId}::uuid
    ORDER BY
      c.created_at,
      c.id
  `;
}

export function insertComment(tx, { tenantId, cardId, userId, content, mentionedIds }) {
  return tx.$queryRaw`
    INSERT INTO
      modulo_kanban_universal.card_comments (tenant_id, card_id, usuario_id, conteudo, mencionados)
    VALUES
      (${tenantId}::uuid, ${cardId}::uuid, ${userId}::uuid, ${content}, ${mentionedIds}::UUID[])
    RETURNING
      *
  `;
}

export function findComment(tx, { tenantId, commentId }) {
  return tx.$queryRaw`
    SELECT
      *
    FROM
      modulo_kanban_universal.card_comments
    WHERE
      tenant_id = ${tenantId}::uuid
      AND id = ${commentId}::uuid
  `;
}

export function insertCommentActivity(tx, { tenantId, boardId, cardId, actorId }) {
  return tx.$executeRaw`
    INSERT INTO
      modulo_kanban_universal.activities (tenant_id, board_id, card_id, actor_id, action)
    VALUES
      (
        ${tenantId}::uuid,
        ${boardId}::uuid,
        ${cardId}::uuid,
        ${actorId}::uuid,
        'comment.update'
      )
  `;
}

export function updateComment(tx, { content, tenantId, commentId }) {
  return tx.$queryRaw`
    UPDATE modulo_kanban_universal.card_comments
    SET
      conteudo = ${content},
      edited_at = now()
    WHERE
      tenant_id = ${tenantId}::uuid
      AND id = ${commentId}::uuid
    RETURNING
      *
  `;
}

export function deleteComment(tx, { tenantId, commentId }) {
  return tx.$executeRaw`
    DELETE FROM modulo_kanban_universal.card_comments
    WHERE
      tenant_id = ${tenantId}::uuid
      AND id = ${commentId}::uuid
  `;
}

export function listActiveUsers(tx, { tenantId }) {
  return tx.$queryRaw`
    SELECT
      id,
      nome,
      ativo
    FROM
      usuarios
    WHERE
      tenant_id = ${tenantId}::uuid
      AND ativo = TRUE
    ORDER BY
      nome
  `;
}
