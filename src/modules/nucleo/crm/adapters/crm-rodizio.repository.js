import { getTenantClient } from '#core/db/tenantClient.js';

/**
 * ADAPTER: ponteiro do rodízio (M12, `crm_rodizio_ponteiro`). Uma linha
 * por (tenant, chave) com quem recebeu por último; a escolha trava a linha
 * (`FOR UPDATE`), então criações simultâneas saem em fila e ninguém recebe
 * duas vezes seguidas nem é pulado. No banco e não no Redis de propósito:
 * a distribuição funciona sem Redis.
 */

/**
 * Próximo da vez entre `candidatos`: o primeiro com id maior que o último
 * a receber, voltando ao início no fim da lista. Comparar pelo id (e não
 * por posição) mantém a ordem quando alguém entra ou sai do grupo.
 *
 * @param {string[]} candidatos  ids ordenados, sem repetição
 * @param {string | null} ultimo
 * @returns {string}
 */
export function proximoDaVez(candidatos, ultimo) {
  if (!ultimo) return candidatos[0];
  return candidatos.find((id) => id > ultimo) ?? candidatos[0];
}

/**
 * @param {string} tenantId
 * @param {string} chave  id do grupo ou `CHAVE_RODIZIO_GERAL`
 * @param {string[]} candidatos  ao menos um; ordenados por id
 * @returns {Promise<string>} o usuário escolhido
 */
export function avancarRodizio(tenantId, chave, candidatos) {
  return getTenantClient(tenantId, async (tx) => {
    await tx.$executeRaw`
      INSERT INTO modulo_crm.crm_rodizio_ponteiro (tenant_id, chave)
      VALUES (${tenantId}::uuid, ${chave})
      ON CONFLICT (tenant_id, chave) DO NOTHING
    `;
    const [{ ultimo_usuario_id: ultimo }] = await tx.$queryRaw`
      SELECT ultimo_usuario_id::text FROM modulo_crm.crm_rodizio_ponteiro
      WHERE tenant_id = ${tenantId}::uuid AND chave = ${chave}
      FOR UPDATE
    `;
    const escolhido = proximoDaVez(candidatos, ultimo);
    await tx.$executeRaw`
      UPDATE modulo_crm.crm_rodizio_ponteiro SET ultimo_usuario_id = ${escolhido}::uuid
      WHERE tenant_id = ${tenantId}::uuid AND chave = ${chave}
    `;
    return escolhido;
  });
}
