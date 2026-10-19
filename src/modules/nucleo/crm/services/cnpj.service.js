import { AppError, erroDeValidacao } from '#core/errors/app-error.js';
import { featureAtiva } from '#core/tenant/feature-flags.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
import { provedorBrasilApi } from '../adapters/cnpj-brasilapi.provider.js';
import { encerrarFilaCnpj, enfileirarEnriquecimentos } from '../adapters/cnpj-queue.repository.js';
import { buscarCacheCnpj, buscarConfigCnpj, gravarCacheCnpj, salvarConfigCnpj as gravarConfig } from '../adapters/crm-cnpj.repository.js';
import {
  CAMADA,
  CAMPOS_RECEITA,
  CHAVES_RECEITA,
  CONFIG_CNPJ_PADRAO,
  CRM_FEATURES,
  ENRIQUECIMENTO_CNPJ,
  MODOS_CNPJ,
  STATUS_CNPJ,
  TIPOS_CAMPO,
} from '../constants.js';
import { obterSchemaCampos } from './field-schema.service.js';
import { normalizarCep, normalizarCnpj, normalizarTelefone, normalizarValorDoTipo, valorValidoParaTipo } from './tipos-campo.service.js';

/**
 * SERVICE: enriquecimento por CNPJ (M11b, docs/crm/plano-configuracoes.md).
 *
 * - `consultarCnpj`: cache global de 30 dias; só chama o provedor no miss.
 * - Lupa (`consultarParaLupa`): devolve os dados e a sugestão por campo;
 *   não grava no lead — o usuário aplica no formulário e salva.
 * - Automático (`agendarEnriquecimento`): depois de salvar, enfileira; o
 *   worker aplica (`cnpj-enriquecimento.service.js`). Falha de fila ou de
 *   provedor nunca bloqueia salvar o lead.
 *
 * @typedef {import('../adapters/cnpj-brasilapi.provider.js').DadosReceita} DadosReceita
 * @typedef {{ ativo: boolean, modo: string, sobrescrever: boolean, mapeamento: Record<string, string> }} ConfigCnpj
 * @typedef {{ campoReceita: string, chave: string, label: string, tipo: string, camada: number, valor: unknown }} Sugestao
 */

const MS_POR_DIA = 86_400_000;
const provedor = provedorBrasilApi;

/**
 * @param {string} tenantId
 * @param {string} entrada  CNPJ com ou sem máscara
 * @param {Date} [agora]
 * @returns {Promise<{ cnpj: string, status: string, dados: DadosReceita, provedor: string, emCache: boolean }>}
 */
export async function consultarCnpj(tenantId, entrada, agora = new Date()) {
  const cnpj = normalizarCnpj(entrada);
  if (!cnpj) throw erroDeValidacao('cnpj', 'CNPJ inválido', 'Confira o CNPJ (dígitos verificadores)');

  const validoDesde = new Date(agora.getTime() - ENRIQUECIMENTO_CNPJ.TTL_CACHE_DIAS * MS_POR_DIA);
  const cache = await buscarCacheCnpj(tenantId, cnpj, validoDesde);
  if (cache) {
    return { cnpj, status: cache.status, dados: /** @type {DadosReceita} */ (cache.dados), provedor: cache.provedor, emCache: true };
  }

  const { status, dados } = await provedor.consultar(cnpj);
  if (status !== STATUS_CNPJ.NAO_SUPORTADO) {
    await gravarCacheCnpj(tenantId, { cnpj, status, dados, provedor: provedor.nome });
  }
  return { cnpj, status, dados, provedor: provedor.nome, emCache: false };
}

/**
 * GET /crm/cnpj/:cnpj — dados e sugestão. Provedor fora do ar → 503 (a
 * lupa pode tentar de novo); o resto do formulário segue funcionando.
 *
 * @param {string} tenantId
 * @param {string} entrada
 */
