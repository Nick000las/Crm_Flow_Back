import { Buffer } from 'node:buffer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '#api/app.js';
import { signAccessToken } from '#core/auth/jwt.js';
import { loadEnv } from '#core/config/env.js';
import { encerrarCache } from '#core/cache/cache.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
import { DIAS_ESFRIAR, EXPORTACAO } from '../constants.js';
import { editarDefinicao } from '../services/field-definitions.service.js';
import { atualizarOpcao, criarOpcao, listarListas } from '../services/listas.service.js';
import { removerMeu, salvarMeu, salvarPadrao } from '../services/layout.service.js';
import { atualizarLeadExistente, pesquisarLeads, registrarNovoLead } from '../services/leads.service.js';
import { exportarLeads } from '../services/export.service.js';
import { arquivarLead, desarquivarLead, excluirLead, restaurarLead } from '../services/arquivo.service.js';
import { editarAtividade, registrarAtividade, removerAtividade } from '../services/atividades.service.js';
import { listarHistorico } from '../services/historico.service.js';
import { salvarRegras } from '../services/duplicidade.service.js';
import { mesclarLeads } from '../services/mesclagem.service.js';
import { criarRegra, editarRegra, removerRegra } from '../services/regras.service.js';
import { salvarInatividade } from '../services/inatividade.service.js';
import { checarDuplicados } from '../services/leads.service.js';
import { confirmarImportacao } from '../services/import.service.js';
import { previsualizarImportacao } from '../services/import.service.js';
import { listarResponsaveisPossiveis } from '../services/usuarios.service.js';
import { atualizarConfiguracaoCampo, reordenarCampos } from '../services/configuracoes-campos.service.js';
import { listarCamposDoTenant } from '../services/leads.service.js';
import { editarLeadsEmMassa } from '../services/leads-bulk.service.js';
import { consultarParaLupa, salvarConfigCnpj } from '../services/cnpj.service.js';
import { excluirGrupo, salvarConfigDistribuicao } from '../services/distribuicao.service.js';
import { salvarPermissoes } from '../services/permissoes.service.js';

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
  checarDuplicados: vi.fn().mockResolvedValue({ duplicados: [] }),
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
vi.mock('../services/atividades.service.js', () => ({
  listarTiposDeAtividade: vi.fn().mockResolvedValue([{ key: 'ligacao', label: 'Ligação', ativo: true }]),
  listarAtividades: vi.fn().mockResolvedValue([]),
  registrarAtividade: vi.fn().mockResolvedValue({ id: 'at' }),
  editarAtividade: vi.fn().mockResolvedValue({ id: 'at' }),
  removerAtividade: vi.fn().mockResolvedValue({ removido: true }),
}));
vi.mock('../services/duplicidade.service.js', () => ({
  listarRegras: vi.fn().mockResolvedValue({ regras: [], configurado: false }),
  salvarRegras: vi.fn().mockResolvedValue({ regras: [], configurado: true }),
}));
vi.mock('../services/inatividade.service.js', () => ({
  listarInatividade: vi.fn().mockResolvedValue([]),
  salvarInatividade: vi.fn().mockResolvedValue([]),
}));
vi.mock('../services/regras.service.js', () => ({
  listarRegras: vi.fn().mockResolvedValue([]),
  criarRegra: vi.fn().mockResolvedValue({ id: 'regra' }),
  editarRegra: vi.fn().mockResolvedValue({ id: 'regra' }),
  removerRegra: vi.fn().mockResolvedValue({ removido: true }),
}));
vi.mock('../services/cnpj.service.js', () => ({
  consultarParaLupa: vi.fn().mockResolvedValue({ cnpj: '11222333000181', status: 'ok', dados: {}, sugestao: [] }),
  listarConfigCnpj: vi.fn().mockResolvedValue({ ativo: true, modo: 'manual' }),
  salvarConfigCnpj: vi.fn().mockResolvedValue({ ativo: true, modo: 'automatico' }),
  encerrarEnriquecimento: vi.fn(),
}));
vi.mock('../services/permissoes.service.js', () => ({
  obterPermissoes: vi.fn().mockResolvedValue({ papeis: ['OPERADOR'], campos: [] }),
  salvarPermissoes: vi.fn().mockResolvedValue({ papeis: ['OPERADOR'], campos: [] }),
}));
vi.mock('../services/distribuicao.service.js', () => ({
  obterConfigDistribuicao: vi.fn().mockResolvedValue({ ativo: false, fallback: 'rodizio_geral', regras: [], grupos: [] }),
  salvarConfigDistribuicao: vi.fn().mockResolvedValue({ ativo: true }),
  criarGrupo: vi.fn().mockResolvedValue({ id: 'grupo' }),
  editarGrupo: vi.fn().mockResolvedValue({ id: 'grupo' }),
  excluirGrupo: vi.fn().mockResolvedValue({ removido: true }),
}));
vi.mock('../services/leads-bulk.service.js', () => ({
  editarLeadsEmMassa: vi.fn().mockResolvedValue({ total: 1, atualizados: 1, inalterados: 0, falhas: 0, resultados: [] }),
}));
vi.mock('../services/mesclagem.service.js', () => ({ mesclarLeads: vi.fn().mockResolvedValue({ id: 'lead' }) }));
vi.mock('../services/historico.service.js', () => ({ listarHistorico: vi.fn().mockResolvedValue({ itens: [] }) }));
vi.mock('../services/arquivo.service.js', () => ({
  arquivarLead: vi.fn().mockResolvedValue({ id: 'lead' }),
  desarquivarLead: vi.fn().mockResolvedValue({ id: 'lead' }),
  restaurarLead: vi.fn().mockResolvedValue({ id: 'lead' }),
  excluirLead: vi.fn().mockResolvedValue({ removido: true }),
}));
vi.mock('../services/usuarios.service.js', () => ({ listarResponsaveisPossiveis: vi.fn() }));
vi.mock('../services/layout.service.js', () => ({
  obterLayout: vi.fn().mockResolvedValue({ efetivo: {} }),
  salvarPadrao: vi.fn().mockResolvedValue({}),
  salvarMeu: vi.fn().mockResolvedValue({}),
  removerMeu: vi.fn().mockResolvedValue({}),
  identificadorDaBusca: vi.fn().mockResolvedValue(null),
}));
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
    expect(pesquisarLeads).toHaveBeenCalledWith(TENANT, { filtros: [], paginacao: { pagina: PAGINA, tamanho: TAMANHO } }, { papel: 'OPERADOR' });
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
      { papel: 'OPERADOR' }, // M13: o papel do token vai pro service
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
    expect(atualizarLeadExistente).toHaveBeenCalledWith(
      TENANT,
      LEAD,
      { email: null, cargo: null, customFields: { origem: null } },
      'u-op', // autor do histórico (M6)
      { papel: 'OPERADOR' },
    );

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
    expect(listarCamposDoTenant).toHaveBeenCalledWith(TENANT, 'table', { papel: 'OPERADOR' });

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

