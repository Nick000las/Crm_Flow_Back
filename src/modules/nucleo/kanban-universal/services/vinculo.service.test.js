import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registrarModulos } from '#core/registry/modules.js';
import { featureAtiva } from '#core/tenant/feature-flags.js';
import { moduloAtivo } from '#core/tenant/module-access.js';
import { HTTP_STATUS } from '#shared/constants/index.js';

import { buscarCardsVinculados } from '../adapters/vinculos.repository.js';
import { CARD_RESTRITO, criarModuloFalso } from '../testing/provedor-falso.js';
import { operarKanban } from './kanban.service.js';
import {
  apresentarVinculos,
  desvincularCard,
  listarCardsDaEntidade,
  vincularCard,
} from './vinculo.service.js';

vi.mock('#core/tenant/module-access.js', () => ({ moduloAtivo: vi.fn() }));
vi.mock('#core/tenant/feature-flags.js', () => ({ featureAtiva: vi.fn() }));
vi.mock('../adapters/vinculos.repository.js', () => ({ buscarCardsVinculados: vi.fn() }));
vi.mock('./kanban.service.js', () => ({ operarKanban: vi.fn() }));

const context = { tenantId: 'tenant', userId: 'user', role: 'OPERADOR' };
const logger = { warn: vi.fn() };
const publish = vi.fn();
const TIPO = 'falsa';
const entidade = { entidadeTipo: TIPO, entidadeId: 'a' };
const vinculo = (id) => ({ tipo: TIPO, id });

let modulo;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(moduloAtivo).mockResolvedValue(true);
  vi.mocked(featureAtiva).mockResolvedValue(true);
  modulo = criarModuloFalso();
  registrarModulos([modulo]);
});

describe('apresentarVinculos', () => {
  it('flag desligada: tira o campo e não consulta o provedor', async () => {
    vi.mocked(featureAtiva).mockResolvedValue(false);

    const descrever = vi.spyOn(modulo.entidades[0], 'descrever');

    registrarModulos([modulo]);

    await expect(
      apresentarVinculos(context, 'card.get', { id: 'c', vinculo: vinculo('a') }, logger),
    ).resolves.toEqual({ id: 'c' });

    expect(descrever).not.toHaveBeenCalled();
  });

  it('card sem vínculo sai com null', async () => {
    await expect(
      apresentarVinculos(context, 'card.get', { id: 'c', vinculo: null }, logger),
    ).resolves.toEqual({ id: 'c', vinculo: null });
  });

  it('quadro: descreve em lote, uma chamada por tipo e sem repetir id', async () => {
    const descrever = vi.spyOn(modulo.entidades[0], 'descrever');

    registrarModulos([modulo]);

    const quadro = {
      colunas: [
        { cards: [{ vinculo: vinculo('a') }, { vinculo: vinculo('b') }] },
        { cards: [{ vinculo: vinculo('a') }, { vinculo: null }] },
      ],
    };

    const { colunas } = await apresentarVinculos(context, 'board.get', quadro, logger);

    expect(descrever).toHaveBeenCalledTimes(1);
    expect(descrever).toHaveBeenCalledWith(context, ['a', 'b']);

    expect(colunas[1].cards[0].vinculo).toEqual({
      tipo: TIPO,
      id: 'a',
      titulo: 'Card a',
      subtitulo: null,
      destaques: [],
      rotaFicha: '/falso/a',
    });

    expect(colunas[1].cards[1].vinculo).toBeNull();
  });

  it('registro não descrito sai restrito, sem id nem link', async () => {
    const card = await apresentarVinculos(
      context,
      'card.get',
      { vinculo: vinculo(CARD_RESTRITO) },
      logger,
    );

    expect(card.vinculo).toEqual({ tipo: TIPO, restrito: true });
  });

  it('registro mesclado aponta para o atual', async () => {
    modulo.entidades[0].descrever = async (_ctx, ids) =>
      ids.map((id) => ({ id, idAtual: 'b', titulo: 'Principal' }));

    registrarModulos([modulo]);

    const { vinculo: legivel } = await apresentarVinculos(
      context,
      'card.get',
      { vinculo: vinculo('a') },
      logger,
    );

    expect(legivel).toMatchObject({ id: 'b', titulo: 'Principal', rotaFicha: '/falso/b' });
  });

  it('provedor com erro ou módulo não contratado: restrito, e o quadro abre', async () => {
    modulo.entidades[0].descrever = vi.fn().mockRejectedValue(new Error('fora do ar'));
    registrarModulos([modulo]);

    const comErro = await apresentarVinculos(
      context,
      'card.get',
      { vinculo: vinculo('a') },
      logger,
    );

    expect(comErro.vinculo.restrito).toBe(true);
    expect(logger.warn).toHaveBeenCalledTimes(1);

    vi.mocked(moduloAtivo).mockResolvedValue(false);

    const semModulo = await apresentarVinculos(
      context,
      'card.get',
      { vinculo: vinculo('a') },
      logger,
    );

    expect(semModulo.vinculo.restrito).toBe(true);
  });

  it('outras ações passam intactas', async () => {
    const valor = { id: 'c' };

    await expect(apresentarVinculos(context, 'card.update', valor, logger)).resolves.toBe(valor);
    expect(featureAtiva).not.toHaveBeenCalled();
  });
});

