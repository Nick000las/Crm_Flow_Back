import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { encerrarCache } from '#core/cache/cache.js';
import { getAdminClient } from '#core/db/tenantClient.js';
import { moduloAtivo, invalidarAcessoModulo, exigirModuloAtivo, listarModulosAtivos } from './module-access.js';

const findMany = vi.fn();

vi.mock('#core/db/tenantClient.js', () => ({
  getAdminClient: vi.fn(() => ({ tenantModule: { findMany } })),
}));

const TENANT_A = '00000000-0000-0000-0000-00000000000a';
const TENANT_B = '00000000-0000-0000-0000-00000000000b';
const MAIS_QUE_O_TTL_MS = 31_000;

/** @param {string[]} chaves */
const contratados = (chaves) => chaves.map((moduleKey) => ({ moduleKey }));

beforeEach(async () => {
  vi.useFakeTimers();
  findMany.mockReset();
  await encerrarCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('moduloAtivo', () => {
  it('só considera módulo não desligado (disabledAt null)', async () => {
    findMany.mockResolvedValue(contratados(['crm']));
    await expect(moduloAtivo(TENANT_A, 'crm')).resolves.toBe(true);
    await expect(moduloAtivo(TENANT_A, 'agendamento')).resolves.toBe(false);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: TENANT_A, disabledAt: null } }),
    );
    expect(getAdminClient).toHaveBeenCalled();
  });

  it('usa cache dentro do TTL e consulta de novo depois dele', async () => {
    findMany.mockResolvedValue([]);
    await moduloAtivo(TENANT_A, 'crm');
    await moduloAtivo(TENANT_A, 'kanban_universal');
    expect(findMany).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(MAIS_QUE_O_TTL_MS);
    await moduloAtivo(TENANT_A, 'crm');
    expect(findMany).toHaveBeenCalledTimes(['antes', 'depois do TTL'].length);
  });

  it('invalidação limpa só o tenant afetado', async () => {
    findMany.mockResolvedValue(contratados(['crm']));
    await moduloAtivo(TENANT_A, 'crm');
    await moduloAtivo(TENANT_B, 'crm');

    await invalidarAcessoModulo(TENANT_A);
    findMany.mockClear();
    await moduloAtivo(TENANT_A, 'crm');
    await moduloAtivo(TENANT_B, 'crm');
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});

describe('exigirModuloAtivo', () => {
  it('lança 403 MODULE_NOT_ENABLED quando o tenant não contratou', async () => {
    findMany.mockResolvedValue([]);
    const hook = exigirModuloAtivo('crm');
    await expect(hook({ tenantContext: { tenantId: TENANT_A } })).rejects.toMatchObject({
      code: 'MODULE_NOT_ENABLED',
    });
  });

  it('deixa passar quando o módulo está ativo', async () => {
    findMany.mockResolvedValue(contratados(['crm']));
    await expect(exigirModuloAtivo('crm')({ tenantContext: { tenantId: TENANT_A } })).resolves.toBeUndefined();
  });
});

describe('listarModulosAtivos', () => {
  it('devolve só as chaves dos módulos não desligados', async () => {
    findMany.mockResolvedValue(contratados(['crm', 'kanban_universal']));
    await expect(listarModulosAtivos(TENANT_A)).resolves.toEqual(['crm', 'kanban_universal']);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: TENANT_A, disabledAt: null } }),
    );
  });
});