describe('Layout do lead (M4, flag crm.layout)', () => {
  const COM_FLAG = [{ featureKey: 'crm.layout' }];
  const LAYOUT = { identificador: 'id-cnpj', subtitulo: [], destaques: [], secoes: [], colunas: ['lead.valor'] };

  it('sem a flag → 403 FEATURE_NOT_ENABLED', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/crm/layout', headers: autorizado(tokenOperador) });
    expect(resposta.json().error.details).toEqual({ featureKey: 'crm.layout' });
  });

  it('OPERADOR não altera o padrão do tenant (403), mas salva e apaga o próprio override', async () => {
    findManyFeatures.mockResolvedValue(COM_FLAG);
    const padrao = await app.inject({ method: 'PUT', url: '/crm/layout/padrao', headers: autorizado(tokenOperador), payload: LAYOUT });
    expect(padrao.statusCode).toBe(HTTP_STATUS.FORBIDDEN);
    expect(padrao.json().error.code).toBe(ERROR_CODES.FORBIDDEN);
    expect(salvarPadrao).not.toHaveBeenCalled();

    const meu = await app.inject({
      method: 'PUT',
      url: '/crm/layout/meu',
      headers: autorizado(tokenOperador),
      payload: { colunas: ['lead.valor'] },
    });
    expect(meu.statusCode).toBe(HTTP_STATUS.OK);
    expect(salvarMeu).toHaveBeenCalledWith(TENANT, 'u-op', { colunas: ['lead.valor'] }, { papel: 'OPERADOR' });

    await app.inject({ method: 'DELETE', url: '/crm/layout/meu', headers: autorizado(tokenOperador) });
    expect(removerMeu).toHaveBeenCalledWith(TENANT, 'u-op', { papel: 'OPERADOR' });
  });

  it('DONO salva o padrão completo; incompleto, mais de 2 no subtítulo ou campo extra → 400', async () => {
    findManyFeatures.mockResolvedValue(COM_FLAG);
    const ok = await app.inject({ method: 'PUT', url: '/crm/layout/padrao', headers: autorizado(tokenDono), payload: LAYOUT });
    expect(ok.statusCode).toBe(HTTP_STATUS.OK);
    expect(salvarPadrao).toHaveBeenCalledWith(TENANT, 'u-dono', LAYOUT);

    for (const payload of [
      { identificador: 'id-cnpj' },
      { ...LAYOUT, subtitulo: ['a', 'b', 'c'] },
      { ...LAYOUT, extra: true },
    ]) {
      const resposta = await app.inject({ method: 'PUT', url: '/crm/layout/padrao', headers: autorizado(tokenDono), payload });
      expect(resposta.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
    }
  });
});

