import { describe, expect, it } from 'vitest';

import { filtroLeadsSchema, pesquisarLeadsBodySchema } from './leads-search.schema.js';
import { filtroDoQuadroSchema } from './quadro-comercial.schema.js';

const DUAS = 2;
const MEIA = 1.5;
const DATA_COMO_NUMERO = 20261031;

/** @param {unknown} filtro */
const errosDe = (filtro) => {
  const resultado = filtroLeadsSchema.safeParse(filtro);

  return resultado.success ? {} : resultado.error.flatten().fieldErrors;
};

describe('filtros do ciclo de vida no filtroLeadsSchema (FC4)', () => {
  it('aceita todos juntos e mantém as datas como texto', () => {
    const filtro = {
      cicloDeVida: ['lead', 'cliente'],
      clienteDesdeDe: '2026-01-01',
      clienteDesdeAte: '2026-10-31',
      ultimaCompraDe: '2026-02-28',
      ultimaCompraAte: '2026-12-31',
      oportunidadesAbertasMin: 0,
      oportunidadesAbertasMax: DUAS,
    };

    expect(filtroLeadsSchema.parse(filtro)).toEqual({ ...filtro, filtros: [] });
  });

  it('ciclo: lista não vazia, sem repetição, só lead|oportunidade|cliente', () => {
    expect(errosDe({ cicloDeVida: [] }).cicloDeVida).toEqual(['Escolha ao menos um ciclo de vida']);

    expect(errosDe({ cicloDeVida: ['lead', 'lead'] }).cicloDeVida).toEqual([
      'Ciclo de vida repetido',
    ]);

    expect(errosDe({ cicloDeVida: ['prospect'] }).cicloDeVida).toEqual([
      'Ciclo de vida deve ser um de: lead, oportunidade, cliente',
    ]);

    expect(errosDe({ cicloDeVida: 'lead' }).cicloDeVida).toEqual([
      'Informe uma lista de ciclos de vida',
    ]);
  });

  it('datas: só AAAA-MM-DD de um dia que existe', () => {
    expect(errosDe({ clienteDesdeDe: '31/10/2026' }).clienteDesdeDe).toEqual([
      'Informe uma data no formato AAAA-MM-DD',
    ]);

    expect(errosDe({ ultimaCompraAte: '2026-10-31T23:59:59Z' }).ultimaCompraAte).toEqual([
      'Informe uma data no formato AAAA-MM-DD',
    ]);

    expect(errosDe({ clienteDesdeAte: '2026-02-30' }).clienteDesdeAte).toEqual([
      'Informe uma data válida',
    ]);

    expect(errosDe({ ultimaCompraDe: DATA_COMO_NUMERO }).ultimaCompraDe).toEqual([
      'Informe uma data no formato AAAA-MM-DD',
    ]);

    expect(errosDe({ clienteDesdeDe: '2028-02-29' })).toEqual({});
  });

  it('abertas: inteiro maior ou igual a zero', () => {
    expect(errosDe({ oportunidadesAbertasMin: -1 }).oportunidadesAbertasMin).toEqual([
      'A quantidade não pode ser negativa',
    ]);

    expect(errosDe({ oportunidadesAbertasMax: MEIA }).oportunidadesAbertasMax).toEqual([
      'Informe uma quantidade inteira',
    ]);

    expect(errosDe({ oportunidadesAbertasMax: '2' }).oportunidadesAbertasMax).toEqual([
      'Informe uma quantidade válida',
    ]);
  });

  it('vale também na busca paginada e no quadro', () => {
    expect(pesquisarLeadsBodySchema.safeParse({ cicloDeVida: ['x'] }).success).toBe(false);

    expect(filtroDoQuadroSchema.parse({ oportunidadesAbertasMin: 1 })).toMatchObject({
      oportunidadesAbertasMin: 1,
    });
  });
});
