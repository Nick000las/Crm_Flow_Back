import { UnrecoverableError } from 'bullmq';
import { featureAtiva } from '#core/tenant/feature-flags.js';
import { atualizarLead, buscarLeadPorId } from '../adapters/leads.repository.js';
import {
  ACOES_DUPLICIDADE,
  CAMADA,
  CAMPOS_DUPLICIDADE,
  CRM_FEATURES,
  ENRIQUECIMENTO_CNPJ,
  MODOS_CNPJ,
  STATUS_CNPJ,
  TIPOS_CAMPO,
  TIPOS_EVENTO_LEAD,
} from '../constants.js';
import { consultarCnpj, obterConfigCnpj, sugestaoParaLead } from './cnpj.service.js';
import { encontrarDuplicados } from './duplicidade.service.js';
import { customFieldsParaArmazenamento, obterSchemaCampos } from './field-schema.service.js';
import { diffDoLead } from './historico.service.js';
import { leadParaApi } from './leads.service.js';
import { chaveDocumento, valorAusente } from './tipos-campo.service.js';

/**
 * SERVICE: job do enriquecimento automático por CNPJ (M11b), rodado pelo
 * worker (`src/workers/crm.worker.js`, fila `crm-cnpj`, com rate limit).
 *
 * Tudo é conferido de novo na hora do job (a fila pode ter atrasado):
 * flag, config ainda no modo automático, lead existe e com o mesmo CNPJ.
 * Grava como o sistema (autor nulo), evento `enriquecido`. Sem
 * `sobrescrever`, só preenche o que está vazio.
 *
 * Erro transitório do provedor sobe pra fila tentar de novo; qualquer
 * outro vira `UnrecoverableError` (falha uma vez só, sem repetir à toa).
 * Nos dois casos o lead fica como estava. E-mail/telefone que bateriam
 * num bloqueio de duplicidade (M7) ficam de fora.
 *
 * @param {{ tenantId: string, leadId: string, cnpj: string }} job
 * @returns {Promise<{ resultado: string, campos?: string[] }>}
 */
export async function processarEnriquecimento({ tenantId, leadId, cnpj }) {
  if (!(await featureAtiva(tenantId, CRM_FEATURES.CNPJ))) return { resultado: 'flag_desligada' };
  const config = await obterConfigCnpj(tenantId);
  if (!config.ativo || config.modo !== MODOS_CNPJ.AUTOMATICO) return { resultado: 'modo_manual' };

  const atual = await buscarLeadPorId(tenantId, leadId);
  if (!atual || chaveDocumento(atual.cnpj) !== cnpj) return { resultado: 'lead_mudou' };

  let consulta;
  try {
    consulta = await consultarCnpj(tenantId, cnpj);
  } catch (erro) {
    if (/** @type {{ transitorio?: boolean }} */ (erro)?.transitorio) throw erro;
    throw new UnrecoverableError(erro instanceof Error ? erro.message : String(erro));
  }
  if (consulta.status !== STATUS_CNPJ.OK) return { resultado: consulta.status };

  const schema = await obterSchemaCampos(tenantId);
  const sugestao = sugestaoParaLead(consulta.dados, config.mapeamento, schema.campos);
  const semSobrescrever = filtrarSobrescrita(sugestao, leadParaApi(atual, schema), config.sobrescrever);
  const aplicar = await semDuplicidadeBloqueada(tenantId, leadId, semSobrescrever);
  if (aplicar.length === 0) return { resultado: 'nada_a_preencher' };

  const ignorar = ['ultimaInteracaoEm'];
  await atualizarLead(tenantId, leadId, dadosParaGravar(aplicar, schema.definicoes), {
    autorId: null,
    tipo: TIPOS_EVENTO_LEAD.ENRIQUECIDO,
    detalhes: { cnpj, provedor: consulta.provedor },
    montarDiff: (antes, depois) => diffDoLead(antes, depois, { ignorar }),
  });
  return { resultado: 'enriquecido', campos: aplicar.map((item) => item.chave) };
}