export async function consultarParaLupa(tenantId, entrada) {
  // Desligado nas configurações vale pra lupa também — sem gastar consulta.
  const config = await obterConfigCnpj(tenantId);
  if (!config.ativo) {
    throw new AppError({
      statusCode: HTTP_STATUS.FORBIDDEN,
      code: ERROR_CODES.FORBIDDEN,
      message: 'A consulta de CNPJ está desligada nas configurações',
    });
  }

  let resultado;
  try {
    resultado = await consultarCnpj(tenantId, entrada);
  } catch (erro) {
    if (erro instanceof AppError) throw erro;
    throw new AppError({
      statusCode: HTTP_STATUS.SERVICE_UNAVAILABLE,
      code: ERROR_CODES.EXTERNAL_SERVICE_UNAVAILABLE,
      message: 'A consulta de CNPJ está indisponível agora. Tente de novo em instantes.',
      cause: erro,
    });
  }
  const { campos } = await obterSchemaCampos(tenantId);
  const sugestao = resultado.status === STATUS_CNPJ.OK ? sugestaoParaLead(resultado.dados, config.mapeamento, campos) : [];
  return { cnpj: resultado.cnpj, status: resultado.status, dados: resultado.dados, sugestao };
}

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

/**
 * A gravada, ou a padrão (mapeamento pros campos do sistema que o tenant
 * tem ativos). Mapeamento pra campo que sumiu (excluído/oculto) cai fora.
 *
 * @param {string} tenantId
 * @returns {Promise<ConfigCnpj & { configurado: boolean }>}
 */
export async function obterConfigCnpj(tenantId) {
  const [gravada, { campos }] = await Promise.all([buscarConfigCnpj(tenantId), obterSchemaCampos(tenantId)]);
  const idsAtivos = new Set(campos.map((campo) => campo.id).filter(Boolean));

  if (!gravada) {
    const idPorChave = new Map(campos.filter((campo) => campo.camada !== CAMADA.CAMADA_3).map((campo) => [campo.chave, campo.id]));
    const mapeamento = Object.fromEntries(
      Object.entries(CONFIG_CNPJ_PADRAO.mapeamentoPorSistema)
        .map(([campoReceita, systemKey]) => [campoReceita, idPorChave.get(systemKey)])
        .filter(([, id]) => id),
    );
    const { ativo, modo, sobrescrever } = CONFIG_CNPJ_PADRAO;
    return { ativo, modo, sobrescrever, mapeamento, configurado: false };
  }

  const mapeamento = Object.fromEntries(
    Object.entries(gravada.mapeamento ?? {}).filter(([campoReceita, id]) => CAMPOS_RECEITA[campoReceita] && idsAtivos.has(id)),
  );
  return { ativo: gravada.ativo, modo: gravada.modo, sobrescrever: gravada.sobrescrever, mapeamento, configurado: true };
}

/**
 * GET /crm/configuracoes/cnpj: a config e o catálogo do que a Receita traz.
 *
 * @param {string} tenantId
 */
export async function listarConfigCnpj(tenantId) {
  return {
    ...(await obterConfigCnpj(tenantId)),
    camposReceita: CHAVES_RECEITA.map((chave) => ({ chave, label: CAMPOS_RECEITA[chave].label, tipos: CAMPOS_RECEITA[chave].tipos })),
  };
}

/**
 * Destino tem que ser campo ativo, de tipo que aceita o dado, e cada campo
 * recebe um dado só.
 *
 * @param {string} tenantId
 * @param {ConfigCnpj} config
 */
export async function salvarConfigCnpj(tenantId, config) {
  const { campos } = await obterSchemaCampos(tenantId);
  const campoPorId = new Map(campos.filter((campo) => campo.id).map((campo) => [campo.id, campo]));
  const usados = new Set();

  for (const [campoReceita, id] of Object.entries(config.mapeamento)) {
    const campo = campoPorId.get(id);
    const caminho = `mapeamento.${campoReceita}`;
    if (!campo) throw erroDeValidacao(caminho, 'O destino precisa ser um campo ativo');
    if (!CAMPOS_RECEITA[campoReceita].tipos.includes(campo.tipo)) {
      throw erroDeValidacao(caminho, `"${CAMPOS_RECEITA[campoReceita].label}" não cabe no campo "${campo.label}" (${campo.tipo})`);
    }
    if (usados.has(id)) throw erroDeValidacao(caminho, `"${campo.label}" já recebe outro dado da Receita`);
    usados.add(id);
  }

  await gravarConfig(tenantId, config);
  return listarConfigCnpj(tenantId);
}

// ---------------------------------------------------------------------------
// Sugestão (pura)
// ---------------------------------------------------------------------------

