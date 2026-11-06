import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registrarModulos } from '#core/registry/modules.js';
import { moduloAtivo } from '#core/tenant/module-access.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
import {
  BOARD_TYPE_FALSO,
  CARD_RESTRITO,
  CARD_SO_LEITURA,
  COLUNA_ABERTA,
  COLUNA_PERDIDA,
  QUADRO_FALSO,
  criarModuloFalso,
} from '../testing/provedor-falso.js';
import {
  criarCard,
  listarAcoes,
  listarCards,
  listarColunas,
  listarQuadrosDeEntidade,
  moverCard,
  resumirColuna,
} from './quadro-entidade.service.js';

vi.mock('#core/tenant/module-access.js', () => ({ moduloAtivo: vi.fn() }));

const context = { tenantId: 'tenant', userId: 'user', role: 'OPERADOR' };
const quadro = { boardType: BOARD_TYPE_FALSO, quadroRef: QUADRO_FALSO };
const logger = { warn: vi.fn() };
const VALOR_A = 100;
const VALOR_B = 50;
const LIMITE = 2;

let modulo;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(moduloAtivo).mockResolvedValue(true);
  modulo = criarModuloFalso([
    { id: 'a', coluna: COLUNA_ABERTA, valor: VALOR_A },
    { id: 'b', coluna: COLUNA_ABERTA, valor: VALOR_B },
    { id: CARD_RESTRITO, coluna: COLUNA_ABERTA },
    { id: CARD_SO_LEITURA, coluna: COLUNA_PERDIDA },
  ]);
  registrarModulos([modulo]);
});

describe('leitura pelo provedor', () => {
  it('lista os quadros publicados, marcados como de entidade', async () => {
    await expect(listarQuadrosDeEntidade(context, logger)).resolves.toEqual([
      {
        boardType: BOARD_TYPE_FALSO,
        quadroRef: QUADRO_FALSO,
        nome: 'Pipeline falso',
        modo: 'entidade',
      },
    ]);
  });

  it('colunas e resumo vêm do provedor; a soma é a da consulta, não a da página', async () => {
    const colunas = await listarColunas(context, quadro);
    expect(colunas.map((coluna) => coluna.ref)).toEqual([COLUNA_ABERTA, COLUNA_PERDIDA]);
    await expect(resumirColuna(context, quadro, { colunaRef: COLUNA_ABERTA })).resolves.toEqual({
      total: modulo.cards.filter((card) => card.coluna === COLUNA_ABERTA).length,
      soma: VALOR_A + VALOR_B,
    });
  });

  it('pagina por cursor e descreve em lote, com a rota da ficha', async () => {
    const consulta = { colunaRef: COLUNA_ABERTA, limite: LIMITE };
    const primeira = await listarCards(context, quadro, consulta);
    expect(primeira.itens.map((card) => card.entidadeId)).toEqual(['a', 'b']);
    expect(primeira.itens[0]).toMatchObject({ titulo: 'Card a', rotaFicha: '/falso/a' });
    expect(primeira.proximoCursor).toBe(String(LIMITE));

    const segunda = await listarCards(context, quadro, {
      ...consulta,
      cursor: primeira.proximoCursor,
    });
    expect(segunda.proximoCursor).toBeNull();
  });

  it('card que a entidade não descreve sai restrito, sem dado', async () => {
    const { itens } = await listarCards(context, quadro, {
      colunaRef: COLUNA_ABERTA,
      limite: modulo.cards.length,
    });
    const restrito = itens.find((card) => card.entidadeId === CARD_RESTRITO);
    expect(restrito.restrito).toBe(true);
    expect(restrito).not.toHaveProperty('titulo');
  });
});

describe('mover e criar', () => {
  it('mover chama o provedor com o quadro e a coluna de destino', async () => {
    const mover = vi.spyOn(modulo.quadros[0], 'mover');
    registrarModulos([modulo]);
    const card = { ...quadro, entidadeId: 'a' };
    const expectedUpdatedAt = '2026-11-05T12:00:00.000Z';

    await moverCard(context, card, { colunaDestino: COLUNA_ABERTA, expectedUpdatedAt });
    expect(mover).toHaveBeenCalledWith(context, {
      quadroRef: QUADRO_FALSO,
      entidadeId: 'a',
      colunaDestino: COLUNA_ABERTA,
      expectedUpdatedAt,
    });
  });

  it('regra do domínio volta como CAMPOS_OBRIGATORIOS, com a lista de campos', async () => {
    await expect(
      moverCard(context, { ...quadro, entidadeId: 'a' }, { colunaDestino: COLUNA_PERDIDA }),
    ).rejects.toMatchObject({
      statusCode: HTTP_STATUS.BAD_REQUEST,
      code: ERROR_CODES.CAMPOS_OBRIGATORIOS,
      fields: { motivo: [expect.stringContaining('obrigatório')] },
    });
    expect(modulo.cards.find((card) => card.id === 'a').coluna).toBe(COLUNA_ABERTA);
  });

  it('ação fora de acoesPermitidas é 403 e nem chega ao provedor', async () => {
    const card = { ...quadro, entidadeId: CARD_SO_LEITURA };
    await expect(listarAcoes(context, card)).resolves.toEqual([]);
    await expect(moverCard(context, card, { colunaDestino: COLUNA_ABERTA })).rejects.toMatchObject({
      statusCode: HTTP_STATUS.FORBIDDEN,
    });
    expect(modulo.cards.find((item) => item.id === CARD_SO_LEITURA).coluna).toBe(COLUNA_PERDIDA);
  });

  it('criar entrega a coluna e os dados ao provedor', async () => {
    await expect(
      criarCard(context, quadro, { colunaRef: COLUNA_ABERTA, dados: { id: 'novo' } }),
    ).resolves.toEqual({ entidadeId: 'novo', colunaRef: COLUNA_ABERTA });
  });
});

describe('isolamento', () => {
  it('módulo dono não contratado: sem quadros na lista e 404 no acesso direto', async () => {
    vi.mocked(moduloAtivo).mockResolvedValue(false);
    await expect(listarQuadrosDeEntidade(context, logger)).resolves.toEqual([]);
    await expect(listarColunas(context, quadro)).rejects.toMatchObject({
      statusCode: HTTP_STATUS.NOT_FOUND,
    });
  });

  it('tipo sem provedor (quadro nativo) é 404', async () => {
    await expect(
      listarColunas(context, { boardType: 'projetos', quadroRef: QUADRO_FALSO }),
    ).rejects.toMatchObject({ statusCode: HTTP_STATUS.NOT_FOUND });
  });

  it('provedor com erro fica de fora da lista e é logado', async () => {
    modulo.quadros[0].listarQuadros = vi.fn().mockRejectedValue(new Error('fora do ar'));
    registrarModulos([modulo]);
    await expect(listarQuadrosDeEntidade(context, logger)).resolves.toEqual([]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
