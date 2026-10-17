import { Prisma } from '@prisma/client';
import { getTenantClient } from '#core/db/tenantClient.js';

const FIRST_RESULT_INDEX = 0;

/**
 * ADAPTER: `crm_activity` (M6). Toda operação exige o lead fora da lixeira
 * (lead na lixeira = não existe, M5): sem linha, o service responde 404.
 *
 * Concluir uma atividade leva `leads.ultima_interacao_em` pra data da
 * conclusão, na mesma transação — nunca pra trás (`GREATEST`).
 *
 * @typedef {{
 *   id: string, lead_id: string, tipo: string, titulo: string, notas: string | null,
 *   agendada_para: Date | null, concluida_em: Date | null, autor_id: string | null,
 *   autor_nome: string | null, created_at: Date, updated_at: Date,
 * }} AtividadeLinha
 */

const COLUNAS = Prisma.sql`
  a.id, a.lead_id, a.tipo, a.titulo, a.notas, a.agendada_para, a.concluida_em,
  a.autor_id, u.nome AS autor_nome, a.created_at, a.updated_at
`;

/** Campos editáveis → coluna (texto fixo; nunca chave vinda do cliente). */
const COLUNAS_EDITAVEIS = Object.freeze({
  tipo: 'tipo',
  titulo: 'titulo',
  notas: 'notas',
  agendadaPara: 'agendada_para',
  concluidaEm: 'concluida_em',
});

/**
 * @param {Prisma.TransactionClient} tx
 * @param {string} tenantId
 * @param {string} leadId
 */
async function leadDisponivel(tx, tenantId, leadId) {
  const [lead] = await tx.$queryRaw`
    SELECT id FROM modulo_crm.leads
    WHERE id = ${leadId}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
  `;
  return Boolean(lead);
}

/**
 * @param {Prisma.TransactionClient} tx
 * @param {string} tenantId
 * @param {string} leadId
 * @param {Date} concluidaEm
 */
function registrarInteracao(tx, tenantId, leadId, concluidaEm) {
  return tx.$executeRaw`
    UPDATE modulo_crm.leads
    SET ultima_interacao_em = GREATEST(COALESCE(ultima_interacao_em, ${concluidaEm}), ${concluidaEm})
    WHERE id = ${leadId}::uuid AND tenant_id = ${tenantId}::uuid
  `;
}

/**
 * @param {Prisma.TransactionClient} tx
 * @param {string} tenantId
 * @param {string} atividadeId
 * @returns {Promise<AtividadeLinha | undefined>}
 */
function lerAtividade(tx, tenantId, atividadeId) {
  return tx.$queryRaw`
    SELECT ${COLUNAS}
    FROM modulo_crm.crm_activity a
    LEFT JOIN usuarios u ON u.id = a.autor_id
    WHERE a.id = ${atividadeId}::uuid AND a.tenant_id = ${tenantId}::uuid
  `.then((rows) => rows[FIRST_RESULT_INDEX]);
}

/**
 * Em aberto primeiro (agendada mais próxima antes), depois as concluídas
 * da mais recente pra mais antiga. `undefined` = lead não existe.
 *
 * @param {string} tenantId
 * @param {string} leadId
 * @returns {Promise<AtividadeLinha[] | undefined>}
 */
export function listarAtividadesDoLead(tenantId, leadId) {
  return getTenantClient(tenantId, async (tx) => {
    if (!(await leadDisponivel(tx, tenantId, leadId))) return undefined;
    return tx.$queryRaw`
      SELECT ${COLUNAS}
      FROM modulo_crm.crm_activity a
      LEFT JOIN usuarios u ON u.id = a.autor_id
      WHERE a.tenant_id = ${tenantId}::uuid AND a.lead_id = ${leadId}::uuid
      ORDER BY (a.concluida_em IS NOT NULL), a.agendada_para ASC NULLS LAST,
               a.concluida_em DESC, a.created_at DESC
    `;
  });
}

/**
 * @param {string} tenantId
 * @param {string} leadId
 * @param {string} atividadeId
 * @returns {Promise<AtividadeLinha | undefined>}
 */
