import { erroDeConflito, erroDeValidacao, erroNaoEncontrado } from '#core/errors/app-error.js';
import { criarNotificacoes } from '#core/notificacoes/notificacoes.js';
import { featureAtiva } from '#core/tenant/feature-flags.js';
import { ROLES } from '#shared/constants/index.js';
import {
  atualizarGrupo,
  buscarConfigDistribuicao,
  excluirGrupo as excluirGrupoRepository,
  inserirGrupo,
  listarGrupos,
  listarRegrasDistribuicao,
  salvarConfigERegras,
} from '../adapters/crm-distribuicao.repository.js';
import { avancarRodizio } from '../adapters/crm-rodizio.repository.js';
import { listarUsuariosAtivosComPapel } from '../adapters/usuarios.repository.js';
import {
  CHAVE_RODIZIO_GERAL,
  CONFIG_DISTRIBUICAO_PADRAO,
  CRM_FEATURES,
  FALLBACK_DISTRIBUICAO,
  LIMITES_DISTRIBUICAO,
  NOTIFICACOES_DISTRIBUICAO,
  ORIGEM_DISTRIBUICAO,
  TIPOS_DESTINO,
} from '../constants.js';
import { candidatosAtivos, escolherDestino } from './distribuicao-motor.service.js';
import { obterSchemaCampos } from './field-schema.service.js';
import { montarCondicoes } from './lead-filter.service.js';

/**
 * SERVICE: distribuição automática de leads (M12). Lead NOVO sem
 * responsável no payload (form/API) ou na linha da planilha recebe o
 * responsável pela primeira regra que casar, ou pelo fallback. Só com a
 * flag `crm.distribuicao` E a config `ativo` — fora isso, o criador
 * continua sendo o responsável, como antes.
 *
 * @typedef {import('../adapters/crm-distribuicao.repository.js').RegraDistribuicaoLinha} RegraDistribuicaoLinha
 * @typedef {{
 *   fallback: string,
 *   regras: RegraDistribuicaoLinha[],
 *   campos: import('./distribuicao-motor.service.js').CampoDoSchema[],
 *   ativos: Set<string>,
 *   rodizioGeral: string[],
 *   membrosPorGrupo: Map<string, string[]>,
 * }} ContextoDistribuicao
 * @typedef {{ usuarioId: string | null, regraId: string | null, regraNome: string | null, origem: string }} Atribuicao
 * @typedef {{ campoId: string, operador: string, valor?: unknown }} Condicao
 * @typedef {{
 *   id?: string, nome: string, ativo: boolean, condicoes: Condicao[],
 *   destino: { tipo: string, id: string },
 * }} RegraDaApi
 */

/** Quem entra no rodízio geral (o MASTER é da plataforma, não vende). */
const PAPEIS_RODIZIO_GERAL = new Set([ROLES.DONO, ROLES.OPERADOR]);
const OPERADORES_SEM_VALOR = new Set(['vazio', 'nao_vazio']);

// ---------------------------------------------------------------------------
// Distribuir
// ---------------------------------------------------------------------------

/**
 * Tudo que a escolha precisa, carregado uma vez (por request, ou por job
 * de import). `null` = distribuição desligada.
 *
 * @param {string} tenantId
 * @returns {Promise<ContextoDistribuicao | null>}
 */
export async function carregarContextoDistribuicao(tenantId) {
  if (!(await featureAtiva(tenantId, CRM_FEATURES.DISTRIBUICAO))) return null;
  const config = (await buscarConfigDistribuicao(tenantId)) ?? CONFIG_DISTRIBUICAO_PADRAO;
  if (!config.ativo) return null;

  const [regras, grupos, usuarios, { campos }] = await Promise.all([
    listarRegrasDistribuicao(tenantId),
    listarGrupos(tenantId),
    listarUsuariosAtivosComPapel(tenantId),
    obterSchemaCampos(tenantId),
  ]);
  const ativos = new Set(usuarios.map((usuario) => usuario.id));
  return {
    fallback: config.fallback,
    regras,
    campos,
    ativos,
    rodizioGeral: candidatosAtivos(
      usuarios.filter((usuario) => PAPEIS_RODIZIO_GERAL.has(usuario.role)).map((usuario) => usuario.id),
      ativos,
    ),
    membrosPorGrupo: new Map(grupos.map((grupo) => [grupo.id, grupo.membros])),
  };
}

