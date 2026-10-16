import { Buffer } from 'node:buffer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '#api/app.js';
import { signAccessToken } from '#core/auth/jwt.js';
import { loadEnv } from '#core/config/env.js';
import { encerrarCache } from '#core/cache/cache.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
import { EXPORTACAO } from '../constants.js';
import { editarDefinicao } from '../services/field-definitions.service.js';
import { atualizarOpcao, criarOpcao, listarListas } from '../services/listas.service.js';
import { atualizarLeadExistente, pesquisarLeads, registrarNovoLead } from '../services/leads.service.js';
import { exportarLeads } from '../services/export.service.js';
import { previsualizarImportacao } from '../services/import.service.js';
import { listarResponsaveisPossiveis } from '../services/usuarios.service.js';
import { atualizarConfiguracaoCampo, reordenarCampos } from '../services/configuracoes-campos.service.js';
import { listarCamposDoTenant } from '../services/leads.service.js';

/**
 * Testes de rota do CRM: autenticação, módulo contratado, RBAC e validação
 * na borda HTTP. Services mockados — regra de negócio já tem teste próprio.
 */

const findManyModulos = vi.fn();
const findManyFeatures = vi.fn();

vi.mock('#core/db/tenantClient.js', () => ({
  getAdminClient: vi.fn(() => ({ tenantModule: { findMany: findManyModulos }, tenantModuleFeature: { findMany: findManyFeatures } })),
  getTenantClient: vi.fn(),
  disconnectDatabase: vi.fn(),
}));

vi.mock('../services/leads.service.js', () => ({
  buscarLeadFormatado: vi.fn(),
  registrarNovoLead: vi.fn(),
  atualizarLeadExistente: vi.fn(),
  excluirLead: vi.fn(),
  listarCamposDoTenant: vi.fn(),
  pesquisarLeads: vi.fn(),
}));
vi.mock('../services/field-definitions.service.js', () => ({
  listarDefinicoesPorTenant: vi.fn(),
  criarNovaDefinicao: vi.fn(),
  editarDefinicao: vi.fn(),
  removerDefinicao: vi.fn(),
}));
vi.mock('../services/filter-views.service.js', () => ({
  listarViews: vi.fn(),
  salvarView: vi.fn(),
  excluirView: vi.fn(),
}));
vi.mock('../services/import.service.js', () => ({
  previsualizarImportacao: vi.fn(),
  validarImportacao: vi.fn(),
  confirmarImportacao: vi.fn(),
  obterStatusImportacao: vi.fn(),
  encerrarImportacao: vi.fn(),
}));
vi.mock('../services/export.service.js', () => ({ exportarLeads: vi.fn() }));
vi.mock('../services/usuarios.service.js', () => ({ listarResponsaveisPossiveis: vi.fn() }));
vi.mock('../services/listas.service.js', () => ({
  listarListas: vi.fn().mockResolvedValue({}),
  criarOpcao: vi.fn().mockResolvedValue({ id: 'nova' }),
  atualizarOpcao: vi.fn().mockResolvedValue({}),
  reordenarLista: vi.fn().mockResolvedValue([]),
  excluirOpcao: vi.fn().mockResolvedValue({ removido: true }),
}));
vi.mock('../services/configuracoes-campos.service.js', () => ({
  listarConfiguracaoCampos: vi.fn().mockResolvedValue([]),
  atualizarConfiguracaoCampo: vi.fn().mockResolvedValue({}),
  reordenarCampos: vi.fn().mockResolvedValue([]),
  restaurarOrdemPadrao: vi.fn().mockResolvedValue([]),
}));

const TENANT = '00000000-0000-0000-0000-000000000001';
const LEAD = '00000000-0000-0000-0000-000000000009';
const TAMANHO_EXCESSIVO = 999;
const VALOR_LEAD = 1500.5;
const PAGINA = 2;
const TAMANHO = 10;

let app;
let tokenDono;
let tokenOperador;

function autorizado(token) {
  return { authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  app = await buildApp({
    config: loadEnv({
      NODE_ENV: 'test',
      CORS_ORIGIN: 'http://localhost:5173',
      JWT_SECRET: 'access-secret-with-at-least-32-characters',
      JWT_REFRESH_SECRET: 'refresh-secret-with-at-least-32-characters',
    }),
    logger: false,
  });
  tokenDono = signAccessToken(app, { tenantId: TENANT, userId: 'u-dono', role: 'DONO' });
  tokenOperador = signAccessToken(app, { tenantId: TENANT, userId: 'u-op', role: 'OPERADOR' });
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  await encerrarCache();
  findManyFeatures.mockResolvedValue([]);
  findManyModulos.mockResolvedValue([{ moduleKey: 'crm' }]); // CRM contratado por padrão
  pesquisarLeads.mockResolvedValue({ itens: [], total: 0, pagina: 1, tamanho: TAMANHO });
});