export function buscarAtividade(tenantId, leadId, atividadeId) {
  return getTenantClient(tenantId, async (tx) => {
    if (!(await leadDisponivel(tx, tenantId, leadId))) return undefined;
    const atividade = await lerAtividade(tx, tenantId, atividadeId);
    return atividade?.lead_id === leadId ? atividade : undefined;
  });
}

/**
 * @param {string} tenantId
 * @param {string} leadId
 * @param {{ tipo: string, titulo: string, notas?: string | null, agendadaPara?: Date | null, concluidaEm?: Date | null, autorId?: string | null }} dados
 * @returns {Promise<AtividadeLinha | undefined>}
 */
export function criarAtividade(tenantId, leadId, dados) {
  return getTenantClient(tenantId, async (tx) => {
    if (!(await leadDisponivel(tx, tenantId, leadId))) return undefined;
    const [{ id }] = await tx.$queryRaw`
      INSERT INTO modulo_crm.crm_activity (tenant_id, lead_id, tipo, titulo, notas, agendada_para, concluida_em, autor_id)
      VALUES (
        ${tenantId}::uuid, ${leadId}::uuid, ${dados.tipo}, ${dados.titulo}, ${dados.notas ?? null},
        ${dados.agendadaPara ?? null}, ${dados.concluidaEm ?? null}, ${dados.autorId ?? null}::uuid
      )
      RETURNING id
    `;
    if (dados.concluidaEm) await registrarInteracao(tx, tenantId, leadId, dados.concluidaEm);
    return lerAtividade(tx, tenantId, id);
  });
}

/**
 * Edição parcial (chave omitida não muda; `null` limpa). Se a edição
 * conclui a atividade (estava em aberto e passou a ter `concluidaEm`), a
 * interação do lead é registrada. Reabrir não volta a data do lead.
 *
 * @param {string} tenantId
 * @param {string} leadId
 * @param {string} atividadeId
 * @param {Partial<Record<keyof typeof COLUNAS_EDITAVEIS, unknown>>} dados
 * @returns {Promise<AtividadeLinha | undefined>}
 */
export function atualizarAtividade(tenantId, leadId, atividadeId, dados) {
  const atribuicoes = Object.entries(COLUNAS_EDITAVEIS)
    .filter(([chave]) => dados[chave] !== undefined)
    .map(([chave, coluna]) => Prisma.sql`${Prisma.raw(coluna)} = ${dados[chave]}`);
  atribuicoes.push(Prisma.sql`updated_at = now()`);

  return getTenantClient(tenantId, async (tx) => {
    if (!(await leadDisponivel(tx, tenantId, leadId))) return undefined;
    const [antes] = await tx.$queryRaw`
      SELECT concluida_em FROM modulo_crm.crm_activity
      WHERE id = ${atividadeId}::uuid AND tenant_id = ${tenantId}::uuid AND lead_id = ${leadId}::uuid
      FOR UPDATE
    `;
    if (!antes) return undefined;

    await tx.$executeRaw`
      UPDATE modulo_crm.crm_activity
      SET ${Prisma.join(atribuicoes, ', ')}
      WHERE id = ${atividadeId}::uuid AND tenant_id = ${tenantId}::uuid
    `;
    if (!antes.concluida_em && dados.concluidaEm) {
      await registrarInteracao(tx, tenantId, leadId, /** @type {Date} */ (dados.concluidaEm));
    }
    return lerAtividade(tx, tenantId, atividadeId);
  });
}

/**
 * @param {string} tenantId
 * @param {string} leadId
 * @param {string} atividadeId
 * @returns {Promise<{ id: string } | undefined>}
 */
export function excluirAtividade(tenantId, leadId, atividadeId) {
  return getTenantClient(tenantId, async (tx) => {
    if (!(await leadDisponivel(tx, tenantId, leadId))) return undefined;
    const [removida] = await tx.$queryRaw`
      DELETE FROM modulo_crm.crm_activity
      WHERE id = ${atividadeId}::uuid AND tenant_id = ${tenantId}::uuid AND lead_id = ${leadId}::uuid
      RETURNING id
    `;
    return removida;
  });
}
