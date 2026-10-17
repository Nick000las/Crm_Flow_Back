import { AppError } from '#core/errors/app-error.js';
import { featureAtiva } from '#core/tenant/feature-flags.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
import {
  buscarCandidatos,
  buscarCandidatosEmLote,
  buscarRegras,
  salvarRegras as salvarRegrasRepository,
} from '../adapters/crm-duplicates.repository.js';
import {
  ACOES_DUPLICIDADE,
  CAMPOS_DUPLICIDADE,
  CRM_FEATURES,
  LIMITE_CANDIDATOS_DUPLICIDADE,
  REGRAS_DUPLICIDADE_PADRAO,
} from '../constants.js';
import { chaveDocumento, chaveEmail, chaveTelefone } from './tipos-campo.service.js';

/**
 * SERVICE: duplicidade de leads (M7). Regra = campo + ação (`warn` avisa e
 * deixa salvar confirmando; `block` impede). A comparação usa as colunas
 * geradas `dedup_*` (migration 0020); os normalizadores (`chaveTelefone`...,
 * em `tipos-campo.service.js`) são o espelho em JS das funções SQL
 * `chave_telefone`/`chave_documento` — os dois lados precisam dar a mesma chave.
 *
 * @typedef {{ campo: string, acao: string, ativo: boolean }} RegraDuplicidade
 * @typedef {{ id: string, nome: string, campos: { campo: string, label: string }[], acao: string }} Duplicado
 */

const CHAVE_DO_CAMPO = Object.freeze({
  email: chaveEmail,
  telefone: chaveTelefone,
  cnpj: chaveDocumento,
  cpf: chaveDocumento,
});

/**
 * Regras do tenant, uma por campo: as gravadas por cima do padrão.
 *
 * @param {string} tenantId
 * @returns {Promise<{ regras: RegraDuplicidade[], configurado: boolean }>}
 */
export async function obterRegras(tenantId) {
  const gravadas = await buscarRegras(tenantId);
  const porCampo = new Map(gravadas.map((regra) => [regra.campo, regra]));
  return {
    regras: REGRAS_DUPLICIDADE_PADRAO.map((padrao) => {
      const { acao, ativo } = porCampo.get(padrao.campo) ?? padrao;
      return { campo: padrao.campo, acao, ativo };
    }),
    configurado: gravadas.length > 0,
  };
}

/**
 * GET /crm/configuracoes/duplicidade — com o label de cada campo.
 *
 * @param {string} tenantId
 */
export async function listarRegras(tenantId) {
  const { regras, configurado } = await obterRegras(tenantId);
  return {
    regras: regras.map((regra) => ({ ...regra, label: CAMPOS_DUPLICIDADE[regra.campo].label })),
    configurado,
  };
}

/**
 * PUT /crm/configuracoes/duplicidade — grava as regras enviadas (campo não
 * enviado segue como está).
 *
 * @param {string} tenantId
 * @param {RegraDuplicidade[]} regras
 */
export async function salvarRegras(tenantId, regras) {
  await salvarRegrasRepository(tenantId, regras);
  return listarRegras(tenantId);
}

/**
 * Leads parecidos com `dados`, pelas regras ativas. Cada um vem com os
 * campos que casaram e a ação mais forte entre eles (`block` vence `warn`).
 *
 * @param {string} tenantId
 * @param {Record<string, unknown>} dados  chaves da API (`email`, `telefone`, `cnpj`, `cpf`)
 * @param {{ ignorarId?: string | null, regras?: RegraDuplicidade[] }} [opcoes]
 *   `regras`: já carregadas (import, por linha) ou o padrão (flag desligada)
 * @returns {Promise<Duplicado[]>}
 */
export async function encontrarDuplicados(tenantId, dados, { ignorarId = null, regras } = {}) {
  const ativas = (regras ?? (await obterRegras(tenantId)).regras).filter((regra) => regra.ativo);
  const acaoPorCampo = new Map(ativas.map((regra) => [regra.campo, regra.acao]));

  const chaves = Object.fromEntries(
    ativas
      .map((regra) => [regra.campo, CHAVE_DO_CAMPO[regra.campo](dados[CAMPOS_DUPLICIDADE[regra.campo].chave])])
      .filter(([, chave]) => chave),
  );
  if (Object.keys(chaves).length === 0) return [];

  const candidatos = await buscarCandidatos(tenantId, chaves, ignorarId);
  return candidatos.map((candidato) => ({
    id: candidato.id,
    nome: candidato.nome,
    campos: candidato.campos.map((campo) => ({ campo, label: CAMPOS_DUPLICIDADE[campo].label })),
    acao: candidato.campos.some((campo) => acaoPorCampo.get(campo) === ACOES_DUPLICIDADE.BLOQUEAR)
      ? ACOES_DUPLICIDADE.BLOQUEAR
      : ACOES_DUPLICIDADE.AVISAR,
  }));
}

/**
 * Regras que o import aplica: as do tenant com `crm.duplicidade`; sem a
 * flag, o padrão (e-mail e telefone, só avisando) — o dedup de antes do M7.
 *
 * @param {string} tenantId
 * @returns {Promise<RegraDuplicidade[]>}
 */
