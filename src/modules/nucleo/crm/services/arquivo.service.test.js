import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listarTenantsDoModulo } from '#core/tenant/module-access.js';
import {
  definirArquivamento,
  moverParaLixeira,
  purgarLixeira,
  restaurarDaLixeira,
} from '../adapters/leads.repository.js';
import { arquivarLead, desarquivarLead, excluirLead, purgarLixeiras, restaurarLead } from './arquivo.service.js';
import { buscarLeadFormatado } from './leads.service.js';

vi.mock('#core/tenant/module-access.js', () => ({ listarTenantsDoModulo: vi.fn() }));
vi.mock('../adapters/manutencao-queue.repository.js', () => ({ agendarPurgaDiaria: vi.fn() }));
vi.mock('../adapters/leads.repository.js', () => ({
  definirArquivamento: vi.fn(),
  moverParaLixeira: vi.fn(),
  purgarLixeira: vi.fn(),
  restaurarDaLixeira: vi.fn(),
}));
vi.mock('./leads.service.js', () => ({ buscarLeadFormatado: vi.fn(async (_tenant, id) => ({ id })) }));

const TENANT = 'tenant-1';
const LEAD = 'lead-1';
const AGORA = new Date('2026-10-16T03:00:00Z');
const TRINTA_DIAS_ANTES = new Date('2026-09-16T03:00:00Z');
const APAGADOS_TENANT_A = 3;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('arquivar e desarquivar', () => {
  it('arquiva e devolve o lead formatado', async () => {
    definirArquivamento.mockResolvedValueOnce({ id: LEAD });
    await expect(arquivarLead(TENANT, LEAD)).resolves.toEqual({ id: LEAD });
    expect(definirArquivamento).toHaveBeenCalledWith(TENANT, LEAD, true, { autorId: null });
  });

  it('lead na lixeira (ou inexistente) → 404', async () => {
    definirArquivamento.mockResolvedValueOnce(undefined);
    await expect(desarquivarLead(TENANT, LEAD)).rejects.toThrow('Lead não encontrado');
    expect(buscarLeadFormatado).not.toHaveBeenCalled();
  });
});

describe('excluir (lixeira)', () => {
  it('manda pra lixeira e informa quando sai de vez', async () => {
    moverParaLixeira.mockResolvedValueOnce({ id: LEAD, deleted_at: AGORA });
    await expect(excluirLead(TENANT, LEAD)).resolves.toEqual({
      removido: true,
      purgaEm: new Date('2026-11-15T03:00:00Z'),
    });
  });

  it('já na lixeira ou inexistente → 404', async () => {
    moverParaLixeira.mockResolvedValueOnce(undefined);
    await expect(excluirLead(TENANT, LEAD)).rejects.toThrow('Lead não encontrado');
  });
});

describe('restaurar', () => {
  it('só restaura o que foi excluído dentro dos últimos 30 dias (relógio falso)', async () => {
    restaurarDaLixeira.mockResolvedValueOnce({ id: LEAD });
    await expect(restaurarLead(TENANT, LEAD)).resolves.toEqual({ id: LEAD });
    expect(restaurarDaLixeira).toHaveBeenCalledWith(TENANT, LEAD, TRINTA_DIAS_ANTES, { autorId: null });
  });

  it('fora do prazo, o lead não existe mais → 404', async () => {
    restaurarDaLixeira.mockResolvedValueOnce(undefined);
    await expect(restaurarLead(TENANT, LEAD)).rejects.toThrow('Lead não encontrado');
  });
});

describe('purga diária', () => {
  it('apaga, em todo tenant do CRM, o que passou de 30 dias; um tenant com erro não para os outros', async () => {
    listarTenantsDoModulo.mockResolvedValueOnce(['tenant-a', 'tenant-b', 'tenant-c']);
    purgarLixeira
      .mockResolvedValueOnce(APAGADOS_TENANT_A)
      .mockRejectedValueOnce(new Error('conexão caiu'))
      .mockResolvedValueOnce(0);

    const relatorio = await purgarLixeiras();

    expect(listarTenantsDoModulo).toHaveBeenCalledWith('crm');
    expect(purgarLixeira).toHaveBeenCalledWith('tenant-a', TRINTA_DIAS_ANTES);
    expect(relatorio).toEqual({
      tenants: ['tenant-a', 'tenant-b', 'tenant-c'].length,
      apagados: APAGADOS_TENANT_A,
      falhas: [{ tenantId: 'tenant-b', erro: 'conexão caiu' }],
    });
  });
});
