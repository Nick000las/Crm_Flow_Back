import { getAdminClient, getTenantClient } from '#core/db/tenantClient.js';

const TENANT_BATCH = 50;
const EMAIL_BATCH = 10;
const MAX_ATTEMPTS = 5;
const RETRY_SECONDS = 300;

// Só a descoberta de tenants usa o client de plataforma. Conteúdo e fila sempre usam RLS.
export function listarEmpresasParaEmail(after) {
  return getAdminClient().$queryRaw`
    SELECT tm.tenant_id AS id FROM public.tenant_modules tm
    JOIN public.tenants t ON t.id = tm.tenant_id
    WHERE tm.module_key = 'kanban_universal' AND tm.disabled_at IS NULL
      AND (${after}::uuid IS NULL OR tm.tenant_id > ${after}::uuid)
      AND t.status IN ('active','trial')
    ORDER BY tm.tenant_id LIMIT ${TENANT_BATCH}
  `;
}

export function prepararEmails(tenantId, timezone, leaseId) {
  return getTenantClient(tenantId, async (tx) => {
    // Um lembrete por card, responsável e data de prazo. A data é calendário no fuso configurado.
    await tx.$executeRaw`
      INSERT INTO modulo_kanban_universal.email_outbox(tenant_id,board_id,card_id,usuario_id,kind,dedupe_key)
      SELECT c.tenant_id,c.board_id,c.id,c.responsavel_id,'due',
        'due:' || c.id::text || ':' || c.responsavel_id::text || ':' || (c.dados_extras->>'prazo')
      FROM modulo_kanban_universal.cards c
      WHERE c.tenant_id=${tenantId}::uuid AND c.archived_at IS NULL AND c.responsavel_id IS NOT NULL
        AND COALESCE(c.dados_extras->>'prazoConcluido','false') <> 'true'
        AND c.dados_extras->>'prazo' = to_char(now() AT TIME ZONE ${timezone}, 'YYYY-MM-DD')
      ON CONFLICT(tenant_id,dedupe_key) DO NOTHING
    `;
    await tx.$executeRaw`UPDATE modulo_kanban_universal.email_outbox SET status='failed' WHERE tenant_id=${tenantId}::uuid AND status='pending' AND attempts>=${MAX_ATTEMPTS} AND (locked_until IS NULL OR locked_until<now())`;
    return tx.$queryRaw`
      UPDATE modulo_kanban_universal.email_outbox o
      SET locked_until=now()+interval '5 minutes',lease_id=${leaseId}::uuid,attempts=attempts+1
      WHERE o.tenant_id=${tenantId}::uuid AND o.id IN (
        SELECT id FROM modulo_kanban_universal.email_outbox
        WHERE tenant_id=${tenantId}::uuid AND status='pending' AND next_attempt_at<=now()
          AND (locked_until IS NULL OR locked_until<now()) AND attempts<${MAX_ATTEMPTS}
        ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT ${EMAIL_BATCH}
      ) RETURNING o.*
    `;
  });
}

export function carregarEmailAutorizado(tenantId, notification) {
  return getTenantClient(tenantId, async (tx) => {
    const rows = await tx.$queryRaw`
      SELECT u.email,c.titulo,b.nome AS quadro FROM modulo_kanban_universal.cards c
      JOIN modulo_kanban_universal.email_outbox claim ON claim.tenant_id=c.tenant_id AND claim.card_id=c.id
        AND claim.id=${notification.id}::uuid AND claim.lease_id=${notification.lease_id}::uuid AND claim.locked_until>now() AND claim.status='pending'
      JOIN modulo_kanban_universal.boards b ON b.tenant_id=c.tenant_id AND b.id=c.board_id
      JOIN public.usuarios u ON u.tenant_id=c.tenant_id AND u.id=${notification.usuario_id}::uuid AND u.ativo
      JOIN public.tenant_modules tm ON tm.tenant_id=c.tenant_id AND tm.module_key='kanban_universal' AND tm.disabled_at IS NULL
      LEFT JOIN modulo_kanban_universal.email_preferences p ON p.tenant_id=u.tenant_id AND p.usuario_id=u.id
      LEFT JOIN modulo_kanban_universal.board_members bm ON bm.tenant_id=u.tenant_id AND bm.usuario_id=u.id AND bm.board_id=b.id
      WHERE c.tenant_id=${tenantId}::uuid AND c.id=${notification.card_id}::uuid AND c.archived_at IS NULL
        AND COALESCE(p.enabled,true) AND (u.role IN ('DONO','MASTER') OR bm.usuario_id IS NOT NULL)
        AND (${notification.kind}='mention' OR c.responsavel_id=u.id)
        AND (${notification.kind}<>'mention' OR EXISTS (SELECT 1 FROM modulo_kanban_universal.card_comments cm
          WHERE cm.tenant_id=c.tenant_id AND cm.card_id=c.id AND cm.id::text=split_part(${notification.dedupe_key},':',1)))
        AND (${notification.kind}<>'due' OR (COALESCE(c.dados_extras->>'prazoConcluido','false')<>'true'
          AND ${notification.dedupe_key}='due:'||c.id::text||':'||u.id::text||':'||(c.dados_extras->>'prazo')))
    `;
    return rows[0];
  });
}

export function concluirEmail(tenantId, item, status) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$executeRaw`
    UPDATE modulo_kanban_universal.email_outbox
    SET status=${status === 'retry' ? (item.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending') : status},
      locked_until=NULL,lease_id=NULL,next_attempt_at=now()+make_interval(secs=>${RETRY_SECONDS * item.attempts})
    WHERE tenant_id=${tenantId}::uuid AND id=${item.id}::uuid AND lease_id=${item.lease_id}::uuid
  `,
  );
}
