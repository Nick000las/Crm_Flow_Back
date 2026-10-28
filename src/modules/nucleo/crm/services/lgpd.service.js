import { erroDeConflito, erroNaoEncontrado } from '#core/errors/app-error.js';
import { featureAtiva, garantirFeature } from '#core/tenant/feature-flags.js';
import {
  anonimizarLead,
  buscarConfigLgpd,
  buscarSituacaoLgpd,
  salvarConfigLgpd as salvarConfigLgpdRepository,
} from '../adapters/crm-lgpd.repository.js';
import {
  ANONIMIZACAO,
  CAMPOS_LGPD,
  CONTEXTOS_VISIBILIDADE,
  CRM_FEATURES,
  OPCOES_BASE_LEGAL,
  OPCOES_ORIGEM_REGISTRO,
} from '../constants.js';
import { atualizarConfiguracaoCampo, listarConfiguracaoCampos } from './configuracoes-campos.service.js';
import { obterSchemaCampos } from './field-schema.service.js';
import { recalcularScoreDosLeads } from './score.service.js';

/**
 * SERVICE: base legal LGPD (M15). Quatro campos do sistema (Camada 2):
 * Base legal (escolhida), Data da base legal, Origem do registro e Opt-out
 * de marketing — os três últimos carimbados aqui, nunca pelo payload.
 *
 * Os carimbos (origem, datas) valem sempre: é registro de onde o dado veio.
 * A flag `crm.lgpd` liga a configuração (base padrão, obrigatoriedade), a
 * base do lote no import e a anonimização.
 *
 * A obrigatoriedade é a do próprio campo "Base legal" (`crm_field`), que o
 * formulário e o import já exigem — a configuração daqui só a liga/desliga.
 */

/** Onde os campos LGPD aparecem ao salvar a configuração. */
const CONTEXTOS_DE_LEITURA = [CONTEXTOS_VISIBILIDADE.FICHA, CONTEXTOS_VISIBILIDADE.TABELA, CONTEXTOS_VISIBILIDADE.FILTRO];

/**
 * Lead novo (formulário/API ou import): base padrão (só no cadastro manual,
 * com a flag), data da base legal, origem e opt-out carimbados.
 *
 * @template {Record<string, unknown>} T
 * @param {T} input  payload já validado (`optOutMarketing` é sim/não)
 * @param {string} origem  `ORIGENS_REGISTRO`
 * @param {{ basePadrao?: string | null, agora?: Date }} [opcoes]  `basePadrao` já resolvida (import: a do lote)
 */
export function comDadosLgpdNaCriacao(input, origem, { basePadrao = null, agora = new Date() } = {}) {
  const { [CAMPOS_LGPD.OPT_OUT]: optOut, ...resto } = input;
  const baseLegal = resto[CAMPOS_LGPD.BASE_LEGAL] ?? basePadrao ?? undefined;
  return {
    ...resto,
    [CAMPOS_LGPD.BASE_LEGAL]: baseLegal,
    [CAMPOS_LGPD.BASE_LEGAL_EM]: baseLegal ? agora : undefined,
    [CAMPOS_LGPD.ORIGEM_REGISTRO]: origem,
    [CAMPOS_LGPD.OPT_OUT_EM]: optOut ? agora : undefined,
  };
}

/**
 * Base padrão do cadastro manual: só com a flag e se o tenant configurou.
 *
 * @param {string} tenantId
 * @returns {Promise<string | null>}
 */
export async function basePadraoDoTenant(tenantId) {
  if (!(await featureAtiva(tenantId, CRM_FEATURES.LGPD))) return null;
  return (await buscarConfigLgpd(tenantId))?.base_legal_padrao ?? null;
}

/**
 * Base do lote no import (passo extra do wizard): exige a flag.
 *
 * @param {string} tenantId
 * @param {string | undefined} baseLote
 */
export async function garantirBaseDoLote(tenantId, baseLote) {
  if (baseLote !== undefined) await garantirFeature(tenantId, CRM_FEATURES.LGPD);
}

/**
 * GET /crm/configuracoes/lgpd.
 *
 * @param {string} tenantId
 */
export async function obterConfigLgpd(tenantId) {
  const [config, campos] = await Promise.all([buscarConfigLgpd(tenantId), listarConfiguracaoCampos(tenantId)]);
  const baseLegal = campos.find((campo) => campo.chave === CAMPOS_LGPD.BASE_LEGAL);
  return {
    basePadrao: config?.base_legal_padrao ?? null,
    obrigatoria: baseLegal?.obrigatorio ?? false,
    basesLegais: OPCOES_BASE_LEGAL,
    origensRegistro: OPCOES_ORIGEM_REGISTRO,
  };
}

