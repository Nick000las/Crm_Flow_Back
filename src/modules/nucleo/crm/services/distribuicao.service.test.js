import { describe, it, expect, vi, beforeEach } from 'vitest';
import { criarNotificacoes } from '#core/notificacoes/notificacoes.js';
import { featureAtiva } from '#core/tenant/feature-flags.js';
import { HTTP_STATUS, ROLES } from '#shared/constants/index.js';
import {
  buscarConfigDistribuicao,
  excluirGrupo as excluirGrupoRepository,
  inserirGrupo,
  listarGrupos,
  listarRegrasDistribuicao,
  salvarConfigERegras,
} from '../adapters/crm-distribuicao.repository.js';
import { avancarRodizio } from '../adapters/crm-rodizio.repository.js';
import { listarUsuariosAtivosComPapel } from '../adapters/usuarios.repository.js';
import { CAMADA } from '../constants.js';
import {
  carregarContextoDistribuicao,
  criarGrupo,
  distribuir,
  excluirGrupo,
  notificarAtribuicao,
  notificarAtribuicoesDoImport,
  salvarConfigDistribuicao,
} from './distribuicao.service.js';

vi.mock('#core/tenant/feature-flags.js', () => ({ featureAtiva: vi.fn() }));
vi.mock('#core/notificacoes/notificacoes.js', () => ({ criarNotificacoes: vi.fn() }));
vi.mock('../adapters/crm-distribuicao.repository.js', () => ({
  buscarConfigDistribuicao: vi.fn(),
  listarRegrasDistribuicao: vi.fn(),
  salvarConfigERegras: vi.fn(),
  listarGrupos: vi.fn(),
  inserirGrupo: vi.fn(),
  atualizarGrupo: vi.fn(),
  excluirGrupo: vi.fn(),
}));
vi.mock('../adapters/crm-rodizio.repository.js', () => ({ avancarRodizio: vi.fn() }));
vi.mock('../adapters/usuarios.repository.js', () => ({ listarUsuariosAtivosComPapel: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-000000000001';
const ID_FONTE = '00000000-0000-0000-0000-0000000000f1';
const ID_VALOR = '00000000-0000-0000-0000-0000000000f2';
const ANA = 'aaaaaaaa-0000-0000-0000-000000000001';
const BRUNO = 'bbbbbbbb-0000-0000-0000-000000000002';
const MASTER = 'cccccccc-0000-0000-0000-000000000003';
const GRUPO = '99999999-0000-0000-0000-000000000009';
const REGRA_EXISTENTE = '88888888-0000-0000-0000-000000000008';
const TOTAL_ANA = 3;
const ACIMA_DO_LIMITE_DE_CONDICOES = 11;

vi.mock('./field-schema.service.js', () => ({
  obterSchemaCampos: vi.fn(async () => ({
    campos: [
      { id: ID_FONTE, chave: 'fonteLead', label: 'Fonte', tipo: 'texto', camada: CAMADA.CAMADA_1 },
      { id: ID_VALOR, chave: 'valorEstimado', label: 'Valor estimado', tipo: 'numero', camada: CAMADA.CAMADA_3 },
    ],
  })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  featureAtiva.mockResolvedValue(true);
  buscarConfigDistribuicao.mockResolvedValue({ ativo: true, fallback: 'rodizio_geral' });
  listarRegrasDistribuicao.mockResolvedValue([]);
  listarGrupos.mockResolvedValue([{ id: GRUPO, nome: 'Vendas', membros: [ANA, BRUNO] }]);
  listarUsuariosAtivosComPapel.mockResolvedValue([
    { id: ANA, nome: 'Ana', role: ROLES.OPERADOR },
    { id: BRUNO, nome: 'Bruno', role: ROLES.DONO },
    { id: MASTER, nome: 'Suporte', role: ROLES.MASTER },
  ]);
  avancarRodizio.mockImplementation(async (_tenant, _chave, candidatos) => candidatos[0]);
  criarNotificacoes.mockResolvedValue(1);
});

describe('carregarContextoDistribuicao', () => {
  it('flag desligada, config desligada ou nunca salva: null (o criador segue responsável)', async () => {
    featureAtiva.mockResolvedValue(false);
    expect(await carregarContextoDistribuicao(TENANT)).toBeNull();

    featureAtiva.mockResolvedValue(true);
    buscarConfigDistribuicao.mockResolvedValue({ ativo: false, fallback: 'rodizio_geral' });
    expect(await carregarContextoDistribuicao(TENANT)).toBeNull();

    buscarConfigDistribuicao.mockResolvedValue(undefined);
    expect(await carregarContextoDistribuicao(TENANT)).toBeNull();
  });

  it('rodízio geral: DONO e OPERADOR ativos, sem o MASTER', async () => {
    const contexto = await carregarContextoDistribuicao(TENANT);
    expect(contexto?.rodizioGeral).toEqual([ANA, BRUNO]);
  });
});

describe('distribuir', () => {
  it('regra pra grupo avança o rodízio do grupo', async () => {
    listarRegrasDistribuicao.mockResolvedValue([
      { id: 'r1', nome: 'Site', posicao: 0, ativo: true, condicoes: [], destino_usuario_id: null, destino_grupo_id: GRUPO },
    ]);
    const contexto = /** @type {any} */ (await carregarContextoDistribuicao(TENANT));
    expect(await distribuir(TENANT, contexto, {})).toEqual({ usuarioId: ANA, regraId: 'r1', regraNome: 'Site', origem: 'regra' });
    expect(avancarRodizio).toHaveBeenCalledWith(TENANT, GRUPO, [ANA, BRUNO]);
  });

  it('nenhuma regra: rodízio geral, ou sem responsável conforme o fallback', async () => {
    const geral = /** @type {any} */ (await carregarContextoDistribuicao(TENANT));
    expect(await distribuir(TENANT, geral, {})).toMatchObject({ usuarioId: ANA, regraId: null, origem: 'rodizio_geral' });
    expect(avancarRodizio).toHaveBeenCalledWith(TENANT, 'geral', [ANA, BRUNO]);

    avancarRodizio.mockClear();
    buscarConfigDistribuicao.mockResolvedValue({ ativo: true, fallback: 'sem_responsavel' });
    const semDono = /** @type {any} */ (await carregarContextoDistribuicao(TENANT));
    expect(await distribuir(TENANT, semDono, {})).toMatchObject({ usuarioId: null, origem: 'sem_responsavel' });
    expect(avancarRodizio).not.toHaveBeenCalled();
  });
});

describe('notificações', () => {
  const atribuicao = { usuarioId: ANA, regraId: 'r1', regraNome: 'Site', origem: 'regra' };

  it('uma por lead, não pra quem criou; falha não sobe', async () => {
    await notificarAtribuicao(TENANT, { leadId: 'l1', leadNome: 'Bia', atribuicao, criadorId: BRUNO });
    expect(criarNotificacoes).toHaveBeenCalledWith(TENANT, [
      expect.objectContaining({ usuarioId: ANA, tipo: 'crm.lead_atribuido', corpo: 'Bia (regra "Site")', chaveDedup: 'crm.lead_atribuido:l1' }),
    ]);

    criarNotificacoes.mockClear();
    expect(await notificarAtribuicao(TENANT, { leadId: 'l1', leadNome: 'Bia', atribuicao, criadorId: ANA })).toBe(0);
    expect(criarNotificacoes).not.toHaveBeenCalled();

    criarNotificacoes.mockRejectedValue(new Error('banco fora'));
    await expect(notificarAtribuicao(TENANT, { leadId: 'l2', leadNome: 'Caio', atribuicao })).resolves.toBe(0);
  });

  it('import: uma por responsável com o total; quem importou fica de fora', async () => {
    const totais = new Map([[ANA, TOTAL_ANA], [BRUNO, 1]]);
    await notificarAtribuicoesDoImport(TENANT, { importJobId: 'job-1', totais, importadorId: BRUNO });
    expect(criarNotificacoes).toHaveBeenCalledWith(TENANT, [
      expect.objectContaining({ usuarioId: ANA, titulo: 'Você recebeu 3 leads de uma importação', chaveDedup: 'crm.leads_atribuidos:job-1' }),
    ]);
  });
});

describe('salvarConfigDistribuicao', () => {
  const base = { ativo: true, fallback: 'rodizio_geral' };
  const paraAna = { tipo: 'usuario', id: ANA };

  it('grava na ordem, com destino na forma do banco e sem valor nos operadores vazio/nao_vazio', async () => {
    await salvarConfigDistribuicao(TENANT, {
      ...base,
      regras: [
        { nome: ' Site ', ativo: true, condicoes: [{ campoId: ID_FONTE, operador: 'igual', valor: 'site' }], destino: paraAna },
        { nome: 'Resto', ativo: true, condicoes: [{ campoId: ID_FONTE, operador: 'vazio', valor: 'x' }], destino: { tipo: 'grupo', id: GRUPO } },
      ],
    });
    expect(salvarConfigERegras).toHaveBeenCalledWith(TENANT, base, [
      expect.objectContaining({ nome: 'Site', destinoUsuarioId: ANA, destinoGrupoId: null }),
      expect.objectContaining({ nome: 'Resto', condicoes: [{ campoId: ID_FONTE, operador: 'vazio' }], destinoGrupoId: GRUPO }),
    ]);
  });

  it('400: campo inexistente, operador que não serve pro tipo, destino inválido, id desconhecido, condições demais', async () => {
    const tentar = (regra) => salvarConfigDistribuicao(TENANT, { ...base, regras: [{ nome: 'R', ativo: true, condicoes: [], destino: paraAna, ...regra }] });
    const invalido = { statusCode: HTTP_STATUS.BAD_REQUEST };

    await expect(tentar({ condicoes: [{ campoId: GRUPO, operador: 'igual', valor: 'x' }] })).rejects.toMatchObject(invalido);
    await expect(tentar({ condicoes: [{ campoId: ID_VALOR, operador: 'contem', valor: 'x' }] })).rejects.toMatchObject(invalido);
    await expect(tentar({ destino: { tipo: 'usuario', id: GRUPO } })).rejects.toMatchObject({
      fields: { 'regras.0.destino': [expect.stringContaining('usuário ativo')] },
    });
    await expect(tentar({ destino: { tipo: 'grupo', id: ANA } })).rejects.toMatchObject(invalido);
    await expect(tentar({ id: REGRA_EXISTENTE })).rejects.toMatchObject(invalido);
    const muitas = Array.from({ length: ACIMA_DO_LIMITE_DE_CONDICOES }, () => ({ campoId: ID_FONTE, operador: 'nao_vazio' }));
    await expect(tentar({ condicoes: muitas })).rejects.toMatchObject(invalido);
    expect(salvarConfigERegras).not.toHaveBeenCalled();
  });
});

describe('grupos', () => {
  it('nome repetido (sem diferenciar maiúscula) → 409; membro que não é usuário ativo → 400', async () => {
    await expect(criarGrupo(TENANT, { nome: 'VENDAS', membros: [] })).rejects.toMatchObject({ statusCode: HTTP_STATUS.CONFLICT });
    await expect(criarGrupo(TENANT, { nome: 'SDR', membros: [GRUPO] })).rejects.toMatchObject({ statusCode: HTTP_STATUS.BAD_REQUEST });
    expect(inserirGrupo).not.toHaveBeenCalled();
  });

  it('grupo destino de regra não pode ser excluído (409)', async () => {
    listarRegrasDistribuicao.mockResolvedValue([
      { id: 'r1', nome: 'Site', posicao: 0, ativo: true, condicoes: [], destino_usuario_id: null, destino_grupo_id: GRUPO },
    ]);
    await expect(excluirGrupo(TENANT, GRUPO)).rejects.toMatchObject({ statusCode: HTTP_STATUS.CONFLICT });
    expect(excluirGrupoRepository).not.toHaveBeenCalled();
  });
});
