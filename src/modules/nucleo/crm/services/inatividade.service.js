import { erroDeValidacao } from '#core/errors/app-error.js';
import { criarNotificacoes } from '#core/notificacoes/notificacoes.js';
import { featureAtiva } from '#core/tenant/feature-flags.js';
import { listarTenantsAtivosDoModulo } from '#core/tenant/module-access.js';
import { FUSO_HORARIO_PADRAO } from '#shared/constants/index.js';
import {
  buscarDiasPorStatus,
  contarEsfriandoPorResponsavel,
  definirDiasPorStatus,
} from '../adapters/crm-inatividade.repository.js';
import { agendarNotificacaoEsfriando } from '../adapters/manutencao-queue.repository.js';
import { listarDonosAtivosDoTenant } from '../adapters/usuarios.repository.js';
import { CATEGORIAS_STATUS, CRM_FEATURES, MODULO_CRM, NOTIFICACAO_ESFRIANDO } from '../constants.js';

/**
 * SERVICE: lead esfriando (M9) — a configuração dos dias por status e o
 * resumo diário no sino. O cálculo em si é a expressão SQL de
 * `crm-inatividade.repository.js` (leitura do lead, filtro e este job).
 *
 * @typedef {import('../adapters/crm-inatividade.repository.js').DiasDoStatus} DiasDoStatus
 * @typedef {import('#core/notificacoes/notificacoes.js').NovaNotificacao} NovaNotificacao
 */

/**
 * GET /crm/configuracoes/inatividade — todos os status, com os dias
 * (`null` = desligado). Só os de categoria `aberto` são configuráveis.
 *
 * @param {string} tenantId
 * @returns {Promise<DiasDoStatus[]>}
 */
export function listarInatividade(tenantId) {
  return buscarDiasPorStatus(tenantId);
}

/**
 * PUT /crm/configuracoes/inatividade — `{ status: { <key>: dias | null } }`.
 * Status fora do mapa não mudam. Ganho/perdido não esfriam (lead fechado).
 *
 * @param {string} tenantId
 * @param {{ status: Record<string, number | null> }} input
 * @returns {Promise<DiasDoStatus[]>}
 */
export async function salvarInatividade(tenantId, { status }) {
  const porKey = new Map((await buscarDiasPorStatus(tenantId)).map((opcao) => [opcao.key, opcao]));

  for (const [key, dias] of Object.entries(status)) {
    const opcao = porKey.get(key);
    if (!opcao) {
      throw erroDeValidacao(`status.${key}`, `Status "${key}" não existe`);
    }
    if (dias !== null && opcao.category !== CATEGORIAS_STATUS.ABERTO) {
      throw erroDeValidacao(
        `status.${key}`,
        `"${opcao.label}" é um status fechado (${opcao.category}) e não esfria`,
      );
    }
  }

  await definirDiasPorStatus(tenantId, status);
  return buscarDiasPorStatus(tenantId);
}

/**
 * Data (`AAAA-MM-DD`) e hora (0–23) locais de um instante num fuso. Fuso
 * inválido cai no padrão — o job não para por um tenant mal configurado.
 *
 * @param {Date} agora
 * @param {string} fuso
 * @returns {{ data: string, hora: number }}
 */
export function dataEHoraLocal(agora, fuso) {
  /** @param {string} timeZone */
  const formatoNo = (timeZone) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    });
  let formato;
  try {
    formato = formatoNo(fuso);
  } catch {
    formato = formatoNo(FUSO_HORARIO_PADRAO);
  }
  const partes = Object.fromEntries(formato.formatToParts(agora).map((parte) => [parte.type, parte.value]));
  return { data: `${partes.year}-${partes.month}-${partes.day}`, hora: Number(partes.hour) };
}

/** @param {number} total */
function leadsNoPlural(total) {
  return total === 1 ? '1 lead' : `${total} leads`;
}

