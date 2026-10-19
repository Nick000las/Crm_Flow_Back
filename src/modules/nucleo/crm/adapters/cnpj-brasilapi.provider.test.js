import { describe, it, expect, vi, afterEach } from 'vitest';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { provedorBrasilApi } from './cnpj-brasilapi.provider.js';

const CNPJ = '19131243000197';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('provedorBrasilApi', () => {
  it('manda User-Agent (sem ele o firewall da BrasilAPI responde 403)', async () => {
    const fetchFalso = vi.fn(async () => ({ ok: true, status: HTTP_STATUS.OK, json: async () => ({ razao_social: 'ACME' }) }));
    vi.stubGlobal('fetch', fetchFalso);
    await provedorBrasilApi.consultar(CNPJ);
    const [, opcoes] = fetchFalso.mock.calls[0];
    expect(opcoes.headers['user-agent']).toMatch(/\S/);
  });
});
