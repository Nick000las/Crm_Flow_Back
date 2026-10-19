import { AppError, erroDeValidacao } from '#core/errors/app-error.js';
import { featureAtiva, garantirFeature } from '#core/tenant/feature-flags.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { formatarCep, formatarCnpj, formatarCpf, formatarTelefoneBR } from '#shared/formatters/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
import { listarUsuariosAtivosDoTenant } from '../adapters/usuarios.repository.js';
import {
  CAMADA,
  CAMADA_1_CAMPOS,
  CAMADA_2_CAMPOS,
  CAMPOS_EXTRAS_PLANILHA,
  CAMPOS_SO_EXPORTACAO,
  CRM_FEATURES,
  EXPORTACAO,
  FORMATOS_EXPORTACAO,
  SITUACOES_LEAD,
  TIPOS_CAMPO,
} from '../constants.js';
import { obterLayout } from './layout.service.js';
import { buscarLeadsFiltrados, listarCamposDoTenant } from './leads.service.js';
import { gerarCsv, gerarPlanilha } from './planilha.service.js';

/**
 * SERVICE: export síncrono — gera o .xlsx no próprio request e o
 * controller devolve o binário (decisão: sem storage de arquivo). O
 * limite de linhas protege a memória do processo HTTP.
 *
 * @typedef {{ chave: string, label: string, tipo: string, camada?: number, opcoesLista?: { key: string, label: string }[] }} CampoExportavel
 */

const SEPARADOR_LISTA = ', ';
const SEPARADOR_PERIODO = ' – ';

/** Tipos gravados sem máscara que saem formatados na planilha. */
const MASCARAS = Object.freeze({
  [TIPOS_CAMPO.TELEFONE]: formatarTelefoneBR,
  [TIPOS_CAMPO.CPF]: formatarCpf,
  [TIPOS_CAMPO.CNPJ]: formatarCnpj,
  [TIPOS_CAMPO.CEP]: formatarCep,
});

/** `AAAA-MM-DD` → `dd/mm/aaaa` (sem fuso: é um dia, não um instante). @param {unknown} dia */
function diaBR(dia) {
  const [ano, mes, dd] = String(dia ?? '').split('-');
  return ano && mes && dd ? `${dd}/${mes}/${ano}` : '';
}

/** `Rua X, 10, Apto 2 - Centro, São Paulo/SP, CEP 01310-100`. @param {Record<string, string>} endereco */
function enderecoEmLinha({ cep, logradouro, numero, complemento, bairro, cidade, uf }) {
  const rua = [logradouro, numero, complemento].filter(Boolean).join(', ');
  const local = [cidade, uf].filter(Boolean).join('/');
  const partes = [[rua, bairro].filter(Boolean).join(' - '), local, cep ? `CEP ${formatarCep(cep)}` : ''];
  return partes.filter(Boolean).join(', ');
}

/**
 * @param {string} tenantId
 * @param {{
 *   colunas?: string[],
 *   filtro?: import('./lead-filter.service.js').FiltroLeads,
 *   formato?: 'xlsx' | 'csv',
 * }} input
 *   `colunas` são chaves de `GET /crm/leads/fields` (+ `valor`/`funilEstagio`/
 *   `usuarioResponsavelId`/`createdAt`), na ordem desejada. Sem elas (M10,
 *   `crm.massa`), as da tabela do usuário: o identificador e as colunas do
 *   layout efetivo. `csv` também exige `crm.massa`.
 * @param {string} [usuarioId]  dono do layout das colunas padrão
 * @returns {Promise<Buffer>}
 */
