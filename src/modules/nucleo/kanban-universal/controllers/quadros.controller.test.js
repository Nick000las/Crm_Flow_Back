import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '#core/errors/app-error.js';
import { registerErrorHandlers } from '#core/errors/error-handler.js';
import { registrarModulos } from '#core/registry/modules.js';
import { garantirFeature } from '#core/tenant/feature-flags.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';

import { QUADRO_ENTIDADE } from '../constants.js';
import {
  BOARD_TYPE_FALSO,
  COLUNA_ABERTA,
  COLUNA_PERDIDA,
  criarModuloFalso,
  QUADRO_FALSO,
} from '../testing/provedor-falso.js';
import { registrarRotasQuadros } from './quadros.controller.js';

vi.mock('#core/tenant/module-access.js', () => ({ moduloAtivo: vi.fn().mockResolvedValue(true) }));

vi.mock('#core/tenant/feature-flags.js', () => {
  const garantir = vi.fn();

  return {
    garantirFeature: garantir,
    exigirFeature: (chave) => async (req) => garantir(req.tenantContext.tenantId, chave),
  };
});

const URL = `/kanban/quadros/${BOARD_TYPE_FALSO}/${QUADRO_FALSO}`;
const TENANT = 'd6b67f66-266b-423e-8c86-c25ae13a739c';

async function appForTest() {
  const app = Fastify();

  registerErrorHandlers(app);

  app.addHook('preHandler', async (request) => {
    request.tenantContext = { tenantId: TENANT, userId: TENANT, role: 'OPERADOR' };
  });

  registrarRotasQuadros(app);

  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  registrarModulos([criarModuloFalso([{ id: 'a', coluna: COLUNA_ABERTA }])]);
});

describe('rotas de quadro de entidade', () => {
  it('flag desligada: 403 em toda rota', async () => {
    vi.mocked(garantirFeature).mockRejectedValue(
      new AppError({
        statusCode: HTTP_STATUS.FORBIDDEN,
        code: ERROR_CODES.FEATURE_NOT_ENABLED,
        message: 'Desligada',
      }),
    );

    const app = await appForTest();
    const resposta = await app.inject({ method: 'GET', url: `${URL}/colunas` });

    expect(resposta.statusCode).toBe(HTTP_STATUS.FORBIDDEN);
    expect(garantirFeature).toHaveBeenCalledWith(TENANT, 'kanban_universal.quadros_entidade');
    await app.close();
    vi.mocked(garantirFeature).mockReset();
  });

  it('busca, cria (201) e move', async () => {
    const app = await appForTest();
    const busca = await app.inject({
      method: 'POST',
      url: `${URL}/cards/busca`,
      payload: { colunaRef: COLUNA_ABERTA },
    });

    expect(busca.json().data.itens.map((card) => card.entidadeId)).toEqual(['a']);

    const criado = await app.inject({
      method: 'POST',
      url: `${URL}/cards`,
      payload: { colunaRef: COLUNA_ABERTA, dados: { id: 'b' } },
    });

    expect(criado.statusCode).toBe(HTTP_STATUS.CREATED);

    const movido = await app.inject({
      method: 'PATCH',
      url: `${URL}/cards/a/mover`,
      payload: { colunaDestino: COLUNA_ABERTA },
    });

    expect(movido.statusCode).toBe(HTTP_STATUS.OK);
    await app.close();
  });

  it('CAMPOS_OBRIGATORIOS chega ao cliente com os campos', async () => {
    const app = await appForTest();
    const resposta = await app.inject({
      method: 'PATCH',
      url: `${URL}/cards/a/mover`,
      payload: { colunaDestino: COLUNA_PERDIDA },
    });

    expect(resposta.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);

    expect(resposta.json().error).toMatchObject({
      code: ERROR_CODES.CAMPOS_OBRIGATORIOS,
      fields: { motivo: [expect.any(String)] },
    });

    await app.close();
  });

  it('forma do pedido: campo extra, limite fora da faixa ou tipo inválido → 400', async () => {
    const app = await appForTest();
    const invalidos = [
      { url: `${URL}/cards/busca`, payload: {} },
      {
        url: `${URL}/cards/busca`,
        payload: { colunaRef: COLUNA_ABERTA, limite: QUADRO_ENTIDADE.MAX_LIMITE + 1 },
      },
      {
        url: `${URL}/resumo`,
        payload: { colunaRef: COLUNA_ABERTA, tenant_id: TENANT },
      },
      {
        url: `/kanban/quadros/Tipo-Invalido/${QUADRO_FALSO}/cards/busca`,
        payload: { colunaRef: COLUNA_ABERTA },
      },
    ];

    for (const { url, payload } of invalidos) {
      const resposta = await app.inject({ method: 'POST', url, payload });

      expect(resposta.statusCode, url).toBe(HTTP_STATUS.BAD_REQUEST);
    }

    await app.close();
  });

  it('não há como editar coluna nem excluir card de um quadro de entidade', async () => {
    const app = await appForTest();
    const proibidas = [
      { method: 'POST', url: `${URL}/colunas` },
      { method: 'PATCH', url: `${URL}/colunas/${COLUNA_ABERTA}` },
      { method: 'DELETE', url: `${URL}/colunas/${COLUNA_ABERTA}` },
      { method: 'DELETE', url: `${URL}/cards/a` },
    ];

    for (const rota of proibidas) {
      const resposta = await app.inject({
        ...rota,
        payload: rota.method === 'DELETE' ? undefined : {},
      });

      expect(resposta.statusCode, rota.url).toBe(HTTP_STATUS.NOT_FOUND);
    }

    await app.close();
  });
});