/**
 * Opções do `Worker` da fila `crm-cnpj`: um job por vez e o rate limit do
 * provedor (o limiter do BullMQ vale pra fila inteira, entre processos).
 *
 * @param {{ CNPJ_LIMITE_MAX?: number, CNPJ_LIMITE_JANELA_MS?: number }} config  env já validado
 */
export function opcoesDoWorkerCnpj(config) {
  return {
    concurrency: 1,
    limiter: {
      max: config.CNPJ_LIMITE_MAX ?? ENRIQUECIMENTO_CNPJ.LIMITE_MAX,
      duration: config.CNPJ_LIMITE_JANELA_MS ?? ENRIQUECIMENTO_CNPJ.LIMITE_JANELA_MS,
    },
  };
}

/**
 * Sem `sobrescrever`, só os campos vazios no lead. Função pura.
 *
 * @param {import('./cnpj.service.js').Sugestao[]} sugestao
 * @param {Record<string, any>} lead  formato da API (`leadParaApi`)
 * @param {boolean} sobrescrever
 */
export function filtrarSobrescrita(sugestao, lead, sobrescrever) {
  if (sobrescrever) return sugestao;
  return sugestao.filter((item) =>
    valorAusente(item.camada === CAMADA.CAMADA_3 ? lead.customFields?.[item.chave] : lead[item.chave]),
  );
}

/** Chave da API (`email`, `telefone`…) → campo da regra de duplicidade (M7). */
const CAMPO_DE_DUPLICIDADE = new Map(Object.entries(CAMPOS_DUPLICIDADE).map(([campo, { chave }]) => [chave, campo]));

/**
 * Tira os campos nativos que caem num bloqueio de duplicidade (M7) — uma
 * consulta por campo, pra saber qual bloqueia. `warn` passa: o sistema não
 * tem como confirmar o aviso (mesmo critério do import com `criar`).
 *
 * @param {string} tenantId
 * @param {string} leadId
 * @param {import('./cnpj.service.js').Sugestao[]} itens
 */
async function semDuplicidadeBloqueada(tenantId, leadId, itens) {
  const vigiados = itens.filter((item) => item.camada !== CAMADA.CAMADA_3 && CAMPO_DE_DUPLICIDADE.has(item.chave));
  if (vigiados.length === 0 || !(await featureAtiva(tenantId, CRM_FEATURES.DUPLICIDADE))) return itens;

  const bloqueados = new Set();
  for (const item of vigiados) {
    const candidatos = await encontrarDuplicados(tenantId, { [item.chave]: item.valor }, { ignorarId: leadId });
    if (candidatos.some((candidato) => candidato.acao === ACOES_DUPLICIDADE.BLOQUEAR)) bloqueados.add(item.chave);
  }
  return itens.filter((item) => item.camada === CAMADA.CAMADA_3 || !bloqueados.has(item.chave));
}

/**
 * Nativo de data vai como `Date`: o Postgres não aceita texto num parâmetro
 * de coluna `TIMESTAMP` (o import faz o mesmo, `reviverDatas`). No
 * personalizado fica a string ISO do JSONB.
 *
 * @param {import('./cnpj.service.js').Sugestao[]} itens
 * @param {import('../types/index.js').FieldDefinition[]} definicoes
 */
export function dadosParaGravar(itens, definicoes) {
  /** @type {Record<string, unknown>} */
  const dados = {};
  /** @type {Record<string, unknown>} */
  const personalizados = {};
  for (const item of itens) {
    if (item.camada === CAMADA.CAMADA_3) personalizados[item.chave] = item.valor;
    else dados[item.chave] = item.tipo === TIPOS_CAMPO.DATA ? new Date(String(item.valor)) : item.valor;
  }
  if (Object.keys(personalizados).length > 0) dados.customFields = customFieldsParaArmazenamento(definicoes, personalizados);
  return dados;
}
