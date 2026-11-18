import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buscarOportunidadesParaEventos,
  reservarEventos,
} from '../adapters/crm-outbox.repository.js';
import { drenarEventos } from './quadro-eventos.service.js';

vi.mock('../adapters/crm-outbox.repository.js', () => ({
  reservarEventos: vi.fn(),
  confirmarEventos: vi.fn(),
  buscarOportunidadesParaEventos: vi.fn(),
}));

const TENANT = 't1';
const LIMITE = 10;
const evento = (id, entidade, entidadeId, payload = {}, recente = true) => ({
  id,
  tenant_id: TENANT,
  entidade,
  entidade_id: entidadeId,
  payload,
  recente,
});

beforeEach(() => {
  vi.clearAllMocks();
  buscarOportunidadesParaEventos.mockResolvedValue([]);
});

describe('drenarEventos', () => {
  it('oportunidade vira aviso no quadro do pipeline dela', async () => {
    reservarEventos.mockResolvedValue([evento('e1', 'deal', 'd1', { pipelineId: 'p1' })]);

    expect(await drenarEventos(LIMITE)).toEqual({
      ids: ['e1'],
      eventos: [{ tenantId: TENANT, quadroRef: 'p1', entidadeId: 'd1' }],
    });
  });

  it('pessoa vira aviso em cada card dela', async () => {
    reservarEventos.mockResolvedValue([evento('e1', 'person', 'l1')]);

    buscarOportunidadesParaEventos.mockResolvedValue([
      { tenant_id: TENANT, pipeline_id: 'p1', id: 'd1' },
      { tenant_id: TENANT, pipeline_id: 'p2', id: 'd2' },
    ]);

    expect((await drenarEventos(LIMITE)).eventos).toEqual([
      { tenantId: TENANT, quadroRef: 'p1', entidadeId: 'd1' },
      { tenantId: TENANT, quadroRef: 'p2', entidadeId: 'd2' },
    ]);
  });

  it('outra entidade (formulário) é confirmada sem aviso', async () => {
    reservarEventos.mockResolvedValue([
      evento('e1', 'form_link', 'f1'),
      evento('e2', 'deal', 'd1', { pipelineId: 'p1' }),
    ]);

    expect(await drenarEventos(LIMITE)).toEqual({
      ids: ['e1', 'e2'],
      eventos: [{ tenantId: TENANT, quadroRef: 'p1', entidadeId: 'd1' }],
    });
  });

  it('evento antigo é confirmado sem aviso', async () => {
    reservarEventos.mockResolvedValue([evento('e1', 'deal', 'd1', { pipelineId: 'p1' }, false)]);
    expect(await drenarEventos(LIMITE)).toEqual({ ids: ['e1'], eventos: [] });
  });
});
