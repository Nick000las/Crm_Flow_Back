import { erroDeValidacao, erroNaoEncontrado, erroDeConflito } from '#core/errors/app-error.js';
import { slugify } from '#shared/text/slugify.js';
import {
  buscarPersonalizadoAtivoPorChave,
  criarCampoPersonalizado,
  desativarCampoPersonalizado,
  editarCampoPersonalizado,
  existeValorDoCampo,
} from '../adapters/crm-fields.repository.js';
import { CAMPOS_SISTEMA, CONTEXTOS_VISIBILIDADE, FIELD_DEFINITION_TIPOS, TIPOS_COM_OPCOES } from '../constants.js';
import { garantirLabelDisponivel, listarConfiguracaoCampos } from './configuracoes-campos.service.js';
import { invalidarSchemaCampos, obterSchemaCampos } from './field-schema.service.js';

/** Chaves dos campos do sistema — personalizado não pode reusar nenhuma. */
const CHAVES_SISTEMA = new Set(CAMPOS_SISTEMA.map((campo) => campo.systemKey));

/**
 * SERVICE: lógica de negócio pura. Nunca importa Fastify.
 * @typedef {import('../types/index.js').FieldDefinition} FieldDefinition
 * @typedef {import('../types/index.js').CriarFieldDefinitionInput} CriarFieldDefinitionInput
 * @typedef {import('../types/index.js').AtualizarFieldDefinitionInput} AtualizarFieldDefinitionInput
 */

/**
 * `tenantId` já saiu de um JWT validado por `authenticateHook` — a
 * existência do tenant foi garantida no login, não é responsabilidade
 * deste service reconfirmar isso a cada chamada (ver `leads.service.js`,
 * que segue o mesmo princípio).
 *
 * @param {string} tenantId
 * @returns {Promise<FieldDefinition[]>}
 */
export async function listarDefinicoesPorTenant(tenantId) {
  return (await obterSchemaCampos(tenantId)).definicoes;
}

/**
 * @param {string} tenantId
 * @param {{ label: string, tipo: string, opcoes?: string[] | null, obrigatorio: boolean, ordem: number }} input
 * @returns {Promise<FieldDefinition>}
 */
export async function criarNovaDefinicao(tenantId, input) {
  const label = input?.label?.trim();

  if (!label) {
    throw erroDeValidacao('label', 'Informe o nome do campo');
  }

  const opcoes = validarTipoEOpcoes(input.tipo, input.opcoes);
  // Nome igual ao de outro campo (inclusive um do sistema renomeado) daria
  // duas colunas com o mesmo título no form e na tabela.
  garantirLabelDisponivel(await listarConfiguracaoCampos(tenantId), label);
  const chave = slugify(label);

  // Chave igual à de um campo do sistema (ex: "Empresa" → `empresa`)
  // deixaria duas entradas com a mesma `chave` no form, no filtro e no
  // mapeamento de import.
  const definicaoExistente = CHAVES_SISTEMA.has(chave) || (await buscarPersonalizadoAtivoPorChave(tenantId, chave));
  if (definicaoExistente) {
    throw erroDeConflito('label', 'Já existe um campo com esse nome');
  }

  const criada = await criarCampoPersonalizado(tenantId, {
    chave,
    label,
    tipo: input.tipo,
    opcoes,
    obrigatorio: Boolean(input.obrigatorio),
    ordem: input.ordem,
  });
  await invalidarSchemaCampos(tenantId);
  return criada;
}

/**
 * `chave` nunca é editável por aqui — ver comentário do adapter. Só
 * label/tipo/opcoes/obrigatorio, com as mesmas regras da área
 * Configurações (M2): nome único, obrigatório só se o campo aparece no
 * formulário de criação, e tipo fixo depois que algum lead tem valor (o
 * dado gravado deixaria de bater com o tipo novo).
 *
 * @param {string} tenantId
 * @param {string} definicaoId
 * @param {AtualizarFieldDefinitionInput} atualizacoes
 * @returns {Promise<FieldDefinition>}
 */