/**
 * PUT /crm/configuracoes/lgpd. Quem configura quer ver os campos: os quatro
 * são ligados no detalhe, na tabela e no filtro; a Base legal também no
 * formulário de criação (é onde se escolhe, e obrigatório precisa estar lá).
 * O DONO ainda pode esconder depois, em Configurações → Campos.
 *
 * @param {string} tenantId
 * @param {{ basePadrao: string | null, obrigatoria: boolean }} config
 */
export async function salvarConfigLgpd(tenantId, { basePadrao, obrigatoria }) {
  await salvarConfigLgpdRepository(tenantId, { basePadrao });

  const campos = await listarConfiguracaoCampos(tenantId);
  const chavesLgpd = [CAMPOS_LGPD.BASE_LEGAL, CAMPOS_LGPD.BASE_LEGAL_EM, CAMPOS_LGPD.ORIGEM_REGISTRO, CAMPOS_LGPD.OPT_OUT_EM];
  for (const campo of campos.filter((item) => chavesLgpd.includes(item.chave))) {
    const ehBaseLegal = campo.chave === CAMPOS_LGPD.BASE_LEGAL;
    const contextos = ehBaseLegal ? [...CONTEXTOS_DE_LEITURA, CONTEXTOS_VISIBILIDADE.CRIACAO] : CONTEXTOS_DE_LEITURA;
    const faltando = contextos.filter((contexto) => !campo.visibilidade[contexto]);
    const mudaObrigatorio = ehBaseLegal && campo.obrigatorio !== obrigatoria;
    if (faltando.length === 0 && !mudaObrigatorio) continue;
    await atualizarConfiguracaoCampo(tenantId, campo.id, {
      ...(faltando.length > 0 ? { visibilidade: Object.fromEntries(faltando.map((contexto) => [contexto, true])) } : {}),
      ...(mudaObrigatorio ? { obrigatorio: obrigatoria } : {}),
    });
  }
  return obterConfigLgpd(tenantId);
}

/**
 * Personalizados que sobrevivem à anonimização: os ativos de tipo que não
 * identifica a pessoa (número, data, seleção...). Os outros — e os de campo
 * excluído, cujo tipo já não se sabe — são apagados.
 *
 * @param {import('../types/index.js').FieldDefinition[]} definicoes
 * @returns {string[]} ids dos campos
 */
export function personalizadosMantidos(definicoes) {
  return definicoes
    .filter((definicao) => ANONIMIZACAO.TIPOS_PERSONALIZADO_MANTIDOS.includes(definicao.tipo))
    .map((definicao) => definicao.id);
}

/**
 * POST /crm/leads/:id/anonimizar (pedido do titular). Irreversível: o lead
 * fica pras estatísticas, sem PII, e travado pra edição (ver
 * `crm-lgpd.repository.js#anonimizarLead`). Vale também pra lead arquivado
 * ou na lixeira, e leva junto os que foram mesclados nele.
 *
 * @param {string} tenantId
 * @param {string} leadId
 * @param {string | null} usuarioId
 */
export async function anonimizarLeadDoTitular(tenantId, leadId, usuarioId) {
  const situacao = await buscarSituacaoLgpd(tenantId, leadId);
  if (!situacao) throw erroNaoEncontrado('Lead não encontrado');
  if (situacao.anonimizado) throw jaAnonimizado();

  const { definicoes } = await obterSchemaCampos(tenantId);
  const resumo = await anonimizarLead(tenantId, leadId, { autorId: usuarioId, mantidos: personalizadosMantidos(definicoes) });
  // Outra requisição anonimizou entre a checagem e a transação.
  if (!resumo) throw jaAnonimizado();
  // O score pode depender de um campo apagado.
  await recalcularScoreDosLeads(tenantId, [leadId]);
  return { leadId, ...resumo };
}

/**
 * A escrita no lead não achou linha: se é porque ele foi anonimizado (o
 * repository trava a edição), 409 com a mensagem pra tela; senão, o 404 de quem chamou.
 *
 * @param {string} tenantId
 * @param {string} leadId
 * @param {Error} naoEncontrado
 */
export async function erroDoLeadNaoEditado(tenantId, leadId, naoEncontrado) {
  const situacao = await buscarSituacaoLgpd(tenantId, leadId);
  return situacao?.anonimizado ? leadAnonimizadoNaoEditavel() : naoEncontrado;
}

export function leadAnonimizadoNaoEditavel() {
  return erroDeConflito('lead', 'Este lead foi anonimizado (pedido do titular) e não pode mais ser alterado');
}

function jaAnonimizado() {
  return erroDeConflito('lead', 'Este lead já foi anonimizado');
}