/**
 * As notificações do dia de um tenant (puro): um resumo por responsável
 * e, dos leads sem responsável (ou com o responsável desativado), um
 * resumo pra cada DONO ativo.
 *
 * @param {{ usuario_id: string | null, total: number }[]} contagens
 * @param {string[]} donos
 * @param {string} data  data local do tenant (entra na chave de dedup)
 * @returns {NovaNotificacao[]}
 */
export function montarNotificacoesDoDia(contagens, donos, data) {
  const { MODULO, TIPO, TIPO_SEM_RESPONSAVEL, ROTA } = NOTIFICACAO_ESFRIANDO;
  const itens = [];

  for (const { usuario_id: usuarioId, total } of contagens) {
    if (!usuarioId || total <= 0) continue;
    itens.push({
      usuarioId,
      modulo: MODULO,
      tipo: TIPO,
      titulo: `Você tem ${leadsNoPlural(total)} esfriando`,
      corpo: 'Leads sem interação há mais tempo que o limite do status.',
      dados: { rota: ROTA, filtro: { esfriando: true, usuarioResponsavelId: usuarioId }, total },
      chaveDedup: `${TIPO}:${data}`,
    });
  }

  const semResponsavel = contagens.find((contagem) => !contagem.usuario_id)?.total ?? 0;
  if (semResponsavel > 0) {
    for (const usuarioId of donos) {
      itens.push({
        usuarioId,
        modulo: MODULO,
        tipo: TIPO_SEM_RESPONSAVEL,
        titulo: `${leadsNoPlural(semResponsavel)} sem responsável esfriando`,
        corpo: 'Defina um responsável para que alguém acompanhe esses leads.',
        dados: { rota: ROTA, filtro: { esfriando: true }, total: semResponsavel },
        chaveDedup: `${TIPO_SEM_RESPONSAVEL}:${data}`,
      });
    }
  }
  return itens;
}

/**
 * Job de hora em hora (`crm-manutencao`): em cada tenant com o CRM e a
 * flag ligados, a partir das 8h locais, gera o resumo do dia. Rodar de
 * novo no mesmo dia não duplica (dedup pela data local); falha num
 * tenant entra no relatório e não para os outros.
 *
 * @param {Date} [agora]
 * @returns {Promise<{ tenants: number, notificacoes: number, falhas: { tenantId: string, erro: string }[] }>}
 */
export async function notificarLeadsEsfriando(agora = new Date()) {
  const tenants = await listarTenantsAtivosDoModulo(MODULO_CRM);
  const relatorio = { tenants: tenants.length, notificacoes: 0, falhas: [] };

  for (const tenant of tenants) {
    try {
      relatorio.notificacoes += await notificarEsfriandoNoTenant(tenant, agora);
    } catch (erro) {
      relatorio.falhas.push({ tenantId: tenant.tenantId, erro: erro instanceof Error ? erro.message : String(erro) });
    }
  }
  return relatorio;
}

/**
 * Um tenant do job: nada antes das 8h locais, com a flag desligada ou sem
 * lead esfriando.
 *
 * @param {{ tenantId: string, fusoHorario: string }} tenant
 * @param {Date} agora
 * @returns {Promise<number>} notificações novas (as repetidas do dia não contam)
 */
export async function notificarEsfriandoNoTenant({ tenantId, fusoHorario }, agora) {
  const { data, hora } = dataEHoraLocal(agora, fusoHorario);
  if (hora < NOTIFICACAO_ESFRIANDO.HORA_LOCAL) return 0;
  if (!(await featureAtiva(tenantId, CRM_FEATURES.INATIVIDADE))) return 0;

  const contagens = await contarEsfriandoPorResponsavel(tenantId, agora);
  if (contagens.length === 0) return 0;
  const donos = contagens.some((contagem) => !contagem.usuario_id) ? await listarDonosAtivosDoTenant(tenantId) : [];

  return criarNotificacoes(tenantId, montarNotificacoesDoDia(contagens, donos, data));
}

/**
 * Chamado pelo worker ao subir: garante o agendamento de hora em hora.
 *
 * @param {string} redisUrl
 */
export function agendarResumoDeEsfriando(redisUrl) {
  return agendarNotificacaoEsfriando(redisUrl);
}