/**
 * Dados da Receita → valor por campo do lead, no tipo do destino. Valor
 * que não passa na validação do tipo (ex. telefone estranho) fica de fora.
 *
 * @param {DadosReceita} dados
 * @param {Record<string, string>} mapeamento  campo da Receita → `id` do campo
 * @param {{ id: string | null, chave: string, label: string, tipo: string, camada: number, opcoes?: readonly string[] | null }[]} campos
 * @returns {Sugestao[]}
 */
export function sugestaoParaLead(dados, mapeamento, campos) {
  const campoPorId = new Map(campos.filter((campo) => campo.id).map((campo) => [campo.id, campo]));
  /** @type {Sugestao[]} */
  const sugestao = [];

  for (const [campoReceita, id] of Object.entries(mapeamento)) {
    const campo = campoPorId.get(id);
    if (!campo) continue;
    const bruto = valorDaReceita(dados, campoReceita, campo.tipo);
    if (bruto === null || !valorValidoParaTipo(campo.tipo, bruto, campo.opcoes)) continue;
    sugestao.push({
      campoReceita,
      chave: campo.chave,
      label: campo.label,
      tipo: campo.tipo,
      camada: campo.camada,
      valor: normalizarValorDoTipo(campo.tipo, bruto),
    });
  }
  return sugestao;
}

/**
 * @param {DadosReceita} dados
 * @param {string} campoReceita
 * @param {string} tipo  tipo do campo de destino
 * @returns {unknown}
 */
function valorDaReceita(dados, campoReceita, tipo) {
  if (campoReceita === 'endereco') {
    const endereco = {
      cep: dados.cep ? (normalizarCep(dados.cep) ?? undefined) : undefined,
      logradouro: dados.logradouro,
      numero: dados.numero,
      complemento: dados.complemento,
      bairro: dados.bairro,
      cidade: dados.municipio,
      uf: dados.uf,
    };
    if (tipo === TIPOS_CAMPO.ENDERECO) {
      const partes = Object.fromEntries(Object.entries(endereco).filter(([, valor]) => valor));
      return Object.keys(partes).length > 0 ? partes : null;
    }
    const rua = [dados.logradouro, dados.numero, dados.complemento].filter(Boolean).join(', ');
    const linha = [[rua, dados.bairro].filter(Boolean).join(' - '), [dados.municipio, dados.uf].filter(Boolean).join('/')]
      .filter(Boolean)
      .join(', ');
    return linha || null;
  }

  const valor = /** @type {Record<string, string | undefined>} */ (dados)[campoReceita];
  if (!valor) return null;
  if (campoReceita === 'telefone' && tipo === TIPOS_CAMPO.TELEFONE) return normalizarTelefone(valor);
  if (campoReceita === 'cep' && tipo === TIPOS_CAMPO.CEP) return normalizarCep(valor);
  return valor;
}

// ---------------------------------------------------------------------------
// Automático
// ---------------------------------------------------------------------------

/**
 * Depois de salvar (formulário, PUT, import): enfileira os leads com CNPJ
 * válido, se a flag está ligada e o tenant usa o modo automático. Nunca
 * lança — o lead já foi salvo, e o enriquecimento é um extra.
 *
 * @param {string} tenantId
 * @param {{ leadId: string, cnpj: unknown }[]} leads
 * @returns {Promise<number>} quantos foram enfileirados
 */
export async function agendarEnriquecimento(tenantId, leads) {
  try {
    const itens = leads
      .map(({ leadId, cnpj }) => ({ tenantId, leadId, cnpj: typeof cnpj === 'string' ? normalizarCnpj(cnpj) : null }))
      .filter((item) => item.cnpj);
    if (itens.length === 0 || !(await featureAtiva(tenantId, CRM_FEATURES.CNPJ))) return 0;
    const config = await obterConfigCnpj(tenantId);
    if (!config.ativo || config.modo !== MODOS_CNPJ.AUTOMATICO) return 0;
    await enfileirarEnriquecimentos(/** @type {{ tenantId: string, leadId: string, cnpj: string }[]} */ (itens));
    return itens.length;
  } catch {
    return 0;
  }
}

/** Fecha a conexão do produtor da fila (shutdown do servidor HTTP). */
export function encerrarEnriquecimento() {
  return encerrarFilaCnpj();
}