/**
 * Responsável de um lead novo. Destino em rodízio avança o ponteiro (no
 * banco, travado) — se a criação falhar depois, aquela vez é perdida.
 *
 * @param {string} tenantId
 * @param {ContextoDistribuicao} contexto
 * @param {Record<string, any>} lead  formato da API (custom fields pela `chave`)
 * @returns {Promise<Atribuicao>}
 */
export async function distribuir(tenantId, contexto, lead) {
  const destino = escolherDestino({ ...contexto, lead });

  if (destino.tipo === 'usuario') {
    return { usuarioId: destino.usuarioId, regraId: destino.regra.id, regraNome: destino.regra.nome, origem: ORIGEM_DISTRIBUICAO.REGRA };
  }
  if (destino.tipo === 'grupo') {
    const usuarioId = await avancarRodizio(tenantId, destino.grupoId, destino.candidatos);
    return { usuarioId, regraId: destino.regra.id, regraNome: destino.regra.nome, origem: ORIGEM_DISTRIBUICAO.REGRA };
  }
  if (contexto.fallback === FALLBACK_DISTRIBUICAO.RODIZIO_GERAL && contexto.rodizioGeral.length > 0) {
    const usuarioId = await avancarRodizio(tenantId, CHAVE_RODIZIO_GERAL, contexto.rodizioGeral);
    return { usuarioId, regraId: null, regraNome: null, origem: ORIGEM_DISTRIBUICAO.RODIZIO_GERAL };
  }
  return { usuarioId: null, regraId: null, regraNome: null, origem: ORIGEM_DISTRIBUICAO.SEM_RESPONSAVEL };
}

/**
 * `detalhes` do evento `criado` (histórico).
 *
 * @param {Atribuicao} atribuicao
 */
export function detalhesDaAtribuicao({ origem, regraId, regraNome }) {
  return { distribuicao: regraId ? { origem, regraId, regraNome } : { origem } };
}

/**
 * "Novo lead para você" — não pra quem criou o lead (ele já sabe). Falha
 * aqui não derruba a criação.
 *
 * @param {string} tenantId
 * @param {{ leadId: string, leadNome: string, atribuicao: Atribuicao, criadorId?: string | null }} dados
 */
export async function notificarAtribuicao(tenantId, { leadId, leadNome, atribuicao, criadorId = null }) {
  const { usuarioId, regraNome } = atribuicao;
  if (!usuarioId || usuarioId === criadorId) return 0;
  const { MODULO, LEAD_ATRIBUIDO, ROTA } = NOTIFICACOES_DISTRIBUICAO;
  try {
    return await criarNotificacoes(tenantId, [
      {
        usuarioId,
        modulo: MODULO,
        tipo: LEAD_ATRIBUIDO,
        titulo: 'Novo lead para você',
        corpo: regraNome ? `${leadNome} (regra "${regraNome}")` : leadNome,
        dados: { rota: ROTA, leadId },
        chaveDedup: `${LEAD_ATRIBUIDO}:${leadId}`,
      },
    ]);
  } catch {
    return 0;
  }
}

/**
 * Import: uma notificação por responsável com o total ("Você recebeu N
 * leads"), não uma por lead. Quem importou não é avisado.
 *
 * @param {string} tenantId
 * @param {{ importJobId: string, totais: Map<string, number>, importadorId?: string | null }} dados
 */
