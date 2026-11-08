import { erroDeConflito, erroNaoEncontrado, erroDeValidacao } from '#core/errors/app-error.js';
import {
  buscarFormulariosDisponiveis,
  buscarLinksDaPessoa,
  criarOuReaproveitarLink,
  revogarLinkAtivo,
} from '../adapters/crm-form-links.repository.js';
import { CAMINHO_PUBLICO_DO_FORMULARIO } from '../constants.js';
import {
  chaveDosLinks,
  cifrarToken,
  decifrarToken,
  gerarToken,
  hashDoToken,
} from './token-formulario.service.js';

/**
 * SERVICE: link pessoal de formulário (FM2). Um link liga uma pessoa a um
 * formulário, na versão publicada quando foi criado. Copiar de novo devolve o
 * mesmo link enquanto ele estiver ativo; vencido, respondido ou revogado, o
 * próximo pedido gera outro.
 *
 * `criarLinkDoFormulario` não depende de usuário logado além do autor: o
 * envio automático (plano do bot) chama o mesmo service.
 *
 * @typedef {import('../adapters/crm-form-links.repository.js').LinkLinha} LinkLinha
 */

const IMPEDIMENTOS = Object.freeze({
  pessoa: () => erroNaoEncontrado('Lead não encontrado'),
  anonimizada: () => erroDeConflito('lead', 'A pessoa foi anonimizada: não recebe formulário'),
  arquivada: () => erroDeConflito('lead', 'Desarquive a pessoa para enviar o formulário'),
  formulario: () => erroNaoEncontrado('Formulário não encontrado, inativo ou sem versão publicada'),
  oportunidade: () =>
    erroDeValidacao('oportunidadeId', 'A oportunidade não é desta pessoa ou está na lixeira'),
});

/**
 * @param {string} token
 * @param {NodeJS.ProcessEnv} [ambiente]
 * @returns {string} absoluto se `FRONTEND_URL` existe; senão, o caminho
 */
export function urlDoLink(token, ambiente = process.env) {
  const base = (ambiente.FRONTEND_URL ?? '').replace(/\/+$/, '');
  return `${base}${CAMINHO_PUBLICO_DO_FORMULARIO}${token}`;
}

/** @param {LinkLinha} linha */
function paraApi(linha) {
  return {
    id: linha.id,
    formulario: { id: linha.formulario_id, nome: linha.formulario_nome },
    versao: { id: linha.versao_id, versao: linha.versao },
    oportunidadeId: linha.oportunidade_id,
    status: linha.status,
    expiraEm: linha.expira_em,
    abertoEm: linha.aberto_em,
    respondidoEm: linha.respondido_em,
    revogadoEm: linha.revogado_em,
    criadoEm: linha.criado_em,
    criadoPor: linha.criado_por,
  };
}

/**
 * Link ativo da pessoa no formulário, criado se não houver. A chave é
 * conferida antes de tudo: sem ela, nada é gravado.
 *
 * @param {string} tenantId
 * @param {string} leadId
 * @param {string} formId
 * @param {{ oportunidadeId?: string | null, usuarioId?: string | null }} [opcoes]
 * @returns {Promise<{ link: ReturnType<typeof paraApi>, url: string, criado: boolean }>}
 */
export async function criarLinkDoFormulario(tenantId, leadId, formId, opcoes = {}) {
  const chave = chaveDosLinks();
  const token = gerarToken();
  const resultado = await criarOuReaproveitarLink(tenantId, {
    leadId,
    formId,
    dealId: opcoes.oportunidadeId ?? null,
    usuarioId: opcoes.usuarioId ?? null,
    tokenHash: hashDoToken(token),
    tokenCifrado: cifrarToken(token, chave),
  });
  if (resultado.impedimento) throw IMPEDIMENTOS[resultado.impedimento]();

  const { link, criado } = /** @type {Required<typeof resultado>} */ (resultado);
  const tokenDoLink = criado ? token : decifrarToken(link.token_cifrado, chave);
  return { link: paraApi(link), url: urlDoLink(tokenDoLink), criado };
}

/**
 * Histórico de links da pessoa, sem token: copiar passa por
 * `criarLinkDoFormulario`.
 *
 * @param {string} tenantId
 * @param {string} leadId
 */
export async function listarLinksDaPessoa(tenantId, leadId) {
  return (await buscarLinksDaPessoa(tenantId, leadId)).map(paraApi);
}

/**
 * @param {string} tenantId
 * @param {string} leadId
 * @param {string} linkId
 */
export async function revogarLink(tenantId, leadId, linkId) {
  const revogado = await revogarLinkAtivo(tenantId, leadId, linkId);
  if (!revogado) {
    const existe = (await buscarLinksDaPessoa(tenantId, leadId)).some((link) => link.id === linkId);
    if (!existe) throw erroNaoEncontrado('Link não encontrado');
    throw erroDeConflito('link', 'Só um link ativo pode ser revogado');
  }
  return { id: revogado.id };
}

/** @param {string} tenantId */
export async function listarFormulariosDisponiveis(tenantId) {
  return (await buscarFormulariosDisponiveis(tenantId)).map((linha) => ({
    id: linha.id,
    nome: linha.nome,
    descricao: linha.descricao,
    validadeDias: linha.validade_dias,
    versao: linha.versao,
  }));
}
