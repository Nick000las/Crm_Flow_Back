import { describe, it, expect, vi, beforeEach } from 'vitest';
import { featureAtiva } from '#core/tenant/feature-flags.js';
import { HTTP_STATUS, ROLES } from '#shared/constants/index.js';
import { substituirPermissoesDoPapel } from '../adapters/crm-field-permissions.repository.js';
import { CAMADA } from '../constants.js';
import { obterSchemaCampos } from './field-schema.service.js';
import {
  contatoNaBusca,
  garantirEscritaPermitida,
  identificadorVisivel,
  obterSchemaDoPapel,
  salvarPermissoes,
  schemaDoPapel,
} from './permissoes.service.js';

vi.mock('#core/tenant/feature-flags.js', () => ({ featureAtiva: vi.fn() }));
vi.mock('../adapters/crm-field-permissions.repository.js', () => ({ substituirPermissoesDoPapel: vi.fn() }));
vi.mock('./field-schema.service.js', () => ({ obterSchemaCampos: vi.fn(), invalidarSchemaCampos: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-000000000001';
const ID = {
  nome: '00000000-0000-0000-0000-0000000000a1',
  email: '00000000-0000-0000-0000-0000000000a2',
  telefone: '00000000-0000-0000-0000-0000000000a3',
  status: '00000000-0000-0000-0000-0000000000a4',
  cnpj: '00000000-0000-0000-0000-0000000000a5',
  salario: '00000000-0000-0000-0000-0000000000a6',
  motivo: '00000000-0000-0000-0000-0000000000a7',
};

const CAMPOS = [
  { id: ID.nome, chave: 'nome', label: 'Nome', tipo: 'texto', camada: CAMADA.CAMADA_1 },
  { id: ID.email, chave: 'email', label: 'E-mail', tipo: 'email', camada: CAMADA.CAMADA_1 },
  { id: ID.telefone, chave: 'telefone', label: 'Telefone', tipo: 'telefone', camada: CAMADA.CAMADA_1 },
  { id: ID.status, chave: 'status', label: 'Status', tipo: 'selecao', camada: CAMADA.CAMADA_1 },
  { id: ID.cnpj, chave: 'cnpj', label: 'CNPJ', tipo: 'cnpj', camada: CAMADA.CAMADA_2 },
  { id: ID.salario, chave: 'salario', label: 'Salário', tipo: 'numero', camada: CAMADA.CAMADA_3 },
  { id: ID.motivo, chave: 'motivo', label: 'Motivo', tipo: 'texto', camada: CAMADA.CAMADA_3 },
];
const resumo = (chave) => {
  const { id, label, tipo, camada } = /** @type {any} */ (CAMPOS.find((campo) => campo.chave === chave));
  return { id, chave, label, tipo, camada };
};

const SCHEMA = {
  visibilidade: [],
  listas: {},
  campos: CAMPOS,
  definicoes: [
    { id: ID.salario, chave: 'salario', label: 'Salário', tipo: 'numero' },
    { id: ID.motivo, chave: 'motivo', label: 'Motivo', tipo: 'texto' },
  ],
  regras: [
    { id: 'r-motivo', kind: 'required_from_status', ativo: true, alvo: resumo('motivo'), condicao: { status: ['perdido'] }, efeito: { obrigatorio: true } },
    { id: 'r-cnpj', kind: 'conditional', ativo: true, alvo: resumo('status'), condicao: { campo: resumo('cnpj'), operador: 'vazio' }, efeito: { obrigatorio: true } },
  ],
  permissoes: [
    { field_id: ID.email, role: ROLES.OPERADOR, access: 'hidden' },
    { field_id: ID.cnpj, role: ROLES.OPERADOR, access: 'hidden' },
    { field_id: ID.salario, role: ROLES.OPERADOR, access: 'hidden' },
    { field_id: ID.motivo, role: ROLES.OPERADOR, access: 'view' },
    // Restringir o Nome não vale (sempre editável).
    { field_id: ID.nome, role: ROLES.OPERADOR, access: 'hidden' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  featureAtiva.mockResolvedValue(true);
  obterSchemaCampos.mockResolvedValue(SCHEMA);
});

describe('schemaDoPapel', () => {
  const doOperador = schemaDoPapel(/** @type {any} */ (SCHEMA), ROLES.OPERADOR);

  it('oculto sai de campos e definições; o resto ganha `acesso`; Nome nunca é restringido', () => {
    expect(doOperador.campos.map((campo) => [campo.chave, campo.acesso])).toEqual([
      ['nome', 'edit'],
      ['telefone', 'edit'],
      ['status', 'edit'],
      ['motivo', 'view'],
    ]);
    expect(doOperador.definicoes.map((definicao) => definicao.chave)).toEqual(['motivo']);
  });

  it('regras: só as que o papel cumpre (alvo editável, condição sobre campo visível)', () => {
    expect(doOperador.regras).toEqual([]);
  });

  it('DONO e MASTER: o schema intacto', () => {
    expect(schemaDoPapel(/** @type {any} */ (SCHEMA), ROLES.DONO)).toBe(SCHEMA);
    expect(schemaDoPapel(/** @type {any} */ (SCHEMA), ROLES.MASTER)).toBe(SCHEMA);
  });

  it('busca textual: e-mail oculto sai; identificador oculto sai', () => {
    expect(contatoNaBusca(doOperador)).toEqual({ email: false, telefone: true });
    expect(identificadorVisivel({ chave: 'cnpj' }, doOperador)).toBeNull();
    expect(identificadorVisivel({ chave: 'telefone' }, doOperador)).toEqual({ chave: 'telefone' });
  });
});

describe('obterSchemaDoPapel', () => {
  it('sem a flag ou sem papel: o schema inteiro', async () => {
    expect(await obterSchemaDoPapel(TENANT, undefined)).toBe(SCHEMA);
    featureAtiva.mockResolvedValue(false);
    expect(await obterSchemaDoPapel(TENANT, ROLES.OPERADOR)).toBe(SCHEMA);
  });
});

describe('garantirEscritaPermitida', () => {
  const doOperador = schemaDoPapel(/** @type {any} */ (SCHEMA), ROLES.OPERADOR);

  it('"só ver" ou oculto no payload (inclusive null) → 403 com os campos', () => {
    expect(() => garantirEscritaPermitida(doOperador, { nome: 'Ana', email: null, customFields: { motivo: 'x' } })).toThrow(
      expect.objectContaining({
        statusCode: HTTP_STATUS.FORBIDDEN,
        fields: { email: [expect.any(String)], motivo: [expect.any(String)] },
      }),
    );
  });

  it('chave omitida passa; o que ele edita passa', () => {
    expect(() => garantirEscritaPermitida(doOperador, { nome: 'Ana', telefone: '11999999999', email: undefined })).not.toThrow();
  });

  it('sem restrição (DONO): nada é conferido', () => {
    expect(() => garantirEscritaPermitida(/** @type {any} */ (SCHEMA), { email: 'a@x.com' })).not.toThrow();
  });
});

describe('salvarPermissoes', () => {
  it('grava só as restrições e devolve a matriz', async () => {
    const resposta = await salvarPermissoes(TENANT, { OPERADOR: { [ID.cnpj]: 'hidden', [ID.status]: 'edit', [ID.motivo]: 'view' } });
    expect(substituirPermissoesDoPapel).toHaveBeenCalledWith(TENANT, 'OPERADOR', [
      { campoId: ID.cnpj, acesso: 'hidden' },
      { campoId: ID.motivo, acesso: 'view' },
    ]);
    expect(resposta.campos.find((campo) => campo.chave === 'nome')).toMatchObject({ podeRestringir: false });
  });

  it('400: Nome restringido, campo inexistente, e-mail e telefone travados juntos', async () => {
    const invalido = { statusCode: HTTP_STATUS.BAD_REQUEST };
    await expect(salvarPermissoes(TENANT, { OPERADOR: { [ID.nome]: 'view' } })).rejects.toMatchObject(invalido);
    await expect(salvarPermissoes(TENANT, { OPERADOR: { [TENANT]: 'view' } })).rejects.toMatchObject(invalido);
    await expect(salvarPermissoes(TENANT, { OPERADOR: { [ID.email]: 'hidden', [ID.telefone]: 'view' } })).rejects.toMatchObject(invalido);
    expect(substituirPermissoesDoPapel).not.toHaveBeenCalled();
  });
});
