import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getAdminClient } from '#core/db/tenantClient.js';
import { moduloAtivo, invalidarAcessoModulo, exigirModuloAtivo } from './module-access.js';

const findFirst = vi.fn();

vi.mock('#core/db/tenantClient.js', () => ({
  getAdminClient: vi.fn(() => ({ tenantModule: { findFirst } })),
}));

const TENANT_A = '00000000-0000-0000-0000-00000000000a';
const TENANT_B = '00000000-0000-0000-0000-00000000000b';
const MAIS_QUE_O_TTL_MS = 31_000;

beforeEach(() => {
  vi.useFakeTimers();
  findFirst.mockReset();
  invalidarAcessoModulo(TENANT_A);
  invalidarAcessoModulo(TENANT_B);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('moduloAtivo', () => {
  it('só considera módulo não desligado (disabledAt null)', async () => {
    findFirst.mockResolvedValue({ id: 'm1' });
    await expect(moduloAtivo(TENANT_A, 'crm')).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: { tenantId: TENANT_A, moduleKey: 'crm', disabledAt: null },
      select: { id: true },
    });
    expect(getAdminClient).toHaveBeenCalled();
  });

  it('usa cache dentro do TTL e consulta de novo depois dele', async () => {
    findFirst.mockResolvedValue(null);
    await moduloAtivo(TENANT_A, 'crm');
    await moduloAtivo(TENANT_A, 'crm');
    expect(findFirst).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(MAIS_QUE_O_TTL_MS);
    await moduloAtivo(TENANT_A, 'crm');
    expect(findFirst).toHaveBeenCalledTimes(['antes', 'depois do TTL'].length);
  });

  it('invalidação limpa só o tenant afetado', async () => {
    findFirst.mockResolvedValue({ id: 'm1' });
    await moduloAtivo(TENANT_A, 'crm');
    await moduloAtivo(TENANT_B, 'crm');

    invalidarAcessoModulo(TENANT_A);
    findFirst.mockClear();
    await moduloAtivo(TENANT_A, 'crm');
    await moduloAtivo(TENANT_B, 'crm');
    expect(findFirst).toHaveBeenCalledTimes(1);
  });
});

describe('exigirModuloAtivo', () => {
  it('lança 403 MODULE_NOT_ENABLED quando o tenant não contratou', async () => {
    findFirst.mockResolvedValue(null);
    const hook = exigirModuloAtivo('crm');
    await expect(hook({ tenantContext: { tenantId: TENANT_A } })).rejects.toMatchObject({
      code: 'MODULE_NOT_ENABLED',
    });
  });

  it('deixa passar quando o módulo está ativo', async () => {
    findFirst.mockResolvedValue({ id: 'm1' });
    await expect(exigirModuloAtivo('crm')({ tenantContext: { tenantId: TENANT_A } })).resolves.toBeUndefined();
  });
});