describe('vincular e desvincular', () => {
  it('grava pelo fluxo normal de escrita, com o id atual', async () => {
    modulo.entidades[0].descrever = async (_ctx, ids) =>
      ids.map((id) => ({ id, idAtual: 'b', titulo: 'Principal' }));

    registrarModulos([modulo]);
    vi.mocked(operarKanban).mockResolvedValue({ id: 'c', vinculo: vinculo('b') });

    const card = await vincularCard(context, 'c', entidade, publish, logger);

    expect(operarKanban).toHaveBeenCalledWith(
      context,
      'card.link',
      'c',
      { entidadeTipo: TIPO, entidadeId: 'b' },
      publish,
    );

    expect(card.vinculo.titulo).toBe('Principal');
  });

  it.each([
    ['tipo sem provedor', { entidadeTipo: 'outro', entidadeId: 'a' }],
    ['registro que o usuário não vê', { entidadeTipo: TIPO, entidadeId: CARD_RESTRITO }],
  ])('%s: 404 e nada é gravado', async (_nome, alvo) => {
    await expect(vincularCard(context, 'c', alvo, publish, logger)).rejects.toMatchObject({
      statusCode: HTTP_STATUS.NOT_FOUND,
    });

    expect(operarKanban).not.toHaveBeenCalled();
  });

  it('entidade que é só card de quadro não recebe vínculo (D3)', async () => {
    modulo.entidades[0] = { ...modulo.entidades[0], vinculavel: false };
    registrarModulos([modulo]);

    await expect(vincularCard(context, 'c', entidade, publish, logger)).rejects.toMatchObject({
      statusCode: HTTP_STATUS.NOT_FOUND,
    });

    expect(operarKanban).not.toHaveBeenCalled();
  });

  it('módulo dono não contratado: 404', async () => {
    vi.mocked(moduloAtivo).mockResolvedValue(false);

    await expect(vincularCard(context, 'c', entidade, publish, logger)).rejects.toMatchObject({
      statusCode: HTTP_STATUS.NOT_FOUND,
    });
  });

  it('desvincular usa a mesma ação, sem entidade', async () => {
    await desvincularCard(context, 'c', publish);
    expect(operarKanban).toHaveBeenCalledWith(context, 'card.link', 'c', {}, publish);
  });
});

describe('aba Projetos', () => {
  it('lista pelo id atual', async () => {
    modulo.entidades[0].descrever = async (_ctx, ids) =>
      ids.map((id) => ({ id, idAtual: 'b', titulo: 'Principal' }));

    registrarModulos([modulo]);
    vi.mocked(buscarCardsVinculados).mockResolvedValue([{ cardId: 'c' }]);

    await expect(listarCardsDaEntidade(context, entidade)).resolves.toEqual([{ cardId: 'c' }]);

    expect(buscarCardsVinculados).toHaveBeenCalledWith(context, {
      entidadeTipo: TIPO,
      entidadeId: 'b',
    });
  });

  it('registro que o usuário não vê: lista vazia, sem consultar cards', async () => {
    await expect(
      listarCardsDaEntidade(context, { entidadeTipo: TIPO, entidadeId: CARD_RESTRITO }),
    ).resolves.toEqual([]);

    expect(buscarCardsVinculados).not.toHaveBeenCalled();
  });
});