export async function exportarLeads(tenantId, { colunas, filtro = {}, formato = FORMATOS_EXPORTACAO.XLSX }, usuarioId) {
  // O schema da rota já barra; aqui é a garantia pra qualquer outro chamador.
  if (filtro.situacao === SITUACOES_LEAD.LIXEIRA) {
    throw erroDeValidacao('situacao', 'A lixeira não pode ser exportada');
  }
  if (formato === FORMATOS_EXPORTACAO.CSV) {
    await garantirFeature(tenantId, CRM_FEATURES.MASSA);
  }
  const campos = [...(await listarCamposDoTenant(tenantId)), ...CAMPOS_EXTRAS_PLANILHA, ...CAMPOS_SO_EXPORTACAO];
  const campoPorChave = new Map(campos.map((campo) => [campo.chave, campo]));
  colunas ??= await colunasPadrao(tenantId, usuarioId);

  const desconhecidas = colunas.filter((chave) => !campoPorChave.has(chave));
  if (desconhecidas.length > 0) {
    throw new AppError({
      statusCode: HTTP_STATUS.BAD_REQUEST,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Há colunas que não são campos ativos',
      fields: { colunas: desconhecidas.map((chave) => `"${chave}" não é um campo ativo`) },
    });
  }

  const { itens, total } = await buscarLeadsFiltrados(tenantId, filtro, {
    limite: EXPORTACAO.MAX_LINHAS,
    offset: 0,
  });
  if (total > EXPORTACAO.MAX_LINHAS) {
    throw new AppError({
      statusCode: HTTP_STATUS.BAD_REQUEST,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `O filtro retorna ${total} leads — o export é limitado a ${EXPORTACAO.MAX_LINHAS}. Refine o filtro.`,
    });
  }

  const camposExportados = colunas.map((chave) => /** @type {CampoExportavel} */ (campoPorChave.get(chave)));
  const temUsuario = camposExportados.some(
    (campo) => campo.chave === 'usuarioResponsavelId' || campo.tipo === TIPOS_CAMPO.USUARIO,
  );
  const responsaveis = temUsuario
    ? new Map((await listarUsuariosAtivosDoTenant(tenantId)).map((usuario) => [usuario.id, usuario.nome]))
    : new Map();
  const cabecalho = camposExportados.map((campo) => campo.label);
  const linhas = itens.map((lead) => camposExportados.map((campo) => valorParaPlanilha(lead, campo, { responsaveis })));
  return formato === FORMATOS_EXPORTACAO.CSV ? gerarCsv(cabecalho, linhas) : gerarPlanilha(cabecalho, linhas);
}

/**
 * Colunas padrão (M10): as da tabela do usuário — o identificador (sempre a
 * 1ª coluna) e as do layout efetivo. Sem `crm.massa`, segue obrigatório
 * escolher (comportamento de antes).
 *
 * @param {string} tenantId
 * @param {string | undefined} usuarioId
 * @returns {Promise<string[]>}
 */
async function colunasPadrao(tenantId, usuarioId) {
  if (!usuarioId || !(await featureAtiva(tenantId, CRM_FEATURES.MASSA))) {
    throw erroDeValidacao('colunas', 'Escolha as colunas do export');
  }
  const { efetivo } = await obterLayout(tenantId, usuarioId);
  return [efetivo.identificador, ...efetivo.colunas].filter(Boolean).map((item) => item.chave);
}

/**
 * @param {Record<string, any>} lead já formatado (Camada 2 desligada removida)
 * @param {CampoExportavel} campo
 * @param {{ responsaveis?: Map<string, string> }} [contexto]  id → nome dos
 *   usuários ativos; responsável desativado sai vazio
 */
export function valorParaPlanilha(lead, campo, { responsaveis = new Map() } = {}) {
  let valor;
  if (campo.chave === 'valor') valor = lead.valor;
  else if (campo.chave === 'funilEstagio') valor = lead.estagio_nome;
  else if (campo.chave === 'usuarioResponsavelId') valor = responsaveis.get(lead.usuario_responsavel_id) ?? null;
  else if (campo.chave === 'createdAt') valor = lead.created_at;
  else if (campo.camada === CAMADA.CAMADA_3) valor = lead.custom_fields?.[campo.chave];
  else valor = lead[CAMADA_1_CAMPOS[campo.chave] ?? CAMADA_2_CAMPOS[campo.chave]];

  if (valor === null || valor === undefined) return null;
  // Campo de lista (M3): a planilha mostra o nome da opção, não a key.
  if (campo.opcoesLista) {
    const nomes = new Map(campo.opcoesLista.map((opcao) => [opcao.key, opcao.label]));
    if (Array.isArray(valor)) return valor.map((key) => nomes.get(key) ?? key).join(SEPARADOR_LISTA);
    return nomes.get(valor) ?? valor;
  }
  if (Array.isArray(valor)) return valor.join(SEPARADOR_LISTA);
  if (typeof valor === 'boolean') return valor ? 'Sim' : 'Não';
  // NUMERIC chega como Prisma.Decimal.
  if (typeof valor === 'object' && typeof valor.toNumber === 'function') return valor.toNumber();
  // Telefone/documentos são gravados sem máscara; na planilha saem com ela.
  if (typeof valor === 'string' && MASCARAS[campo.tipo]) return MASCARAS[campo.tipo](valor);
  // M11: usuário pelo nome; endereço e período numa linha.
  if (campo.tipo === TIPOS_CAMPO.USUARIO) return responsaveis.get(String(valor)) ?? null;
  if (campo.tipo === TIPOS_CAMPO.ENDERECO && typeof valor === 'object') return enderecoEmLinha(valor);
  if (campo.tipo === TIPOS_CAMPO.INTERVALO_DATAS && typeof valor === 'object') {
    return `${diaBR(valor.de)}${SEPARADOR_PERIODO}${diaBR(valor.ate)}`;
  }
  if (campo.tipo === 'data' && typeof valor === 'string') {
    const data = new Date(valor);
    return Number.isNaN(data.getTime()) ? valor : data;
  }
  return valor;
}
