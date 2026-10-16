import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buscarOpcoesDoTenant,
  buscarTagsDosLeads,
  inserirOpcoes,
  tenantTemLeads,
} from '../adapters/crm-options.repository.js';
import { LISTAS_SEMEADAS, OPCOES_LEGADAS, OPCOES_SUGERIDAS, TIPOS_LISTA } from '../constants.js';
import { opcoesSemeadas } from '../testing/listas.fixture.js';
import { reconciliarListas } from './listas-reconcile.service.js';

vi.mock('../adapters/crm-options.repository.js', async () =>
  (await import('../testing/listas.fixture.js')).mockRepositorioOpcoes(),
);

const TENANT = 'tenant-1';

/** keys inseridas por lista */
function inseridas() {
  return Object.fromEntries(inserirOpcoes.mock.calls.map(([, kind, opcoes]) => [kind, opcoes.map((o) => o.key)]));
}

beforeEach(() => {
  vi.clearAllMocks();
  buscarOpcoesDoTenant.mockResolvedValue([]);
  buscarTagsDosLeads.mockResolvedValue([]);
});

describe('reconciliarListas', () => {
  it('tenant com lead: as keys antigas (os leads continuam válidos sem UPDATE)', async () => {
    tenantTemLeads.mockResolvedValue(true);
    await reconciliarListas(TENANT);

    const porLista = inseridas();
    expect(porLista[TIPOS_LISTA.STATUS]).toEqual(OPCOES_LEGADAS[TIPOS_LISTA.STATUS].map((o) => o.key));
    expect(porLista[TIPOS_LISTA.STATUS]).toContain('negociacao');
    // Tipo de atividade não existia antes: entra o padrão da spec.
    expect(porLista[TIPOS_LISTA.TIPO_ATIVIDADE]).toEqual(OPCOES_SUGERIDAS[TIPOS_LISTA.TIPO_ATIVIDADE].map((o) => o.key));
  });

  it('tenant sem lead: os padrões sugeridos pela spec', async () => {
    tenantTemLeads.mockResolvedValue(false);
    await reconciliarListas(TENANT);
    const porLista = inseridas();
    for (const kind of LISTAS_SEMEADAS) {
      expect(porLista[kind]).toEqual(OPCOES_SUGERIDAS[kind].map((o) => o.key));
    }
  });

  it('lista que já tem opção não é semeada de novo (configuração do tenant preservada)', async () => {
    buscarOpcoesDoTenant.mockResolvedValue(opcoesSemeadas());
    await reconciliarListas(TENANT);
    expect(inseridas()).toEqual({ [TIPOS_LISTA.TAG]: [] });
  });

  it('tags já usadas nos leads viram opção com a mesma key; as existentes ficam', async () => {
    buscarOpcoesDoTenant.mockResolvedValue([
      ...opcoesSemeadas(),
      { id: 't', kind: TIPOS_LISTA.TAG, key: 'VIP', label: 'VIP', ativo: true, position: 0 },
    ]);
    buscarTagsDosLeads.mockResolvedValue(['VIP', 'Indicação forte']);
    await reconciliarListas(TENANT);

    expect(inserirOpcoes).toHaveBeenCalledWith(TENANT, TIPOS_LISTA.TAG, [
      { key: 'Indicação forte', label: 'Indicação forte', position: 1 },
    ]);
  });
});