describe('Arquivo e lixeira (M5, flag crm.arquivo)', () => {
  const COM_FLAG = [{ featureKey: 'crm.arquivo' }];
  const ACOES = [
    ['arquivar', arquivarLead],
    ['desarquivar', desarquivarLead],
    ['restaurar', restaurarLead],
  ];

  it('sem a flag, arquivar/desarquivar/restaurar → 403 FEATURE_NOT_ENABLED', async () => {
    for (const [acao, service] of ACOES) {
      const resposta = await app.inject({ method: 'POST', url: `/crm/leads/${LEAD}/${acao}`, headers: autorizado(tokenOperador) });
      expect(resposta.statusCode, acao).toBe(HTTP_STATUS.FORBIDDEN);
      expect(resposta.json().error.details).toEqual({ featureKey: 'crm.arquivo' });
      expect(service).not.toHaveBeenCalled();
    }
  });

  it('com a flag, qualquer papel arquiva, desarquiva e restaura', async () => {
    findManyFeatures.mockResolvedValue(COM_FLAG);
    for (const [acao, service] of ACOES) {
      const resposta = await app.inject({ method: 'POST', url: `/crm/leads/${LEAD}/${acao}`, headers: autorizado(tokenOperador) });
      expect(resposta.statusCode, acao).toBe(HTTP_STATUS.OK);
      expect(service).toHaveBeenCalledWith(TENANT, LEAD, 'u-op', { papel: 'OPERADOR' });
    }
  });

  it('DELETE manda pra lixeira mesmo sem a flag; id inválido → 400', async () => {
    const ok = await app.inject({ method: 'DELETE', url: `/crm/leads/${LEAD}`, headers: autorizado(tokenOperador) });
    expect(ok.statusCode).toBe(HTTP_STATUS.OK);
    expect(excluirLead).toHaveBeenCalledWith(TENANT, LEAD, 'u-op');

    findManyFeatures.mockResolvedValue(COM_FLAG);
    const invalido = await app.inject({ method: 'POST', url: '/crm/leads/nao-e-uuid/arquivar', headers: autorizado(tokenDono) });
    expect(invalido.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
  });

  it('situacao inválida na busca → 400; export da lixeira → 400', async () => {
    const busca = await app.inject({
      method: 'POST',
      url: '/crm/leads/search',
      headers: autorizado(tokenDono),
      payload: { situacao: 'apagados' },
    });
    expect(busca.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(pesquisarLeads).not.toHaveBeenCalled();

    const exportacao = await app.inject({
      method: 'POST',
      url: '/crm/export',
      headers: autorizado(tokenDono),
      payload: { colunas: ['nome'], filtro: { situacao: 'lixeira' } },
    });
    expect(exportacao.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(exportarLeads).not.toHaveBeenCalled();
  });
});

describe('Atividades e histórico (M6, flag crm.atividades)', () => {
  const COM_FLAG = [{ featureKey: 'crm.atividades' }];
  const ATIVIDADE = '00000000-0000-0000-0000-0000000000a1';
  const TAMANHO_HISTORICO = 20;
  const TAMANHO_HISTORICO_EXCESSIVO = 500;

  it('sem a flag → 403 nas atividades e no histórico', async () => {
    for (const url of [`/crm/leads/${LEAD}/atividades`, `/crm/leads/${LEAD}/historico`]) {
      const resposta = await app.inject({ method: 'GET', url, headers: autorizado(tokenOperador) });
      expect(resposta.statusCode, url).toBe(HTTP_STATUS.FORBIDDEN);
      expect(resposta.json().error.details).toEqual({ featureKey: 'crm.atividades' });
    }
  });

  it('tipos de atividade só com crm.atividades (sem crm.listas)', async () => {
    const sem = await app.inject({ method: 'GET', url: '/crm/atividades/tipos', headers: autorizado(tokenOperador) });
    expect(sem.statusCode).toBe(HTTP_STATUS.FORBIDDEN);

    findManyFeatures.mockResolvedValue(COM_FLAG); // só crm.atividades
    await encerrarCache(); // a 1ª chamada guardou "sem flag" no cache
    const com = await app.inject({ method: 'GET', url: '/crm/atividades/tipos', headers: autorizado(tokenOperador) });
    expect(com.statusCode).toBe(HTTP_STATUS.OK);
    expect(com.json().data).toEqual([{ key: 'ligacao', label: 'Ligação', ativo: true }]);
  });

  it('OPERADOR registra (201, autor do token), edita e remove', async () => {
    findManyFeatures.mockResolvedValue(COM_FLAG);
    const criada = await app.inject({
      method: 'POST',
      url: `/crm/leads/${LEAD}/atividades`,
      headers: autorizado(tokenOperador),
      payload: { tipo: 'ligacao', titulo: '  Ligar  ', concluida: true },
    });
    expect(criada.statusCode).toBe(HTTP_STATUS.CREATED);
    expect(registrarAtividade).toHaveBeenCalledWith(TENANT, LEAD, { tipo: 'ligacao', titulo: 'Ligar', concluida: true }, 'u-op');

    const editada = await app.inject({
      method: 'PUT',
      url: `/crm/leads/${LEAD}/atividades/${ATIVIDADE}`,
      headers: autorizado(tokenOperador),
      payload: { concluida: false, agendadaPara: '2026-10-20T13:00:00Z' },
    });
    expect(editada.statusCode).toBe(HTTP_STATUS.OK);
    expect(editarAtividade).toHaveBeenCalledWith(TENANT, LEAD, ATIVIDADE, {
      concluida: false,
      agendadaPara: new Date('2026-10-20T13:00:00Z'),
    });

    await app.inject({ method: 'DELETE', url: `/crm/leads/${LEAD}/atividades/${ATIVIDADE}`, headers: autorizado(tokenOperador) });
    expect(removerAtividade).toHaveBeenCalledWith(TENANT, LEAD, ATIVIDADE);
  });

  it('validação: sem título, campo extra, edição vazia ou id inválido → 400', async () => {
    findManyFeatures.mockResolvedValue(COM_FLAG);
    const casos = [
      ['POST', `/crm/leads/${LEAD}/atividades`, { tipo: 'ligacao' }],
      ['POST', `/crm/leads/${LEAD}/atividades`, { tipo: 'ligacao', titulo: 'x', autorId: 'outro' }],
      ['PUT', `/crm/leads/${LEAD}/atividades/${ATIVIDADE}`, {}],
      ['PUT', `/crm/leads/${LEAD}/atividades/nao-e-uuid`, { titulo: 'x' }],
    ];
    for (const [method, url, payload] of casos) {
      const resposta = await app.inject({ method, url, headers: autorizado(tokenDono), payload });
      expect(resposta.statusCode, `${method} ${JSON.stringify(payload)}`).toBe(HTTP_STATUS.BAD_REQUEST);
    }
    expect(registrarAtividade).not.toHaveBeenCalled();
    expect(editarAtividade).not.toHaveBeenCalled();
  });

  it('histórico paginado pela query; tamanho acima do máximo → 400', async () => {
    findManyFeatures.mockResolvedValue(COM_FLAG);
    const ok = await app.inject({
      method: 'GET',
      url: `/crm/leads/${LEAD}/historico?pagina=2&tamanho=${TAMANHO_HISTORICO}`,
      headers: autorizado(tokenOperador),
    });
    expect(ok.statusCode).toBe(HTTP_STATUS.OK);
    expect(listarHistorico).toHaveBeenCalledWith(TENANT, LEAD, { pagina: PAGINA, tamanho: TAMANHO_HISTORICO }, { papel: 'OPERADOR' });

    const excessivo = await app.inject({
      method: 'GET',
      url: `/crm/leads/${LEAD}/historico?tamanho=${TAMANHO_HISTORICO_EXCESSIVO}`,
      headers: autorizado(tokenOperador),
    });
    expect(excessivo.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
  });
});

describe('Duplicidade e mesclagem (M7, flag crm.duplicidade)', () => {
  const COM_FLAG = [{ featureKey: 'crm.duplicidade' }];
  const OUTRO_LEAD = '00000000-0000-0000-0000-0000000000b2';
  const LINHA = 12;

  it('regras: sem a flag 403; OPERADOR lê mas não grava; DONO grava; campo repetido → 400', async () => {
    const sem = await app.inject({ method: 'GET', url: '/crm/configuracoes/duplicidade', headers: autorizado(tokenDono) });
    expect(sem.statusCode).toBe(HTTP_STATUS.FORBIDDEN);

    findManyFeatures.mockResolvedValue(COM_FLAG);
    await encerrarCache();
    const leitura = await app.inject({ method: 'GET', url: '/crm/configuracoes/duplicidade', headers: autorizado(tokenOperador) });
    expect(leitura.statusCode).toBe(HTTP_STATUS.OK);

    const regras = [{ campo: 'cnpj', acao: 'block', ativo: true }];
    const operador = await app.inject({
      method: 'PUT',
      url: '/crm/configuracoes/duplicidade',
      headers: autorizado(tokenOperador),
      payload: { regras },
    });
    expect(operador.json().error.code).toBe(ERROR_CODES.FORBIDDEN);

    const dono = await app.inject({ method: 'PUT', url: '/crm/configuracoes/duplicidade', headers: autorizado(tokenDono), payload: { regras } });
    expect(dono.statusCode).toBe(HTTP_STATUS.OK);
    expect(salvarRegras).toHaveBeenCalledWith(TENANT, regras);

    const repetido = await app.inject({
      method: 'PUT',
      url: '/crm/configuracoes/duplicidade',
      headers: autorizado(tokenDono),
      payload: { regras: [...regras, { campo: 'cnpj', acao: 'warn', ativo: false }] },
    });
    expect(repetido.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
  });

  it('mesclar: OPERADOR → 403 (antes da flag); DONO com a flag → 200 com o autor', async () => {
    const payload = { principalId: LEAD, secundarioId: OUTRO_LEAD, escolhas: { nome: 'secundario' } };
    const operador = await app.inject({ method: 'POST', url: '/crm/leads/merge', headers: autorizado(tokenOperador), payload });
    expect(operador.json().error.code).toBe(ERROR_CODES.FORBIDDEN);

    findManyFeatures.mockResolvedValue(COM_FLAG);
    const dono = await app.inject({ method: 'POST', url: '/crm/leads/merge', headers: autorizado(tokenDono), payload });
    expect(dono.statusCode).toBe(HTTP_STATUS.OK);
    expect(mesclarLeads).toHaveBeenCalledWith(TENANT, payload, 'u-dono');

    const escolhaInvalida = await app.inject({
      method: 'POST',
      url: '/crm/leads/merge',
      headers: autorizado(tokenDono),
      payload: { ...payload, escolhas: { nome: 'os-dois' } },
    });
    expect(escolhaInvalida.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
  });

  it('checagem ao vivo não exige a flag nem salva; campo extra → 400', async () => {
    const ok = await app.inject({
      method: 'POST',
      url: '/crm/leads/duplicados',
      headers: autorizado(tokenOperador),
      payload: { email: 'ana@x.com', leadId: LEAD },
    });
    expect(ok.statusCode).toBe(HTTP_STATUS.OK);
    expect(checarDuplicados).toHaveBeenCalledWith(TENANT, { email: 'ana@x.com', leadId: LEAD });

    const extra = await app.inject({ method: 'POST', url: '/crm/leads/duplicados', headers: autorizado(tokenOperador), payload: { nome: 'x' } });
    expect(extra.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
  });

  it('confirmar import aceita as ações por linha; ação inválida → 400', async () => {
    const JOB_ID = '00000000-0000-0000-0000-0000000000c3';
    const ok = await app.inject({
      method: 'POST',
      url: `/crm/import/${JOB_ID}/confirm`,
      headers: autorizado(tokenDono),
      payload: { acoes: { [String(LINHA)]: 'atualizar' } },
    });
    expect(ok.statusCode).toBe(HTTP_STATUS.OK);
    expect(confirmarImportacao).toHaveBeenCalledWith(TENANT, JOB_ID, { acoes: { [String(LINHA)]: 'atualizar' } });

    const invalida = await app.inject({
      method: 'POST',
      url: `/crm/import/${JOB_ID}/confirm`,
      headers: autorizado(tokenDono),
      payload: { acoes: { [String(LINHA)]: 'mesclar' } },
    });
    expect(invalida.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
  });
});

describe('Regras de campo (M8, flag crm.regras)', () => {
  const COM_FLAG = [{ featureKey: 'crm.regras' }];
  const CAMPO = '00000000-0000-0000-0000-0000000000d1';
  const OUTRO_CAMPO = '00000000-0000-0000-0000-0000000000d2';
  const REGRA = '00000000-0000-0000-0000-0000000000d3';
  const POR_STATUS = { kind: 'required_from_status', campoId: CAMPO, condicao: { categorias: ['perdido'] } };

  it('sem a flag 403; OPERADOR lê mas não cria; DONO cria (201)', async () => {
    const sem = await app.inject({ method: 'GET', url: '/crm/configuracoes/regras', headers: autorizado(tokenOperador) });
    expect(sem.statusCode).toBe(HTTP_STATUS.FORBIDDEN);

    findManyFeatures.mockResolvedValue(COM_FLAG);
    await encerrarCache();
    const leitura = await app.inject({ method: 'GET', url: '/crm/configuracoes/regras', headers: autorizado(tokenOperador) });
    expect(leitura.statusCode).toBe(HTTP_STATUS.OK);

    const operador = await app.inject({ method: 'POST', url: '/crm/configuracoes/regras', headers: autorizado(tokenOperador), payload: POR_STATUS });
    expect(operador.json().error.code).toBe(ERROR_CODES.FORBIDDEN);

    const dono = await app.inject({ method: 'POST', url: '/crm/configuracoes/regras', headers: autorizado(tokenDono), payload: POR_STATUS });
    expect(dono.statusCode).toBe(HTTP_STATUS.CREATED);
    expect(criarRegra).toHaveBeenCalledWith(TENANT, POR_STATUS);
  });

  it('forma do body: tipo desconhecido, categoria inválida, operador fora do vocabulário ou campo extra → 400', async () => {
    findManyFeatures.mockResolvedValue(COM_FLAG);
    const invalidos = [
      { ...POR_STATUS, kind: 'required' },
      { ...POR_STATUS, condicao: { categorias: ['fechado'] } },
      { kind: 'conditional', campoId: CAMPO, condicao: { campoId: OUTRO_CAMPO, operador: 'parecido' }, efeito: { obrigatorio: true } },
      { ...POR_STATUS, efeito: { obrigatorio: true } }, // efeito só existe na condicional
    ];
    for (const payload of invalidos) {
      const resposta = await app.inject({ method: 'POST', url: '/crm/configuracoes/regras', headers: autorizado(tokenDono), payload });
      expect(resposta.statusCode, JSON.stringify(payload)).toBe(HTTP_STATUS.BAD_REQUEST);
    }
    expect(criarRegra).not.toHaveBeenCalled();
  });

  it('editar (parcial) e excluir passam o id; edição vazia → 400', async () => {
    findManyFeatures.mockResolvedValue(COM_FLAG);
    await app.inject({ method: 'PUT', url: `/crm/configuracoes/regras/${REGRA}`, headers: autorizado(tokenDono), payload: { ativo: false } });
    expect(editarRegra).toHaveBeenCalledWith(TENANT, REGRA, { ativo: false });

    const vazia = await app.inject({ method: 'PUT', url: `/crm/configuracoes/regras/${REGRA}`, headers: autorizado(tokenDono), payload: {} });
    expect(vazia.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);

    await app.inject({ method: 'DELETE', url: `/crm/configuracoes/regras/${REGRA}`, headers: autorizado(tokenDono) });
    expect(removerRegra).toHaveBeenCalledWith(TENANT, REGRA);
  });
});

describe('Inatividade (M9, flag crm.inatividade)', () => {
  const COM_FLAG = [{ featureKey: 'crm.inatividade' }];
  const URL = '/crm/configuracoes/inatividade';
  const DIA_FRACIONADO = 1.5;

  it('sem a flag 403; OPERADOR lê mas não grava; DONO grava', async () => {
    const sem = await app.inject({ method: 'GET', url: URL, headers: autorizado(tokenOperador) });
    expect(sem.statusCode).toBe(HTTP_STATUS.FORBIDDEN);

    findManyFeatures.mockResolvedValue(COM_FLAG);
    await encerrarCache();
    const leitura = await app.inject({ method: 'GET', url: URL, headers: autorizado(tokenOperador) });
    expect(leitura.statusCode).toBe(HTTP_STATUS.OK);

    const payload = { status: { novo: DIAS_ESFRIAR.MIN, proposta: null } };
    const operador = await app.inject({ method: 'PUT', url: URL, headers: autorizado(tokenOperador), payload });
    expect(operador.json().error.code).toBe(ERROR_CODES.FORBIDDEN);

    const dono = await app.inject({ method: 'PUT', url: URL, headers: autorizado(tokenDono), payload });
    expect(dono.statusCode).toBe(HTTP_STATUS.OK);
    expect(salvarInatividade).toHaveBeenCalledWith(TENANT, payload);
  });

  it('forma do body: mapa vazio, dias fora de 1–365, fracionado ou texto → 400', async () => {
    findManyFeatures.mockResolvedValue(COM_FLAG);
    const invalidos = [
      { status: {} },
      { status: { novo: DIAS_ESFRIAR.MIN - 1 } },
      { status: { novo: DIAS_ESFRIAR.MAX + 1 } },
      { status: { novo: DIA_FRACIONADO } },
      { status: { novo: String(DIAS_ESFRIAR.MIN) } },
      {},
    ];
    for (const payload of invalidos) {
      const resposta = await app.inject({ method: 'PUT', url: URL, headers: autorizado(tokenDono), payload });
      expect(resposta.statusCode, JSON.stringify(payload)).toBe(HTTP_STATUS.BAD_REQUEST);
    }
    expect(salvarInatividade).not.toHaveBeenCalled();
  });

  it('a busca aceita `esfriando` e recusa valor que não é booleano', async () => {
    const resposta = await app.inject({
      method: 'POST',
      url: '/crm/leads/search',
      headers: autorizado(tokenOperador),
      payload: { esfriando: 'sim' },
    });
    expect(resposta.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
  });
});

describe('Edição em massa e export (M10, flag crm.massa)', () => {
  const COM_FLAG = [{ featureKey: 'crm.massa' }];
  const payload = { ids: [LEAD], alteracoes: { status: 'ganho', tags: { adicionar: ['vip'] } } };

  it('bulk: sem a flag 403; OPERADOR com a flag → 200 com o autor', async () => {
    const sem = await app.inject({ method: 'PATCH', url: '/crm/leads/bulk', headers: autorizado(tokenOperador), payload });
    expect(sem.json().error.code).toBe(ERROR_CODES.FEATURE_NOT_ENABLED);

    findManyFeatures.mockResolvedValue(COM_FLAG);
    await encerrarCache();
    const ok = await app.inject({ method: 'PATCH', url: '/crm/leads/bulk', headers: autorizado(tokenOperador), payload });
    expect(ok.statusCode).toBe(HTTP_STATUS.OK);
    expect(editarLeadsEmMassa).toHaveBeenCalledWith(TENANT, payload, 'u-op', { papel: 'OPERADOR' });
  });

  it('bulk: sem alteração ou id inválido → 400', async () => {
    findManyFeatures.mockResolvedValue(COM_FLAG);
    for (const corpo of [{ ids: [LEAD], alteracoes: {} }, { ids: ['x'], alteracoes: { status: 'ganho' } }]) {
      const resposta = await app.inject({ method: 'PATCH', url: '/crm/leads/bulk', headers: autorizado(tokenDono), payload: corpo });
      expect(resposta.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
    }
    expect(editarLeadsEmMassa).not.toHaveBeenCalled();
  });

  it('export csv: cabeçalhos de CSV; sem colunas chega ao service (colunas da tabela)', async () => {
    exportarLeads.mockResolvedValue(Buffer.from('csv'));
    const csv = await app.inject({ method: 'POST', url: '/crm/export', headers: autorizado(tokenDono), payload: { formato: 'csv' } });
    expect(csv.statusCode).toBe(HTTP_STATUS.OK);
    expect(csv.headers['content-type']).toBe(EXPORTACAO.CONTENT_TYPE_CSV);
    expect(csv.headers['content-disposition']).toContain(EXPORTACAO.NOME_ARQUIVO_CSV);
    expect(exportarLeads).toHaveBeenCalledWith(TENANT, { formato: 'csv' }, 'u-dono');

    const invalido = await app.inject({ method: 'POST', url: '/crm/export', headers: autorizado(tokenDono), payload: { formato: 'pdf' } });
    expect(invalido.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
  });
});

describe('Enriquecimento por CNPJ (M11b, flag crm.cnpj)', () => {
  const COM_FLAG = [{ featureKey: 'crm.cnpj' }];
  const CAMPO = '00000000-0000-0000-0000-00000000e001';
  const config = { ativo: true, modo: 'automatico', sobrescrever: false, mapeamento: { razaoSocial: CAMPO } };

  it('sem a flag: lupa e config → 403', async () => {
    for (const url of ['/crm/cnpj/11222333000181', '/crm/configuracoes/cnpj']) {
      const resposta = await app.inject({ method: 'GET', url, headers: autorizado(tokenOperador) });
      expect(resposta.json().error.code, url).toBe(ERROR_CODES.FEATURE_NOT_ENABLED);
    }
  });

  it('lupa: qualquer papel, com a flag', async () => {
    findManyFeatures.mockResolvedValue(COM_FLAG);
    const resposta = await app.inject({ method: 'GET', url: '/crm/cnpj/11.222.333%2F0001-81', headers: autorizado(tokenOperador) });
    expect(resposta.statusCode).toBe(HTTP_STATUS.OK);
    expect(consultarParaLupa).toHaveBeenCalledWith(TENANT, '11.222.333/0001-81', { papel: 'OPERADOR' });
  });

  it('config: OPERADOR não grava (antes da flag); DONO grava; campo desconhecido → 400', async () => {
    const operador = await app.inject({ method: 'PUT', url: '/crm/configuracoes/cnpj', headers: autorizado(tokenOperador), payload: config });
    expect(operador.json().error.code).toBe(ERROR_CODES.FORBIDDEN);

    findManyFeatures.mockResolvedValue(COM_FLAG);
    const dono = await app.inject({ method: 'PUT', url: '/crm/configuracoes/cnpj', headers: autorizado(tokenDono), payload: config });
    expect(dono.statusCode).toBe(HTTP_STATUS.OK);
    expect(salvarConfigCnpj).toHaveBeenCalledWith(TENANT, config);

    const invalido = await app.inject({
      method: 'PUT',
      url: '/crm/configuracoes/cnpj',
      headers: autorizado(tokenDono),
      payload: { ...config, mapeamento: { capitalSocial: CAMPO } },
    });
    expect(invalido.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
  });
});

describe('Distribuição automática (M12, flag crm.distribuicao)', () => {
  const COM_FLAG = [{ featureKey: 'crm.distribuicao' }];
  const USUARIO = '00000000-0000-0000-0000-0000000000a1';
  const CAMPO = '00000000-0000-0000-0000-0000000000f1';
  const GRUPO = '00000000-0000-0000-0000-0000000000b1';
  const config = {
    ativo: true,
    fallback: 'sem_responsavel',
    regras: [
      {
        nome: 'Site',
        ativo: true,
        condicoes: [{ campoId: CAMPO, operador: 'igual', valor: 'site' }],
        destino: { tipo: 'grupo', id: GRUPO },
      },
    ],
  };

  it('sem a flag: config → 403', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/crm/configuracoes/distribuicao', headers: autorizado(tokenOperador) });
    expect(resposta.json().error.code).toBe(ERROR_CODES.FEATURE_NOT_ENABLED);
  });

  it('leitura pra qualquer papel; OPERADOR não grava (antes da flag); DONO grava', async () => {
    findManyFeatures.mockResolvedValue(COM_FLAG);
    const leitura = await app.inject({ method: 'GET', url: '/crm/configuracoes/distribuicao', headers: autorizado(tokenOperador) });
    expect(leitura.statusCode).toBe(HTTP_STATUS.OK);

    findManyFeatures.mockResolvedValue([]);
    const operador = await app.inject({ method: 'PUT', url: '/crm/configuracoes/distribuicao', headers: autorizado(tokenOperador), payload: config });
    expect(operador.json().error.code).toBe(ERROR_CODES.FORBIDDEN);

    findManyFeatures.mockResolvedValue(COM_FLAG);
    const dono = await app.inject({ method: 'PUT', url: '/crm/configuracoes/distribuicao', headers: autorizado(tokenDono), payload: config });
    expect(dono.statusCode).toBe(HTTP_STATUS.OK);
    expect(salvarConfigDistribuicao).toHaveBeenCalledWith(TENANT, config);
  });

  it('borda: fallback desconhecido, destino de tipo inválido ou campo extra → 400', async () => {
    findManyFeatures.mockResolvedValue(COM_FLAG);
    const payloads = [
      { ...config, fallback: 'criador' },
      { ...config, regras: [{ ...config.regras[0], destino: { tipo: 'time', id: GRUPO } }] },
      { ...config, regras: [{ ...config.regras[0], prioridade: 1 }] },
    ];
    for (const payload of payloads) {
      const resposta = await app.inject({ method: 'PUT', url: '/crm/configuracoes/distribuicao', headers: autorizado(tokenDono), payload });
      expect(resposta.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
    }
  });

  it('grupos: criar (201) e excluir só gestão', async () => {
    findManyFeatures.mockResolvedValue(COM_FLAG);
    const grupo = { nome: 'Vendas', membros: [USUARIO] };
    const criado = await app.inject({ method: 'POST', url: '/crm/configuracoes/distribuicao/grupos', headers: autorizado(tokenDono), payload: grupo });
    expect(criado.statusCode).toBe(HTTP_STATUS.CREATED);

    const operador = await app.inject({ method: 'DELETE', url: `/crm/configuracoes/distribuicao/grupos/${GRUPO}`, headers: autorizado(tokenOperador) });
    expect(operador.json().error.code).toBe(ERROR_CODES.FORBIDDEN);
    await app.inject({ method: 'DELETE', url: `/crm/configuracoes/distribuicao/grupos/${GRUPO}`, headers: autorizado(tokenDono) });
    expect(excluirGrupo).toHaveBeenCalledWith(TENANT, GRUPO);
  });
});

describe('Permissão por campo (M13, flag crm.permissoes)', () => {
  const COM_FLAG = [{ featureKey: 'crm.permissoes' }];
  const CAMPO = '00000000-0000-0000-0000-0000000000c1';
  const URL = '/crm/configuracoes/permissoes';

  it('só gestão (papel antes da flag) e só com a flag', async () => {
    const operador = await app.inject({ method: 'GET', url: URL, headers: autorizado(tokenOperador) });
    expect(operador.json().error.code).toBe(ERROR_CODES.FORBIDDEN);
    const semFlag = await app.inject({ method: 'GET', url: URL, headers: autorizado(tokenDono) });
    expect(semFlag.json().error.code).toBe(ERROR_CODES.FEATURE_NOT_ENABLED);

    findManyFeatures.mockResolvedValue(COM_FLAG);
    await encerrarCache(); // as flags do tenant ficam em cache
    const dono = await app.inject({ method: 'GET', url: URL, headers: autorizado(tokenDono) });
    expect(dono.statusCode).toBe(HTTP_STATUS.OK);
  });

  it('PUT: o mapa do papel; papel desconhecido, acesso inválido ou body vazio → 400', async () => {
    findManyFeatures.mockResolvedValue(COM_FLAG);
    const payload = { OPERADOR: { [CAMPO]: 'hidden' } };
    const ok = await app.inject({ method: 'PUT', url: URL, headers: autorizado(tokenDono), payload });
    expect(ok.statusCode).toBe(HTTP_STATUS.OK);
    expect(salvarPermissoes).toHaveBeenCalledWith(TENANT, payload);

    for (const invalido of [{ DONO: { [CAMPO]: 'view' } }, { OPERADOR: { [CAMPO]: 'escrever' } }, {}]) {
      const resposta = await app.inject({ method: 'PUT', url: URL, headers: autorizado(tokenDono), payload: invalido });
      expect(resposta.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
    }
  });

  it('export e import continuam só de gestão: o OPERADOR não exporta campo nenhum', async () => {
    const exportar = await app.inject({ method: 'POST', url: '/crm/export', headers: autorizado(tokenOperador), payload: { formato: 'csv' } });
    expect(exportar.json().error.code).toBe(ERROR_CODES.FORBIDDEN);
  });
});