describe('autenticação e módulo contratado', () => {
  it('sem token → 401', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/crm/leads' });
    expect(resposta.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect(findManyModulos).not.toHaveBeenCalled();
  });

  it('tenant sem o módulo CRM → 403 MODULE_NOT_ENABLED', async () => {
    findManyModulos.mockResolvedValue([]);
    const resposta = await app.inject({ method: 'GET', url: '/crm/leads', headers: autorizado(tokenDono) });
    expect(resposta.statusCode).toBe(HTTP_STATUS.FORBIDDEN);
    expect(resposta.json().error.code).toBe(ERROR_CODES.MODULE_NOT_ENABLED);
    expect(pesquisarLeads).not.toHaveBeenCalled();
  });

  it('consulta o módulo certo do tenant do token', async () => {
    await app.inject({ method: 'GET', url: '/crm/leads', headers: autorizado(tokenOperador) });
    expect(findManyModulos).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: TENANT, disabledAt: null } }),
    );
  });
});

describe('RBAC', () => {
  const ROTAS_DE_GESTAO = [
    ['POST', '/crm/field-definitions'],
    ['DELETE', `/crm/field-definitions/${LEAD}`],
    ['POST', '/crm/import/preview'],
    ['GET', `/crm/import/${LEAD}`],
    ['POST', '/crm/export'],
  ];

  it.each(ROTAS_DE_GESTAO)('OPERADOR em %s %s → 403', async (method, url) => {
    const resposta = await app.inject({ method, url, headers: autorizado(tokenOperador), payload: {} });
    expect(resposta.statusCode).toBe(HTTP_STATUS.FORBIDDEN);
    expect(resposta.json().error.code).toBe(ERROR_CODES.FORBIDDEN);
  });

  it('OPERADOR continua lendo a configuração e mexendo em leads', async () => {
    for (const url of ['/crm/field-definitions', '/crm/configuracoes/campos', '/crm/leads/fields', '/crm/leads']) {
      const resposta = await app.inject({ method: 'GET', url, headers: autorizado(tokenOperador) });
      expect(resposta.statusCode, url).toBe(HTTP_STATUS.OK);
    }
  });

  it('OPERADOR lista os usuários do tenant (responsáveis possíveis)', async () => {
    listarResponsaveisPossiveis.mockResolvedValue([{ id: 'u-1', nome: 'Ana' }]);
    const resposta = await app.inject({ method: 'GET', url: '/crm/usuarios', headers: autorizado(tokenOperador) });
    expect(resposta.statusCode).toBe(HTTP_STATUS.OK);
    expect(resposta.json().data).toEqual([{ id: 'u-1', nome: 'Ana' }]);
    expect(listarResponsaveisPossiveis).toHaveBeenCalledWith(TENANT);
  });

  it('DONO exporta e recebe o xlsx', async () => {
    exportarLeads.mockResolvedValue(Buffer.from('xlsx'));
    const resposta = await app.inject({
      method: 'POST',
      url: '/crm/export',
      headers: autorizado(tokenDono),
      payload: { colunas: ['nome'] },
    });
    expect(resposta.statusCode).toBe(HTTP_STATUS.OK);
    expect(resposta.headers['content-type']).toBe(EXPORTACAO.CONTENT_TYPE);
    expect(resposta.headers['content-disposition']).toContain(EXPORTACAO.NOME_ARQUIVO);
  });
});

