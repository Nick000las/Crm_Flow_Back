import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HTTP_STATUS } from '#shared/constants/index.js';

import { inserirOpcoes } from '../adapters/crm-options.repository.js';
import {
  buscarPipelines,
  inserirPipelineDeAtendimento,
  inserirPipelineDentroDoLimite,
  inserirPipelinePadrao,
} from '../adapters/crm-pipelines.repository.js';
import {
  PIPELINES,
  STATUS_DE_VENDAS_NOVO,
  STATUS_DO_ATENDIMENTO,
  TIPOS_PIPELINE,
} from '../constants.js';
import { criarPipeline, reconciliarPipelines } from './pipelines.service.js';

vi.mock('../adapters/crm-pipelines.repository.js', () => ({
  buscarPipelines: vi.fn(),
  inserirPipelineDeAtendimento: vi.fn(),
  inserirPipelineDentroDoLimite: vi.fn(),
  inserirPipelinePadrao: vi.fn(),
}));

vi.mock('../adapters/crm-options.repository.js', () => ({ inserirOpcoes: vi.fn() }));

const TENANT = 'tenant';
const VENDAS = { id: 'vendas', tipo: TIPOS_PIPELINE.VENDAS };
const ATENDIMENTO = { id: 'atendimento', tipo: TIPOS_PIPELINE.ATENDIMENTO };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(inserirPipelineDeAtendimento).mockResolvedValue(ATENDIMENTO);
});

describe('reconciliarPipelines', () => {
  it('tenant novo: cria os dois e os status do Atendimento nele', async () => {
    vi.mocked(buscarPipelines)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([VENDAS])
      .mockResolvedValueOnce([VENDAS, ATENDIMENTO]);

    await expect(reconciliarPipelines(TENANT)).resolves.toEqual({
      criados: [VENDAS, ATENDIMENTO].length,
    });

    expect(inserirPipelineDeAtendimento).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ statusInicial: STATUS_DO_ATENDIMENTO[0].key, position: 1 }),
    );

    expect(inserirOpcoes).toHaveBeenCalledWith(
      TENANT,
      'status',
      expect.arrayContaining([expect.objectContaining({ key: STATUS_DO_ATENDIMENTO[0].key })]),
      ATENDIMENTO.id,
    );
  });

  it('já tem pipeline de atendimento, mesmo renomeado: não recria', async () => {
    vi.mocked(buscarPipelines).mockResolvedValue([VENDAS, { ...ATENDIMENTO, nome: 'Pós-venda' }]);

    await expect(reconciliarPipelines(TENANT)).resolves.toEqual({ criados: 0 });

    expect(inserirPipelinePadrao).toHaveBeenCalledTimes(1);
    expect(inserirPipelineDeAtendimento).not.toHaveBeenCalled();
    expect(inserirOpcoes).not.toHaveBeenCalled();
  });
});

describe('criarPipeline', () => {
  const dados = { nome: 'Recompra', tipo: TIPOS_PIPELINE.VENDAS };

  it('cria respeitando o limite', async () => {
    vi.mocked(inserirPipelineDentroDoLimite).mockResolvedValue(VENDAS);
    await expect(criarPipeline(TENANT, dados)).resolves.toMatchObject(VENDAS);

    expect(inserirPipelineDentroDoLimite).toHaveBeenCalledWith(
      TENANT,
      dados,
      PIPELINES.LIMITE_POR_TENANT,
      STATUS_DE_VENDAS_NOVO,
    );
  });

  it('acima do limite: 400 no campo pipeline', async () => {
    vi.mocked(inserirPipelineDentroDoLimite).mockResolvedValue(undefined);

    await expect(criarPipeline(TENANT, dados)).rejects.toMatchObject({
      statusCode: HTTP_STATUS.BAD_REQUEST,
      fields: { pipeline: [expect.stringContaining(String(PIPELINES.LIMITE_POR_TENANT))] },
    });
  });
});
