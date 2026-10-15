import { listarUsuariosAtivosDoTenant } from '../adapters/usuarios.repository.js';

/**
 * SERVICE: usuários do tenant como o CRM os enxerga — só quem pode ser
 * responsável por um lead (ativo, deste tenant).
 *
 * @param {string} tenantId
 * @returns {Promise<{ id: string, nome: string }[]>}
 */
export function listarResponsaveisPossiveis(tenantId) {
  return listarUsuariosAtivosDoTenant(tenantId);
}
