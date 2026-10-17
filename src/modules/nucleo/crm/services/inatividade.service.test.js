import { beforeEach, describe, expect, it, vi } from 'vitest';
import { criarNotificacoes } from '#core/notificacoes/notificacoes.js';
import { featureAtiva } from '#core/tenant/feature-flags.js';
import { listarTenantsAtivosDoModulo } from '#core/tenant/module-access.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import {
  buscarDiasPorStatus,
  contarEsfriandoPorResponsavel,
  definirDiasPorStatus,
} from '../adapters/crm-inatividade.repository.js';
import { listarDonosAtivosDoTenant } from '../adapters/usuarios.repository.js';
import {
  dataEHoraLocal,
  montarNotificacoesDoDia,
  notificarLeadsEsfriando,
  salvarInatividade,
} from './inatividade.service.js';

vi.mock('#core/notificacoes/notificacoes.js', () => ({ criarNotificacoes: vi.fn(async (_t, itens) => itens.length) }));
vi.mock('#core/tenant/feature-flags.js', () => ({ featureAtiva: vi.fn() }));
vi.mock('#core/tenant/module-access.js', () => ({ listarTenantsAtivosDoModulo: vi.fn() }));
vi.mock('../adapters/crm-inatividade.repository.js', () => ({
  buscarDiasPorStatus: vi.fn(),
  contarEsfriandoPorResponsavel: vi.fn(),
  definirDiasPorStatus: vi.fn(),
}));
vi.mock('../adapters/usuarios.repository.js', () => ({ listarDonosAtivosDoTenant: vi.fn() }));
vi.mock('../adapters/manutencao-queue.repository.js', () => ({ agendarNotificacaoEsfriando: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-000000000001';
const OUTRO_TENANT = '00000000-0000-0000-0000-000000000002';
const VENDEDORA = '00000000-0000-0000-0000-0000000000a1';
const DONO = '00000000-0000-0000-0000-0000000000a2';
const SAO_PAULO = 'America/Sao_Paulo';
// 17/10/2026 11:30 UTC = 08:30 em São Paulo (UTC-3).
const AS_OITO_E_MEIA = new Date('2026-10-17T11:30:00Z');
const AS_SETE = new Date('2026-10-17T10:00:00Z');
const DIAS = 2;
const HORA_DO_RESUMO = 8;
const HORA_NA_VESPERA = 23;
const HORA_EM_TOQUIO = 20;
const LEADS_DA_VENDEDORA = 4;
const LEADS_SEM_RESPONSAVEL = 3;
const STATUS = [
  { id: 's1', key: 'novo', label: 'Novo', category: 'aberto', ativo: true, dias: 1 },
  { id: 's2', key: 'ganho', label: 'Ganho', category: 'ganho', ativo: true, dias: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  featureAtiva.mockResolvedValue(true);
  buscarDiasPorStatus.mockResolvedValue(STATUS);
  listarTenantsAtivosDoModulo.mockResolvedValue([{ tenantId: TENANT, fusoHorario: SAO_PAULO }]);
  listarDonosAtivosDoTenant.mockResolvedValue([DONO]);
});

describe('configuração dos dias por status', () => {
  it('grava o mapa e devolve a lista atualizada', async () => {
    await expect(salvarInatividade(TENANT, { status: { novo: DIAS } })).resolves.toBe(STATUS);
    expect(definirDiasPorStatus).toHaveBeenCalledWith(TENANT, { novo: DIAS });
  });

  it('status inexistente ou fechado (ganho/perdido) com dias → 400; desligar um fechado passa', async () => {
    await expect(salvarInatividade(TENANT, { status: { sumiu: DIAS } })).rejects.toMatchObject({
      statusCode: HTTP_STATUS.BAD_REQUEST,
      fields: { 'status.sumiu': [expect.stringContaining('não existe')] },
    });
    await expect(salvarInatividade(TENANT, { status: { ganho: DIAS } })).rejects.toThrow('não esfria');
    expect(definirDiasPorStatus).not.toHaveBeenCalled();

    await salvarInatividade(TENANT, { status: { ganho: null } });
    expect(definirDiasPorStatus).toHaveBeenCalledWith(TENANT, { ganho: null });
  });
});

describe('dataEHoraLocal', () => {
  it('converte pro fuso do tenant (a data local pode ser outra)', () => {
    expect(dataEHoraLocal(AS_OITO_E_MEIA, SAO_PAULO)).toEqual({ data: '2026-10-17', hora: HORA_DO_RESUMO });
    expect(dataEHoraLocal(new Date('2026-10-17T02:00:00Z'), SAO_PAULO)).toEqual({ data: '2026-10-16', hora: HORA_NA_VESPERA });
    expect(dataEHoraLocal(AS_OITO_E_MEIA, 'Asia/Tokyo')).toEqual({ data: '2026-10-17', hora: HORA_EM_TOQUIO });
  });

  it('fuso inválido cai no padrão', () => {
    expect(dataEHoraLocal(AS_OITO_E_MEIA, 'Lua/Base')).toEqual({ data: '2026-10-17', hora: HORA_DO_RESUMO });
  });
});

describe('montarNotificacoesDoDia', () => {
  it('um resumo por responsável e, dos sem responsável, um por DONO — chave com a data local', () => {
    const itens = montarNotificacoesDoDia(
      [
        { usuario_id: VENDEDORA, total: LEADS_DA_VENDEDORA },
        { usuario_id: null, total: 1 },
      ],
      [DONO],
      '2026-10-17',
    );
    expect(itens).toEqual([
      expect.objectContaining({
        usuarioId: VENDEDORA,
        tipo: 'crm.esfriando',
        titulo: 'Você tem 4 leads esfriando',
        dados: { rota: '/crm/leads', filtro: { esfriando: true, usuarioResponsavelId: VENDEDORA }, total: LEADS_DA_VENDEDORA },
        chaveDedup: 'crm.esfriando:2026-10-17',
      }),
      expect.objectContaining({
        usuarioId: DONO,
        tipo: 'crm.esfriando_sem_responsavel',
        titulo: '1 lead sem responsável esfriando',
        chaveDedup: 'crm.esfriando_sem_responsavel:2026-10-17',
      }),
    ]);
  });

  it('sem leads sem responsável, os DONOs não recebem o resumo à parte', () => {
    expect(montarNotificacoesDoDia([{ usuario_id: VENDEDORA, total: 1 }], [DONO], '2026-10-17')).toHaveLength(1);
  });
});

describe('notificarLeadsEsfriando (job de hora em hora)', () => {
  it('a partir das 8h locais, gera e conta as notificações', async () => {
    contarEsfriandoPorResponsavel.mockResolvedValue([
      { usuario_id: VENDEDORA, total: LEADS_DA_VENDEDORA },
      { usuario_id: null, total: LEADS_SEM_RESPONSAVEL },
    ]);
    const umaPraVendedoraOutraProDono = [VENDEDORA, DONO].length;
    await expect(notificarLeadsEsfriando(AS_OITO_E_MEIA)).resolves.toEqual({
      tenants: 1,
      notificacoes: umaPraVendedoraOutraProDono,
      falhas: [],
    });
    expect(contarEsfriandoPorResponsavel).toHaveBeenCalledWith(TENANT, AS_OITO_E_MEIA);
    expect(criarNotificacoes).toHaveBeenCalledWith(TENANT, [
      expect.objectContaining({ usuarioId: VENDEDORA }),
      expect.objectContaining({ usuarioId: DONO }),
    ]);
  });

  it('antes das 8h locais, com a flag desligada ou sem lead esfriando, não notifica', async () => {
    await notificarLeadsEsfriando(AS_SETE);
    expect(contarEsfriandoPorResponsavel).not.toHaveBeenCalled();

    featureAtiva.mockResolvedValueOnce(false);
    await notificarLeadsEsfriando(AS_OITO_E_MEIA);
    expect(contarEsfriandoPorResponsavel).not.toHaveBeenCalled();

    contarEsfriandoPorResponsavel.mockResolvedValue([]);
    await notificarLeadsEsfriando(AS_OITO_E_MEIA);
    expect(criarNotificacoes).not.toHaveBeenCalled();
    expect(listarDonosAtivosDoTenant).not.toHaveBeenCalled();
  });

  it('falha num tenant vai pro relatório e não para os outros', async () => {
    listarTenantsAtivosDoModulo.mockResolvedValue([
      { tenantId: TENANT, fusoHorario: SAO_PAULO },
      { tenantId: OUTRO_TENANT, fusoHorario: SAO_PAULO },
    ]);
    contarEsfriandoPorResponsavel
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce([{ usuario_id: VENDEDORA, total: 1 }]);

    await expect(notificarLeadsEsfriando(AS_OITO_E_MEIA)).resolves.toEqual({
      tenants: [TENANT, OUTRO_TENANT].length,
      notificacoes: 1,
      falhas: [{ tenantId: TENANT, erro: 'timeout' }],
    });
  });
});