export async function editarDefinicao(tenantId, definicaoId, atualizacoes) {
  const opcoes = validarTipoEOpcoes(atualizacoes.tipo, atualizacoes.opcoes);

  const campos = await listarConfiguracaoCampos(tenantId);
  const atual = campos.find((campo) => campo.id === definicaoId && campo.systemKey === null);
  if (!atual) throw definicaoNaoEncontrada();

  const label = garantirLabelDisponivel(campos, atualizacoes.label ?? '', definicaoId);

  if (atualizacoes.obrigatorio && !atual.visibilidade[CONTEXTOS_VISIBILIDADE.CRIACAO]) {
    throw erroDeValidacao(
      'obrigatorio',
      `"${label}" é obrigatório e precisa aparecer no formulário de criação`,
    );
  }
  if (atualizacoes.tipo !== atual.tipo && (await existeValorDoCampo(tenantId, definicaoId))) {
    throw erroDeValidacao(
      'tipo',
      'Já há leads com valor neste campo — o tipo não pode mudar. Crie um campo novo com o tipo desejado.',
    );
  }

  const definicaoAtualizada = await editarCampoPersonalizado(tenantId, definicaoId, {
    label,
    tipo: atualizacoes.tipo,
    opcoes,
    obrigatorio: Boolean(atualizacoes.obrigatorio),
  });

  // UPDATE ... RETURNING sem linha = id não existe (ou não é deste
  // tenant) — não precisa de uma query extra só pra checar antes.
  if (!definicaoAtualizada) {
    throw definicaoNaoEncontrada();
  }

  await invalidarSchemaCampos(tenantId);
  return definicaoAtualizada;
}

/**
 * @param {string} tenantId
 * @param {string} definicaoId
 * @returns {Promise<{ removido: true, aviso: string }>}
 */
export async function removerDefinicao(tenantId, definicaoId) {
  // Excluir = desativar (`crm_field.is_active`): o valor gravado nos leads
  // fica, só some da API. Lixeira de verdade é M5.
  const definicaoRemovida = await desativarCampoPersonalizado(tenantId, definicaoId);

  if (!definicaoRemovida) {
    throw definicaoNaoEncontrada();
  }
  await invalidarSchemaCampos(tenantId);

  // Dado órfão de propósito (plano, Parte 1.4) — leads.custom_fields não é
  // tocado. O aviso mora aqui, não no controller, pra não virar texto
  // duplicado se algum outro caller chamar o service diretamente.
  return {
    removido: true,
    aviso: 'Dados já preenchidos com esta chave continuam salvos nos leads existentes.',
  };
}

/**
 * Validação compartilhada por criar/editar — evita duas cópias da mesma
 * regra divergindo com o tempo.
 *
 * @param {string} tipo
 * @param {string[] | null | undefined} opcoes
 * @returns {string[] | null}
 */
function validarTipoEOpcoes(tipo, opcoes) {
  if (!FIELD_DEFINITION_TIPOS.includes(tipo)) {
    throw erroDeValidacao(
      'tipo',
      'Tipo de campo inválido',
      `Tipo deve ser um de: ${FIELD_DEFINITION_TIPOS.join(', ')}`,
    );
  }

  const precisaDeOpcoes = TIPOS_COM_OPCOES.includes(tipo);

  if (precisaDeOpcoes && (!opcoes || opcoes.length === 0)) {
    throw erroDeValidacao('opcoes', 'Informe as opções do campo', 'Informe ao menos uma opção');
  }

  // Tipo que não usa opções nunca guarda lixo em `opcoes`, mesmo que o
  // cliente mande algo por engano.
  return precisaDeOpcoes ? opcoes : null;
}

function definicaoNaoEncontrada() {
  return erroNaoEncontrado('Definição de campo não encontrada');
}