export async function regrasDoImport(tenantId) {
  if (await featureAtiva(tenantId, CRM_FEATURES.DUPLICIDADE)) return (await obterRegras(tenantId)).regras;
  return REGRAS_DUPLICIDADE_PADRAO.map((regra) => ({ ...regra }));
}

/**
 * Import (passo Revisar): duplicados de cada linha contra a base, com uma
 * consulta só pra planilha toda. Linha sem candidato não aparece.
 *
 * @param {string} tenantId
 * @param {{ linha: number, dados: Record<string, unknown> }[]} itens
 * @param {RegraDuplicidade[]} regras
 * @returns {Promise<{ linha: number, acao: string, leads: Duplicado[] }[]>}
 */
export async function duplicadosDasLinhas(tenantId, itens, regras) {
  const ativas = regras.filter((regra) => regra.ativo);
  const acaoPorCampo = new Map(ativas.map((regra) => [regra.campo, regra.acao]));
  const chavesDe = (dados) =>
    ativas
      .map((regra) => [regra.campo, CHAVE_DO_CAMPO[regra.campo](dados[CAMPOS_DUPLICIDADE[regra.campo].chave])])
      .filter(([, chave]) => chave);

  /** @type {Record<string, Set<string>>} */
  const chavesPorCampo = {};
  for (const item of itens) {
    for (const [campo, chave] of chavesDe(item.dados)) (chavesPorCampo[campo] ??= new Set()).add(chave);
  }
  const candidatos = await buscarCandidatosEmLote(
    tenantId,
    Object.fromEntries(Object.entries(chavesPorCampo).map(([campo, chaves]) => [campo, [...chaves]])),
  );

  const resultado = [];
  for (const item of itens) {
    const chaves = chavesDe(item.dados);
    const leads = candidatos
      .map((lead) => ({
        lead,
        campos: chaves.filter(([campo, chave]) => lead[CAMPOS_DUPLICIDADE[campo].coluna] === chave).map(([campo]) => campo),
      }))
      .filter(({ campos }) => campos.length > 0)
      .slice(0, LIMITE_CANDIDATOS_DUPLICIDADE)
      .map(({ lead, campos }) => ({
        id: lead.id,
        nome: lead.nome,
        campos: campos.map((campo) => ({ campo, label: CAMPOS_DUPLICIDADE[campo].label })),
        acao: campos.some((campo) => acaoPorCampo.get(campo) === ACOES_DUPLICIDADE.BLOQUEAR)
          ? ACOES_DUPLICIDADE.BLOQUEAR
          : ACOES_DUPLICIDADE.AVISAR,
      }));
    if (leads.length === 0) continue;
    const bloqueia = leads.some((lead) => lead.acao === ACOES_DUPLICIDADE.BLOQUEAR);
    resultado.push({ linha: item.linha, acao: bloqueia ? ACOES_DUPLICIDADE.BLOQUEAR : ACOES_DUPLICIDADE.AVISAR, leads });
  }
  return resultado;
}

/**
 * Formulário e API: `block` → 409 `DUPLICATE_BLOCKED`; só `warn` → 409
 * `DUPLICATE_WARNING`, a não ser que venha `ignorarDuplicados` (o usuário
 * viu o aviso e confirmou). Os candidatos vão em `details.duplicados`.
 *
 * @param {string} tenantId
 * @param {Record<string, unknown>} dados
 * @param {{ ignorarId?: string | null, ignorarDuplicados?: boolean }} [opcoes]
 */
export async function garantirSemDuplicados(tenantId, dados, { ignorarId = null, ignorarDuplicados = false } = {}) {
  const duplicados = await encontrarDuplicados(tenantId, dados, { ignorarId });
  if (duplicados.length === 0) return;

  if (duplicados.some((duplicado) => duplicado.acao === ACOES_DUPLICIDADE.BLOQUEAR)) {
    throw new AppError({
      statusCode: HTTP_STATUS.CONFLICT,
      code: ERROR_CODES.DUPLICATE_BLOCKED,
      message: 'Já existe um lead com estes dados',
      details: { duplicados },
    });
  }
  if (!ignorarDuplicados) {
    throw new AppError({
      statusCode: HTTP_STATUS.CONFLICT,
      code: ERROR_CODES.DUPLICATE_WARNING,
      message: 'Encontramos leads parecidos. Confirme para salvar mesmo assim.',
      details: { duplicados },
    });
  }
}

/**
 * Só as chaves de duplicidade que o payload de edição MUDA em relação ao
 * lead atual — editar outro campo de um lead que já tinha um parecido não
 * dispara aviso de novo.
 *
 * @param {Record<string, unknown>} input
 * @param {Record<string, unknown>} atual  linha do lead (colunas)
 * @returns {Record<string, unknown>}
 */
export function camposDeDuplicidadeAlterados(input, atual) {
  const alterados = {};
  for (const [campo, { chave }] of Object.entries(CAMPOS_DUPLICIDADE)) {
    if (input[chave] === undefined || input[chave] === null) continue;
    const normalizar = CHAVE_DO_CAMPO[campo];
    if (normalizar(input[chave]) !== normalizar(atual[chave])) alterados[chave] = input[chave];
  }
  return alterados;
}
