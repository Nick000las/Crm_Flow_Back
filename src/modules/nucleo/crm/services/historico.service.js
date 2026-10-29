import { erroNaoEncontrado } from '#core/errors/app-error.js';
import { garantirFeature } from '#core/tenant/feature-flags.js';
import { buscarLeadPorId } from '../adapters/leads.repository.js';
import { listarEventosDoLead } from '../adapters/crm-lead-events.repository.js';
import { buscarNomesDeUsuarios } from '../adapters/usuarios.repository.js';
import {
  CAMADA,
  CAMPO_PERSONALIZADO_NO_DIFF,
  CAMPO_RESPONSAVEL_NO_DIFF,
  CAMPOS_SISTEMA,
  CATEGORIAS_EVENTO,
  CRM_FEATURES,
  PROPRIEDADES_NO_HISTORICO,
  REFERENCIAS_FIXAS,
  TIPOS_CAMPO,
  TIPOS_CICLO_DE_VIDA,
  TIPOS_EVENTO_LEAD,
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

/** Valor de usuário no diff (responsável, personalizado `usuario`) que dá pra resolver. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Histórico do lead, mais novo primeiro, pronto pra tela: cada entrada do
 * diff ganha `chave`, `label` e `tipo` (e `opcoesLista`, se for lista).
 * Campo desligado (oculto em todos os contextos), personalizado excluído
 * ou oculto pro papel de quem lê (M13) sai do diff — mesma regra da
 * resposta do lead (`formatarLead`).
 *
 * M16 (timeline): edição que só mexeu em campos que o papel não vê some da
 * lista e do total; cada evento traz `categorias`; responsável e
 * personalizado `usuario` vêm com `antesNome`/`depoisNome`; o CNPJ
 * consultado (`detalhes.cnpj` do enriquecimento) só sai pra quem vê o CNPJ.
 * Filtrar por `categorias` exige a flag `crm.timeline`.
 *
 * @param {string} tenantId
 * @param {string} leadId
 * @param {{ pagina: number, tamanho: number, categorias?: string[] }} paginacao
 * @param {{ papel?: string }} [acesso]
 */
export async function listarHistorico(tenantId, leadId, { pagina, tamanho, categorias = [] }, { papel } = {}) {
  if (categorias.length > 0) await garantirFeature(tenantId, CRM_FEATURES.TIMELINE);
  const [lead, schema] = await Promise.all([buscarLeadPorId(tenantId, leadId), obterSchemaDoPapel(tenantId, papel)]);
  if (!lead) throw erroNaoEncontrado('Lead não encontrado');

  const { itens, total } = await listarEventosDoLead(tenantId, leadId, {
    limite: tamanho,
    offset: (pagina - 1) * tamanho,
    categorias,
    visiveis: visiveisDoSchema(schema),
  });
  const descrever = descritorDoDiff(schema);
  const cnpjVisivel = schema.campos.some((campo) => campo.chave === 'cnpj');

  const descritos = itens.map((evento) => ({
    id: evento.id,
    tipo: evento.tipo,
    categorias: categoriasDoEvento(evento),
    autor: evento.autor_id ? { id: evento.autor_id, nome: evento.autor_nome } : null,
    criadoEm: evento.created_at,
    detalhes: detalhesVisiveis(evento, cnpjVisivel),
    diff: (evento.diff ?? []).map(descrever).filter(Boolean),
  }));
  const nomes = await buscarNomesDeUsuarios(tenantId, idsDeUsuario(descritos));

  return {
    itens: descritos.map((evento) => ({ ...evento, diff: evento.diff.map((entrada) => comNomeDoUsuario(entrada, nomes)) })),
    total,
    pagina,
    tamanho,
  };
}

/**
 * Categorias do evento (M16) — a mesma regra do filtro em SQL
 * (`crm-lead-events.repository.js`), sobre o diff gravado.
 *
 * @param {{ tipo: string, diff?: EntradaDiff[] | null, detalhes?: Record<string, unknown> | null }} evento
 * @returns {string[]}
 */
export function categoriasDoEvento({ tipo, diff, detalhes }) {
  const categorias = [];
  if (tipo === TIPOS_EVENTO_LEAD.ATUALIZADO) categorias.push(CATEGORIAS_EVENTO.CAMPOS);
  if ((diff ?? []).some((entrada) => entrada.campo === CAMPO_RESPONSAVEL_NO_DIFF) || detalhes?.distribuicao) {
    categorias.push(CATEGORIAS_EVENTO.ATRIBUICAO);
  }
  if (tipo === TIPOS_EVENTO_LEAD.MESCLADO) categorias.push(CATEGORIAS_EVENTO.MESCLAGEM);
  if (tipo === TIPOS_EVENTO_LEAD.ENRIQUECIDO) categorias.push(CATEGORIAS_EVENTO.ENRIQUECIMENTO);
  if (TIPOS_CICLO_DE_VIDA.includes(tipo)) categorias.push(CATEGORIAS_EVENTO.CICLO);
  return categorias;
}

/**
 * O que entra no diff pro papel de quem lê — as mesmas regras de
 * `descritorDoDiff`, no formato do filtro SQL (M16).
 *
 * @param {Pick<import('./field-schema.service.js').SchemaCampos, 'campos' | 'definicoes'>} schema
 * @returns {{ chaves: string[], campoIds: string[] }}
 */
export function visiveisDoSchema({ campos, definicoes }) {
  const ligados = new Set(campos.map((campo) => campo.chave));
  return {
    chaves: [
      ...campos.filter((campo) => campo.camada !== CAMADA.CAMADA_3).map((campo) => campo.chave),
      ...PROPRIEDADES_NO_HISTORICO.map((propriedade) => propriedade.campo),
    ],
    campoIds: definicoes.filter((definicao) => ligados.has(definicao.chave)).map((definicao) => definicao.id),
  };
}

/** @param {{ chave: string, tipo: string }} entrada */
const ehDeUsuario = (entrada) => entrada.chave === CAMPO_RESPONSAVEL_NO_DIFF || entrada.tipo === TIPOS_CAMPO.USUARIO;

/** @param {{ diff: (EntradaDiff & { chave: string, tipo: string })[] }[]} eventos */
function idsDeUsuario(eventos) {
  const ids = new Set();
  for (const { diff } of eventos) {
    for (const entrada of diff.filter(ehDeUsuario)) {
      for (const valor of [entrada.antes, entrada.depois]) if (typeof valor === 'string' && UUID.test(valor)) ids.add(valor);
    }
  }
  return [...ids];
}

/**
 * @template {EntradaDiff & { chave: string, tipo: string }} E
 * @param {E} entrada
 * @param {Map<string, string>} nomes
 */
function comNomeDoUsuario(entrada, nomes) {
  if (!ehDeUsuario(entrada)) return entrada;
  const nome = (valor) => (typeof valor === 'string' ? (nomes.get(valor) ?? null) : null);
  return { ...entrada, antesNome: nome(entrada.antes), depoisNome: nome(entrada.depois) };
}

/**
 * @param {{ tipo: string, detalhes?: Record<string, unknown> | null }} evento
 * @param {boolean} cnpjVisivel
 */
function detalhesVisiveis({ tipo, detalhes }, cnpjVisivel) {
  const todos = detalhes ?? {};
  if (tipo !== TIPOS_EVENTO_LEAD.ENRIQUECIDO || cnpjVisivel) return todos;
  return Object.fromEntries(Object.entries(todos).filter(([chave]) => chave !== 'cnpj'));
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