export async function notificarAtribuicoesDoImport(tenantId, { importJobId, totais, importadorId = null }) {
  const { MODULO, LEADS_ATRIBUIDOS, ROTA } = NOTIFICACOES_DISTRIBUICAO;
  const itens = [...totais]
    .filter(([usuarioId, total]) => usuarioId !== importadorId && total > 0)
    .map(([usuarioId, total]) => ({
      usuarioId,
      modulo: MODULO,
      tipo: LEADS_ATRIBUIDOS,
      titulo: `Você recebeu ${total === 1 ? '1 lead' : `${total} leads`} de uma importação`,
      corpo: 'Distribuídos automaticamente pelas regras de distribuição.',
      dados: { rota: ROTA, filtro: { usuarioResponsavelId: usuarioId }, importJobId, total },
      chaveDedup: `${LEADS_ATRIBUIDOS}:${importJobId}`,
    }));
  try {
    return await criarNotificacoes(tenantId, itens);
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

/**
 * GET /crm/configuracoes/distribuicao. Destino de regra na forma da API
 * (`{ tipo, id }`); grupos com os membros (ids).
 *
 * @param {string} tenantId
 */
export async function obterConfigDistribuicao(tenantId) {
  const [gravada, regras, grupos] = await Promise.all([
    buscarConfigDistribuicao(tenantId),
    listarRegrasDistribuicao(tenantId),
    listarGrupos(tenantId),
  ]);
  const { ativo, fallback } = gravada ?? CONFIG_DISTRIBUICAO_PADRAO;
  return {
    ativo,
    fallback,
    configurado: gravada !== undefined,
    regras: regras.map(regraParaApi),
    grupos,
  };
}

/**
 * PUT inteiro: config + lista de regras na ordem de avaliação.
 *
 * @param {string} tenantId
 * @param {{ ativo: boolean, fallback: string, regras: RegraDaApi[] }} input
 */
export async function salvarConfigDistribuicao(tenantId, { ativo, fallback, regras }) {
  if (regras.length > LIMITES_DISTRIBUICAO.REGRAS_POR_TENANT) {
    throw erroDeValidacao('regras', `Use no máximo ${LIMITES_DISTRIBUICAO.REGRAS_POR_TENANT} regras`);
  }
  const [atuais, grupos, usuarios, { campos }] = await Promise.all([
    listarRegrasDistribuicao(tenantId),
    listarGrupos(tenantId),
    listarUsuariosAtivosComPapel(tenantId),
    obterSchemaCampos(tenantId),
  ]);
  const contexto = {
    idsAtuais: new Set(atuais.map((regra) => regra.id)),
    gruposExistentes: new Set(grupos.map((grupo) => grupo.id)),
    ativos: new Set(usuarios.map((usuario) => usuario.id)),
    campoPorId: new Map(campos.filter((campo) => campo.id).map((campo) => [campo.id, campo])),
  };

  const vistos = new Set();
  const paraGravar = regras.map((regra, indice) => {
    if (regra.id) {
      if (vistos.has(regra.id)) throw erroDeValidacao(`regras.${indice}.id`, 'A mesma regra aparece duas vezes');
      vistos.add(regra.id);
    }
    return normalizarRegra(regra, indice, contexto);
  });

  await salvarConfigERegras(tenantId, { ativo, fallback }, paraGravar);
  return obterConfigDistribuicao(tenantId);
}

/**
 * @param {RegraDaApi} regra
 * @param {number} indice
 * @param {{ idsAtuais: Set<string>, gruposExistentes: Set<string>, ativos: Set<string>, campoPorId: Map<string, any> }} contexto
 */
function normalizarRegra({ id, nome, ativo, condicoes, destino }, indice, { idsAtuais, gruposExistentes, ativos, campoPorId }) {
  const caminho = `regras.${indice}`;
  if (id && !idsAtuais.has(id)) throw erroDeValidacao(`${caminho}.id`, 'Regra não encontrada; recarregue a página');
  const nomeLimpo = nome.trim();
  if (!nomeLimpo) throw erroDeValidacao(`${caminho}.nome`, 'Dê um nome à regra');
  if (condicoes.length > LIMITES_DISTRIBUICAO.CONDICOES_POR_REGRA) {
    throw erroDeValidacao(`${caminho}.condicoes`, `Use no máximo ${LIMITES_DISTRIBUICAO.CONDICOES_POR_REGRA} condições`);
  }

  const condicoesLimpas = condicoes.map((condicao, posicao) => {
    const campo = campoPorId.get(condicao.campoId);
    if (!campo) throw erroDeValidacao(`${caminho}.condicoes.${posicao}`, 'Escolha um campo ativo para a condição');
    try {
      // Mesmas regras de operador × tipo e de formato de valor do filtro (como o M8).
      montarCondicoes({ filtros: [{ chave: campo.chave, operador: condicao.operador, valor: condicao.valor }] }, [campo]);
    } catch (erro) {
      throw erroDeValidacao(`${caminho}.condicoes.${posicao}`, erro instanceof Error ? erro.message : 'Condição inválida');
    }
    return OPERADORES_SEM_VALOR.has(condicao.operador)
      ? { campoId: condicao.campoId, operador: condicao.operador }
      : { campoId: condicao.campoId, operador: condicao.operador, valor: condicao.valor };
  });

  if (destino.tipo === TIPOS_DESTINO.USUARIO && !ativos.has(destino.id)) {
    throw erroDeValidacao(`${caminho}.destino`, 'Escolha um usuário ativo desta conta');
  }
  if (destino.tipo === TIPOS_DESTINO.GRUPO && !gruposExistentes.has(destino.id)) {
    throw erroDeValidacao(`${caminho}.destino`, 'Grupo não encontrado');
  }

  return {
    id,
    nome: nomeLimpo,
    ativo,
    condicoes: condicoesLimpas,
    destinoUsuarioId: destino.tipo === TIPOS_DESTINO.USUARIO ? destino.id : null,
    destinoGrupoId: destino.tipo === TIPOS_DESTINO.GRUPO ? destino.id : null,
  };
}

/** @param {RegraDistribuicaoLinha} regra */
function regraParaApi(regra) {
  return {
    id: regra.id,
    nome: regra.nome,
    ativo: regra.ativo,
    condicoes: regra.condicoes,
    destino: regra.destino_usuario_id
      ? { tipo: TIPOS_DESTINO.USUARIO, id: regra.destino_usuario_id }
      : { tipo: TIPOS_DESTINO.GRUPO, id: regra.destino_grupo_id },
  };
}

// ---------------------------------------------------------------------------
// Grupos
// ---------------------------------------------------------------------------

/**
 * @param {string} tenantId
 * @param {{ nome: string, membros: string[] }} input
 */
export async function criarGrupo(tenantId, input) {
  const grupos = await listarGrupos(tenantId);
  if (grupos.length >= LIMITES_DISTRIBUICAO.GRUPOS_POR_TENANT) {
    throw erroDeValidacao('nome', `Use no máximo ${LIMITES_DISTRIBUICAO.GRUPOS_POR_TENANT} grupos`);
  }
  const grupo = await validarGrupo(tenantId, input, grupos);
  const id = await inserirGrupo(tenantId, grupo);
  return grupoGravado(tenantId, id);
}

/**
 * Nome e lista inteira de membros.
 *
 * @param {string} tenantId
 * @param {string} grupoId
 * @param {{ nome: string, membros: string[] }} input
 */
export async function editarGrupo(tenantId, grupoId, input) {
  const grupos = await listarGrupos(tenantId);
  if (!grupos.some((grupo) => grupo.id === grupoId)) throw grupoNaoEncontrado();
  const grupo = await validarGrupo(tenantId, input, grupos.filter((outro) => outro.id !== grupoId));
  await atualizarGrupo(tenantId, grupoId, grupo);
  return grupoGravado(tenantId, grupoId);
}

/**
 * Grupo destino de alguma regra não sai — troque o destino da regra antes.
 *
 * @param {string} tenantId
 * @param {string} grupoId
 */
export async function excluirGrupo(tenantId, grupoId) {
  const [grupos, regras] = await Promise.all([listarGrupos(tenantId), listarRegrasDistribuicao(tenantId)]);
  if (!grupos.some((grupo) => grupo.id === grupoId)) throw grupoNaoEncontrado();
  const emUso = regras.filter((regra) => regra.destino_grupo_id === grupoId);
  if (emUso.length > 0) {
    throw erroDeConflito('id', `O grupo é destino da regra "${emUso[0].nome}"; troque o destino antes de excluir`);
  }
  await excluirGrupoRepository(tenantId, grupoId);
  return { removido: true };
}

/**
 * @param {string} tenantId
 * @param {{ nome: string, membros: string[] }} input
 * @param {{ nome: string }[]} outros  os demais grupos (nome não repete, sem diferenciar maiúscula)
 */
async function validarGrupo(tenantId, { nome, membros }, outros) {
  const nomeLimpo = nome.trim();
  if (!nomeLimpo) throw erroDeValidacao('nome', 'Dê um nome ao grupo');
  if (outros.some((grupo) => grupo.nome.trim().toLowerCase() === nomeLimpo.toLowerCase())) {
    throw erroDeConflito('nome', 'Já existe um grupo com esse nome');
  }
  const unicos = [...new Set(membros)];
  if (unicos.length > LIMITES_DISTRIBUICAO.MEMBROS_POR_GRUPO) {
    throw erroDeValidacao('membros', `Use no máximo ${LIMITES_DISTRIBUICAO.MEMBROS_POR_GRUPO} membros`);
  }
  const ativos = new Set((await listarUsuariosAtivosComPapel(tenantId)).map((usuario) => usuario.id));
  if (unicos.some((id) => !ativos.has(id))) {
    throw erroDeValidacao('membros', 'Escolha só usuários ativos desta conta');
  }
  return { nome: nomeLimpo, membros: unicos };
}

/**
 * @param {string} tenantId
 * @param {string} grupoId
 */
async function grupoGravado(tenantId, grupoId) {
  return (await listarGrupos(tenantId)).find((grupo) => grupo.id === grupoId);
}

function grupoNaoEncontrado() {
  return erroNaoEncontrado('Grupo não encontrado');
}
