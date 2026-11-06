import { featureAtiva } from '#core/tenant/feature-flags.js';
import { CRM_FEATURES } from '../constants.js';
import { customFieldsParaApi } from './field-schema.service.js';

/**
 * SERVICE: base comum das regras (M8) entre lead e oportunidade. Fica fora de
 * `leads.service.js` para o service de oportunidade usar sem dependência
 * circular: na F4, o lead passa a escrever pela oportunidade.
 */

/**
 * Regras ativas do M8 — vazio com a flag `crm.regras` desligada.
 *
 * @param {string} tenantId
 * @param {import('./field-schema.service.js').SchemaCampos} schema
 */
export async function regrasAplicaveis(tenantId, schema) {
  if (!(await featureAtiva(tenantId, CRM_FEATURES.REGRAS))) return [];
  return (schema.regras ?? []).filter((regra) => regra.ativo);
}

/**
 * Linha do lead (colunas, `custom_fields` por id) → formato da API, só com
 * os campos do schema — base da edição "atual + payload".
 *
 * @param {Record<string, any>} linha
 * @param {import('./field-schema.service.js').SchemaCampos} schema
 */
export function leadParaApi(linha, { campos, definicoes }) {
  const lead = Object.fromEntries(
    campos
      .filter((campo) => campo.coluna)
      .map((campo) => [campo.chave, linha[campo.coluna] ?? null]),
  );
  lead.customFields = customFieldsParaApi(definicoes, linha.custom_fields ?? {});
  return lead;
}
