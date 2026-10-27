import { AppError, erroDeValidacao } from '#core/errors/app-error.js';
import { featureAtiva } from '#core/tenant/feature-flags.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
import { substituirPermissoesDoPapel } from '../adapters/crm-field-permissions.repository.js';
import {
  ACESSOS_CAMPO,
  CAMADA,
  CHAVES_CONTATO,
  CHAVES_SEM_RESTRICAO,
  CRM_FEATURES,
  PAPEIS_COM_PERMISSAO,
  TIPOS_REGRA,
} from '../constants.js';
import { invalidarSchemaCampos, obterSchemaCampos } from './field-schema.service.js';

/**
 * SERVICE: permissão por campo (M13). Aplicada no back por um "schema do
 * papel": o schema de campos do tenant SEM os campos ocultos pro papel e
 * com `acesso` em cada campo. Leitura, filtro, histórico e layout já tiram
 * do lead o que não está no schema (como fazem com campo desligado) — o
 * oculto some por esse mesmo caminho. A escrita confere à parte
 * (`garantirEscritaPermitida`): campo "só ver" ou oculto no payload → 403.
 *
 * DONO e MASTER ignoram (veem e editam tudo); sem a flag `crm.permissoes`,
 * ninguém é restringido. Import, export e mesclagem já são só de gestão.
 *
 * @typedef {import('./field-schema.service.js').SchemaCampos} SchemaCampos
 * @typedef {{ acesso: string, label: string, camada: number }} Restricao
 * @typedef {SchemaCampos & { restritos?: Map<string, Restricao> }} SchemaDoPapel
 *   `restritos`: por `chave`, os campos que o papel não edita (só ver ou oculto)
 */

const MENSAGEM_SEM_PERMISSAO = 'Você não tem permissão para alterar este campo';

/**
 * O schema como o papel o enxerga (puro). Papel sem permissão
 * configurável: o schema intacto.
 *
 * - `campos`/`definicoes`: sem os ocultos; cada campo com `acesso`.
 * - `regras` (M8): só as que o papel consegue cumprir — alvo editável e
 *   condição sobre campo que ele vê. A obrigatoriedade não vale pra quem
 *   não pode preencher (decisão do usuário).
 *
 * @param {SchemaCampos} schema
 * @param {string | undefined} papel
 * @returns {SchemaDoPapel}
 */
export function schemaDoPapel(schema, papel) {
  if (!papel || !PAPEIS_COM_PERMISSAO.includes(papel)) return schema;

  const acessoPorId = new Map(
    (schema.permissoes ?? []).filter((linha) => linha.role === papel).map((linha) => [linha.field_id, linha.access]),
  );
  /** @param {{ id?: string | null, chave: string }} campo */
  const acessoDe = (campo) =>
    CHAVES_SEM_RESTRICAO.includes(campo.chave) ? ACESSOS_CAMPO.EDITAR : (acessoPorId.get(campo.id ?? '') ?? ACESSOS_CAMPO.EDITAR);

  /** @type {Map<string, Restricao>} */
  const restritos = new Map();
  for (const campo of schema.campos) {
    const acesso = acessoDe(campo);
    if (acesso !== ACESSOS_CAMPO.EDITAR) restritos.set(campo.chave, { acesso, label: campo.label, camada: campo.camada });
  }
  const oculto = (chave) => restritos.get(chave)?.acesso === ACESSOS_CAMPO.OCULTO;

  return {
    ...schema,
    campos: schema.campos.filter((campo) => !oculto(campo.chave)).map((campo) => ({ ...campo, acesso: acessoDe(campo) })),
    definicoes: schema.definicoes.filter((definicao) => !oculto(definicao.chave)),
    regras: (schema.regras ?? []).filter((regra) => {
      if (restritos.has(regra.alvo.chave)) return false;
      return regra.kind !== TIPOS_REGRA.CONDICIONAL || !oculto(/** @type {any} */ (regra.condicao).campo.chave);
    }),
    restritos,
  };
}

/**
 * Schema de campos já recortado pro papel de quem chamou. Sem `papel`
 * (worker, job, chamada interna): o schema inteiro.
 *
 * @param {string} tenantId
 * @param {string | undefined} papel
 * @returns {Promise<SchemaDoPapel>}
 */
export async function obterSchemaDoPapel(tenantId, papel) {
  const schema = await obterSchemaCampos(tenantId);
  if (!papel || !PAPEIS_COM_PERMISSAO.includes(papel)) return schema;
  if (!(await featureAtiva(tenantId, CRM_FEATURES.PERMISSOES))) return schema;
  return schemaDoPapel(schema, papel);
}

/**
 * Campo que o papel não edita no payload (com valor, inclusive `null`) →
 * 403 com cada campo em `fields`. Chave omitida (`undefined`) passa.
 *
 * @param {SchemaDoPapel} schema
 * @param {Record<string, unknown> & { customFields?: Record<string, unknown> }} input
 */
