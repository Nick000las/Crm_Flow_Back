import { Buffer } from 'node:buffer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '#api/app.js';
import { signAccessToken } from '#core/auth/jwt.js';
import { loadEnv } from '#core/config/env.js';
import { invalidarAcessoModulo } from '#core/tenant/module-access.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
import { EXPORTACAO } from '../constants.js';
import { atualizarLeadExistente, pesquisarLeads, registrarNovoLead } from '../services/leads.service.js';
import { exportarLeads } from '../services/export.service.js';
import { previsualizarImportacao } from '../services/import.service.js';
import { listarResponsaveisPossiveis } from '../services/usuarios.service.js';

/**
 * Testes de rota do CRM: autenticação, módulo contratado, RBAC e validação
 * na borda HTTP. Services mockados — regra de negócio já tem teste próprio.
 */

const findFirst = vi.fn();

vi.mock('#core/db/tenantClient.js', () => ({
  getAdminClient: vi.fn(() => ({ tenantModule: { findFirst } })),
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
  reordenarDefinicoesDoTenant: vi.fn(),
  removerDefinicao: vi.fn(),
}));
vi.mock('../services/field-visibility.service.js', () => ({
  listarVisibilidadeDoTenant: vi.fn(),
  atualizarVisibilidadeDoTenant: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks();
  invalidarAcessoModulo(TENANT);
  findFirst.mockResolvedValue({ id: 'modulo-crm' }); // CRM contratado por padrão
  pesquisarLeads.mockResolvedValue({ itens: [], total: 0, pagina: 1, tamanho: TAMANHO });
});

describe('autenticação e módulo contratado', () => {
  it('sem token → 401', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/crm/leads' });
    expect(resposta.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('tenant sem o módulo CRM → 403 MODULE_NOT_ENABLED', async () => {
    findFirst.mockResolvedValue(null);
    const resposta = await app.inject({ method: 'GET', url: '/crm/leads', headers: autorizado(tokenDono) });
    expect(resposta.statusCode).toBe(HTTP_STATUS.FORBIDDEN);
    expect(resposta.json().error.code).toBe(ERROR_CODES.MODULE_NOT_ENABLED);
    expect(pesquisarLeads).not.toHaveBeenCalled();
  });

  it('consulta o módulo certo do tenant do token', async () => {
    await app.inject({ method: 'GET', url: '/crm/leads', headers: autorizado(tokenOperador) });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: TENANT, moduleKey: 'crm', disabledAt: null } }),
    );
  });
});

describe('RBAC', () => {
  const ROTAS_DE_GESTAO = [
    ['POST', '/crm/field-definitions'],
    ['PUT', '/crm/field-definitions/reorder'],
    ['DELETE', `/crm/field-definitions/${LEAD}`],
    ['PUT', '/crm/field-visibility'],
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
    for (const url of ['/crm/field-definitions', '/crm/field-visibility', '/crm/leads/fields', '/crm/leads']) {
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