describe('validação na borda', () => {
  it('GET /crm/leads repassa a paginação da query string', async () => {
    await app.inject({ method: 'GET', url: `/crm/leads?pagina=${PAGINA}&tamanho=${TAMANHO}`, headers: autorizado(tokenOperador) });
    expect(pesquisarLeads).toHaveBeenCalledWith(TENANT, { filtros: [], paginacao: { pagina: PAGINA, tamanho: TAMANHO } });
  });

  it('GET /crm/leads com tamanho acima do máximo → 400', async () => {
    const resposta = await app.inject({
      method: 'GET',
      url: `/crm/leads?tamanho=${TAMANHO_EXCESSIVO}`,
      headers: autorizado(tokenOperador),
    });
    expect(resposta.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
  });

  it('POST /crm/leads aceita lead sem estágio e com valor', async () => {
    registrarNovoLead.mockResolvedValue({ id: LEAD });
    const resposta = await app.inject({
      method: 'POST',
      url: '/crm/leads',
      headers: autorizado(tokenOperador),
      payload: { nome: 'Ana', email: 'ana@x.com', valor: VALOR_LEAD },
    });
    expect(resposta.statusCode).toBe(HTTP_STATUS.CREATED);
    expect(registrarNovoLead).toHaveBeenCalledWith(
      TENANT,
      { nome: 'Ana', email: 'ana@x.com', valor: VALOR_LEAD },
      'u-op',
    );
  });

  it('PUT aceita null pra limpar campo, mas não em nome', async () => {
    atualizarLeadExistente.mockResolvedValue({ id: LEAD });
    const limpar = await app.inject({
      method: 'PUT',
      url: `/crm/leads/${LEAD}`,
      headers: autorizado(tokenOperador),
      payload: { email: null, cargo: null, customFields: { origem: null } },
    });
    expect(limpar.statusCode).toBe(HTTP_STATUS.OK);
    expect(atualizarLeadExistente).toHaveBeenCalledWith(TENANT, LEAD, {
      email: null,
      cargo: null,
      customFields: { origem: null },
    });

    const semNome = await app.inject({
      method: 'PUT',
      url: `/crm/leads/${LEAD}`,
      headers: autorizado(tokenOperador),
      payload: { nome: null },
    });
    expect(semNome.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
  });

  it('import sem multipart → 400', async () => {
    const resposta = await app.inject({
      method: 'POST',
      url: '/crm/import/preview',
      headers: autorizado(tokenDono),
      payload: {},
    });
    expect(resposta.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(previsualizarImportacao).not.toHaveBeenCalled();
  });

  it('import multipart sem arquivo → 400', async () => {
    const boundary = 'teste-boundary';
    const resposta = await app.inject({
      method: 'POST',
      url: '/crm/import/preview',
      headers: { ...autorizado(tokenDono), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: `--${boundary}\r\nContent-Disposition: form-data; name="x"\r\n\r\n1\r\n--${boundary}--\r\n`,
    });
    expect(resposta.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(resposta.json().error.message).toContain('arquivo');
  });
});

describe('Configurações → Campos (M2)', () => {
  const CAMPO = '00000000-0000-0000-0000-000000000077';
  const ESCRITAS = [
    ['PUT', '/crm/configuracoes/campos/ordem', { ids: [CAMPO] }],
    ['POST', '/crm/configuracoes/campos/ordem/padrao', {}],
    ['PUT', `/crm/configuracoes/campos/${CAMPO}`, { label: 'X' }],
  ];

  it.each(ESCRITAS)('OPERADOR em %s %s → 403 FORBIDDEN', async (method, url, payload) => {
    const resposta = await app.inject({ method, url, headers: autorizado(tokenOperador), payload });
    expect(resposta.statusCode).toBe(HTTP_STATUS.FORBIDDEN);
    expect(resposta.json().error.code).toBe(ERROR_CODES.FORBIDDEN);
  });

  it('DONO, sem nenhuma feature flag ligada: repassa a visibilidade parcial e a ordem', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: `/crm/configuracoes/campos/${CAMPO}`,
      headers: autorizado(tokenDono),
      payload: { visibilidade: { table: false } },
    });
    expect(put.statusCode).toBe(HTTP_STATUS.OK);
    expect(atualizarConfiguracaoCampo).toHaveBeenCalledWith(TENANT, CAMPO, { visibilidade: { table: false } });

    await app.inject({
      method: 'PUT',
      url: '/crm/configuracoes/campos/ordem',
      headers: autorizado(tokenDono),
      payload: { ids: [CAMPO] },
    });
    expect(reordenarCampos).toHaveBeenCalledWith(TENANT, [CAMPO]);
  });

  it('contexto inventado ou body vazio → 400', async () => {
    for (const payload of [{ visibilidade: { kanban: false } }, {}]) {
      const resposta = await app.inject({
        method: 'PUT',
        url: `/crm/configuracoes/campos/${CAMPO}`,
        headers: autorizado(tokenDono),
        payload,
      });
      expect(resposta.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
    }
    expect(atualizarConfiguracaoCampo).not.toHaveBeenCalled();
  });

  it('GET /crm/leads/fields?contexto= repassa o contexto e rejeita o inválido (sem precisar de flag)', async () => {
    listarCamposDoTenant.mockResolvedValue([]);
    const ok = await app.inject({ method: 'GET', url: '/crm/leads/fields?contexto=table', headers: autorizado(tokenOperador) });
    expect(ok.statusCode).toBe(HTTP_STATUS.OK);
    expect(listarCamposDoTenant).toHaveBeenCalledWith(TENANT, 'table');

    const invalido = await app.inject({ method: 'GET', url: '/crm/leads/fields?contexto=x', headers: autorizado(tokenOperador) });
    expect(invalido.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
  });
});

describe('rotas removidas', () => {
  it.each([
    ['GET', '/crm/field-visibility'],
    ['PUT', '/crm/field-visibility'],
  ])('%s %s não existe mais (404)', async (method, url) => {
    const resposta = await app.inject({ method, url, headers: autorizado(tokenDono), payload: [] });
    expect(resposta.statusCode).toBe(HTTP_STATUS.NOT_FOUND);
  });

  it('PUT /crm/field-definitions/reorder não existe mais: "reorder" cai em /:id e não é um id', async () => {
    const resposta = await app.inject({
      method: 'PUT',
      url: '/crm/field-definitions/reorder',
      headers: autorizado(tokenDono),
      payload: [],
    });
    expect(resposta.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(editarDefinicao).not.toHaveBeenCalled();
  });
});

describe('Configurações → Listas (M3, flag crm.listas)', () => {
  const OPCAO = '00000000-0000-0000-0000-000000000088';
  const COM_FLAG = [{ featureKey: 'crm.listas' }];

  it('sem a flag → 403 FEATURE_NOT_ENABLED', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/crm/configuracoes/listas', headers: autorizado(tokenDono) });
    expect(resposta.statusCode).toBe(HTTP_STATUS.FORBIDDEN);
    expect(resposta.json().error.details).toEqual({ featureKey: 'crm.listas' });
    expect(listarListas).not.toHaveBeenCalled();
  });

  it('OPERADOR lê, mas não escreve (403 FORBIDDEN mesmo com a flag)', async () => {
    findManyFeatures.mockResolvedValue(COM_FLAG);
    const leitura = await app.inject({ method: 'GET', url: '/crm/configuracoes/listas', headers: autorizado(tokenOperador) });
    expect(leitura.statusCode).toBe(HTTP_STATUS.OK);

    const escrita = await app.inject({
      method: 'POST',
      url: '/crm/configuracoes/listas/fonte_lead',
      headers: autorizado(tokenOperador),
      payload: { label: 'Feira' },
    });
    expect(escrita.json().error.code).toBe(ERROR_CODES.FORBIDDEN);
  });

  it('DONO cria e edita; lista, cor e corpo inválidos → 400 na borda', async () => {
    findManyFeatures.mockResolvedValue(COM_FLAG);
    const criada = await app.inject({
      method: 'POST',
      url: '/crm/configuracoes/listas/status',
      headers: autorizado(tokenDono),
      payload: { label: 'Pausado', category: 'aberto', color: '#AABBCC' },
    });
    expect(criada.statusCode).toBe(HTTP_STATUS.CREATED);
    expect(criarOpcao).toHaveBeenCalledWith(TENANT, 'status', { label: 'Pausado', category: 'aberto', color: '#AABBCC' });

    await app.inject({
      method: 'PUT',
      url: `/crm/configuracoes/listas/status/${OPCAO}`,
      headers: autorizado(tokenDono),
      payload: { ativo: false },
    });
    expect(atualizarOpcao).toHaveBeenCalledWith(TENANT, 'status', OPCAO, { ativo: false });

    for (const [url, payload] of [
      ['/crm/configuracoes/listas/inventada', { label: 'X' }],
      ['/crm/configuracoes/listas/tag', { label: 'X', color: 'azul' }],
      ['/crm/configuracoes/listas/tag', { label: 'X', key: 'forcada' }],
    ]) {
      const resposta = await app.inject({ method: 'POST', url, headers: autorizado(tokenDono), payload });
      expect(resposta.statusCode, url).toBe(HTTP_STATUS.BAD_REQUEST);
    }
  });
});
