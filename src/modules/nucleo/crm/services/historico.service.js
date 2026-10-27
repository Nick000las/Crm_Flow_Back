import { erroNaoEncontrado } from '#core/errors/app-error.js';
import { buscarLeadPorId } from '../adapters/leads.repository.js';
import { listarEventosDoLead } from '../adapters/crm-lead-events.repository.js';
import {
  CAMADA,
  CAMPO_PERSONALIZADO_NO_DIFF,
  CAMPOS_SISTEMA,
  PROPRIEDADES_NO_HISTORICO,
  REFERENCIAS_FIXAS,
} from '../constants.js';
import { obterSchemaDoPapel } from './permissoes.service.js';

/**
 * SERVICE: histórico do lead (M6). Cada mudança vira um `crm_lead_event`
 * com o antes e o depois SÓ dos campos alterados; o autor vem do token.
 *
 * O diff é guardado pelo que não muda: `systemKey` do campo do sistema,
 * chave da API pras propriedades do lead (`valor`, `funilEstagioId`,
 * `usuarioResponsavelId`) e `campoId` (id em `crm_field`) pro
 * personalizado. Label, tipo e opções vêm do schema na leitura — renomear
 * um campo não reescreve o histórico.
 *
 * @typedef {{ campo: string, campoId?: string, antes: unknown, depois: unknown, antesNome?: string | null, depoisNome?: string | null }} EntradaDiff
 */

/**
 * Valor comparável e serializável: data em ISO, NUMERIC (Decimal) em número.
 *
 * @param {unknown} valor
 */
function normalizar(valor) {
  if (valor === undefined || valor === null) return null;
  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor === 'object' && !Array.isArray(valor) && typeof valor.toNumber === 'function') {
    return valor.toNumber();
  }
  return valor;
}

const iguais = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Diff entre duas linhas do lead (as colunas de leitura do repository).
 * Função pura — o repository a chama dentro da transação do UPDATE, com o
 * antes travado (`FOR UPDATE`).
 *
 * @param {Record<string, any>} antes
 * @param {Record<string, any>} depois
 * @param {{ ignorar?: string[] }} [opcoes] `systemKey`s fora do diff (ex.:
 *   `ultimaInteracaoEm` quando quem mexeu foi a regra de status, não o usuário)
 * @returns {EntradaDiff[]}
 */
export function diffDoLead(antes, depois, { ignorar = [] } = {}) {
  /** @type {EntradaDiff[]} */
  const diff = [];
  const comparar = (entrada, valorAntes, valorDepois) => {
    const a = normalizar(valorAntes);
    const d = normalizar(valorDepois);
    if (!iguais(a, d)) diff.push({ ...entrada, antes: a, depois: d });
  };

  for (const campo of CAMPOS_SISTEMA) {
    if (ignorar.includes(campo.systemKey)) continue;
    comparar({ campo: campo.systemKey }, antes[campo.coluna], depois[campo.coluna]);
  }

  for (const propriedade of PROPRIEDADES_NO_HISTORICO) {
    const tamanhoAntes = diff.length;
    comparar({ campo: propriedade.campo }, antes[propriedade.coluna], depois[propriedade.coluna]);
    // Estágio guarda também o nome do momento (o estágio pode sumir depois).
    if (propriedade.colunaNome && diff.length > tamanhoAntes) {
      Object.assign(diff[diff.length - 1], {
        antesNome: antes[propriedade.colunaNome] ?? null,
        depoisNome: depois[propriedade.colunaNome] ?? null,
      });
    }
  }

  const customAntes = antes.custom_fields ?? {};
  const customDepois = depois.custom_fields ?? {};
  for (const campoId of new Set([...Object.keys(customAntes), ...Object.keys(customDepois)])) {
    comparar({ campo: CAMPO_PERSONALIZADO_NO_DIFF, campoId }, customAntes[campoId], customDepois[campoId]);
  }

  return diff;
}

/**
 * Histórico do lead, mais novo primeiro, pronto pra tela: cada entrada do
 * diff ganha `chave`, `label` e `tipo` (e `opcoesLista`, se for lista).
 * Campo desligado (oculto em todos os contextos), personalizado excluído
 * ou oculto pro papel de quem lê (M13) sai do diff — mesma regra da
 * resposta do lead (`formatarLead`).
 *
 * @param {string} tenantId
 * @param {string} leadId
 * @param {{ pagina: number, tamanho: number }} paginacao
 * @param {{ papel?: string }} [acesso]
 */
export async function listarHistorico(tenantId, leadId, { pagina, tamanho }, { papel } = {}) {
  const [lead, schema] = await Promise.all([buscarLeadPorId(tenantId, leadId), obterSchemaDoPapel(tenantId, papel)]);
  if (!lead) throw erroNaoEncontrado('Lead não encontrado');

  const { itens, total } = await listarEventosDoLead(tenantId, leadId, {
    limite: tamanho,
    offset: (pagina - 1) * tamanho,
  });
  const descrever = descritorDoDiff(schema);

  return {
    itens: itens.map((evento) => ({
      id: evento.id,
      tipo: evento.tipo,
      autor: evento.autor_id ? { id: evento.autor_id, nome: evento.autor_nome } : null,
      criadoEm: evento.created_at,
      detalhes: evento.detalhes ?? {},
      diff: (evento.diff ?? []).map(descrever).filter(Boolean),
    })),
    total,
    pagina,
    tamanho,
  };
}

/**
 * @param {Pick<import('./field-schema.service.js').SchemaCampos, 'campos' | 'definicoes'>} schema
 * @returns {(entrada: EntradaDiff) => (EntradaDiff & { chave: string, label: string, tipo: string }) | null}
 */
function descritorDoDiff({ campos, definicoes }) {
  const ligados = new Set(campos.map((campo) => campo.chave));
  const sistemaPorChave = new Map(
    campos.filter((campo) => campo.camada !== CAMADA.CAMADA_3).map((campo) => [campo.chave, campo]),
  );
  const personalizadoPorId = new Map(
    definicoes.filter((definicao) => ligados.has(definicao.chave)).map((definicao) => [definicao.id, definicao]),
  );
  const propriedadePorCampo = new Map(
    PROPRIEDADES_NO_HISTORICO.map((propriedade) => [propriedade.campo, REFERENCIAS_FIXAS[propriedade.ref]]),
  );

  return (entrada) => {
    const fixa = propriedadePorCampo.get(entrada.campo);
    if (fixa) return { ...entrada, chave: entrada.campo, label: fixa.label, tipo: fixa.tipo };

    const campo =
      entrada.campo === CAMPO_PERSONALIZADO_NO_DIFF
        ? personalizadoPorId.get(entrada.campoId)
        : sistemaPorChave.get(entrada.campo);
    if (!campo) return null;

    const descrito = { ...entrada, chave: campo.chave, label: campo.label, tipo: campo.tipo };
    if (campo.opcoesLista) descrito.opcoesLista = campo.opcoesLista;
    return descrito;
  };
}