export function garantirEscritaPermitida(schema, input) {
  const { restritos } = schema;
  if (!restritos || restritos.size === 0) return;

  const bloqueados = [];
  for (const [chave, valor] of Object.entries(input)) {
    if (valor === undefined || chave === 'customFields') continue;
    const restricao = restritos.get(chave);
    if (restricao && restricao.camada !== CAMADA.CAMADA_3) bloqueados.push([chave, restricao]);
  }
  for (const [chave, valor] of Object.entries(input.customFields ?? {})) {
    const restricao = restritos.get(chave);
    if (valor !== undefined && restricao?.camada === CAMADA.CAMADA_3) bloqueados.push([chave, restricao]);
  }
  if (bloqueados.length === 0) return;

  throw new AppError({
    statusCode: HTTP_STATUS.FORBIDDEN,
    code: ERROR_CODES.FORBIDDEN,
    message: `Você não tem permissão para alterar: ${bloqueados.map(([, restricao]) => restricao.label).join(', ')}`,
    fields: Object.fromEntries(bloqueados.map(([chave]) => [chave, [MENSAGEM_SEM_PERMISSAO]])),
  });
}

/**
 * A identificação do layout (M4) entra na busca textual — não se o campo
 * estiver oculto pro papel (a busca revelaria o valor).
 *
 * @template {{ chave: string } | null} T
 * @param {T} identificador
 * @param {SchemaDoPapel} schema
 * @returns {T | null}
 */
export function identificadorVisivel(identificador, schema) {
  if (!identificador || !schema.restritos) return identificador;
  return schema.restritos.get(identificador.chave)?.acesso === ACESSOS_CAMPO.OCULTO ? null : identificador;
}

/**
 * E-mail/telefone ocultos saem da busca textual (mesmo motivo).
 *
 * @param {SchemaDoPapel} schema
 * @returns {{ email: boolean, telefone: boolean }}
 */
export function contatoNaBusca(schema) {
  const visivel = (chave) => schema.restritos?.get(chave)?.acesso !== ACESSOS_CAMPO.OCULTO;
  return { email: visivel('email'), telefone: visivel('telefone') };
}

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

/**
 * GET /crm/configuracoes/permissoes: cada campo ativo com o acesso por
 * papel configurável (sem linha = `edit`).
 *
 * @param {string} tenantId
 */
export async function obterPermissoes(tenantId) {
  const { campos, permissoes = [] } = await obterSchemaCampos(tenantId);
  const acesso = new Map(permissoes.map((linha) => [`${linha.role}:${linha.field_id}`, linha.access]));
  return {
    papeis: [...PAPEIS_COM_PERMISSAO],
    campos: campos
      .filter((campo) => campo.id)
      .map((campo) => ({
        id: campo.id,
        chave: campo.chave,
        label: campo.label,
        camada: campo.camada,
        podeRestringir: !CHAVES_SEM_RESTRICAO.includes(campo.chave),
        acessos: Object.fromEntries(
          PAPEIS_COM_PERMISSAO.map((papel) => [papel, acesso.get(`${papel}:${campo.id}`) ?? ACESSOS_CAMPO.EDITAR]),
        ),
      })),
  };
}

/**
 * PUT: por papel, o mapa inteiro `{ [campoId]: acesso }` (campo ausente =
 * `edit`). Papel que não veio no body fica como está.
 *
 * @param {string} tenantId
 * @param {Record<string, Record<string, string>>} porPapel
 */
export async function salvarPermissoes(tenantId, porPapel) {
  const { campos } = await obterSchemaCampos(tenantId);
  const campoPorId = new Map(campos.filter((campo) => campo.id).map((campo) => [campo.id, campo]));

  const paraGravar = Object.entries(porPapel).map(([papel, acessos]) => {
    const restricoes = [];
    for (const [campoId, acesso] of Object.entries(acessos)) {
      const campo = campoPorId.get(campoId);
      if (!campo) throw erroDeValidacao(`${papel}.${campoId}`, 'Escolha um campo ativo');
      if (acesso === ACESSOS_CAMPO.EDITAR) continue;
      if (CHAVES_SEM_RESTRICAO.includes(campo.chave)) {
        throw erroDeValidacao(`${papel}.${campoId}`, `"${campo.label}" é sempre editável`);
      }
      restricoes.push({ campoId, acesso, chave: campo.chave });
    }
    const contatoTravado = CHAVES_CONTATO.every((chave) => restricoes.some((restricao) => restricao.chave === chave));
    if (contatoTravado) {
      throw erroDeValidacao(papel, 'Deixe e-mail ou telefone editável: sem um dos dois, não dá pra criar lead');
    }
    return { papel, restricoes: restricoes.map(({ campoId, acesso }) => ({ campoId, acesso })) };
  });

  for (const { papel, restricoes } of paraGravar) {
    await substituirPermissoesDoPapel(tenantId, papel, restricoes);
  }
  await invalidarSchemaCampos(tenantId);
  return obterPermissoes(tenantId);
}
