import { describe, expect, it } from 'vitest';
import {
  LIMITES_ASSERTIVIDADE,
  LIMITES_FORECAST,
  ROTULO_RESPONSAVEL_REMOVIDO,
  ROTULO_SEM_RESPONSAVEL,
  SNAPSHOT_FORECAST,
} from '../constants.js';
import {
  montarMesDaAssertividade,
  montarPorResponsavel,
  periodoDaAssertividade,
  razao,
  realizadosPorMes,
  snapshotsPorMes,
} from './forecast-assertividade.service.js';
import { deslocarMes, mesesDoPeriodo } from './forecast.service.js';

const HOJE = '2026-11-20';
const OUT = '2026-10';
const SET = '2026-09';
const MARIA = '11111111-1111-4111-8111-111111111111';
const JOAO = '22222222-2222-4222-8222-222222222222';
const SUMIDO = '33333333-3333-4333-8333-333333333333';
const SEM = SNAPSHOT_FORECAST.CHAVE_SEM_RESPONSAVEL;
const NOMES = new Map([
  [MARIA, 'Maria'],
  [JOAO, 'João'],
]);
const QTD = 2;
const HTTP_INVALIDO = 400;
const ZERO = 0n;
const C_TOTAL_OUT = 1100000n;
const C_MARIA = 700000n;
const C_SEM = 400000n;
const C_JOAO = 100000n;
const C_SUMIDO = 300000n;
const C_TOTAL_SET = 900000n;
const REALIZADO_SET = 9000;
const PREVISTO_TOTAL = 12000.5;
const REALIZADO_NO_SNAPSHOT = 2000;
const PONDERADO_NO_SNAPSHOT = 10000.5;
const REALIZADO = 11000;
const ASSERTIVIDADE = 0.9166;
const PREVISTO_MARIA = 8000;
const REALIZADO_MARIA = 7000;
const ASSERTIVIDADE_MARIA = 0.875;
const PREVISTO_JOAO = 4000.5;
const REALIZADO_JOAO = 1000;
const ASSERTIVIDADE_JOAO = 0.25;
const REALIZADO_SUMIDO = 3000;
const CENTAVOS_UM_TERCO = 100n;
const CENTAVOS_TRES = 300n;
const UM_TERCO = 0.3333;
const CENTAVOS_DOIS_TERCOS = 200n;
const DOIS_TERCOS = 0.6667;
const CENTAVOS_DOBRO = 600n;
const DOBRO = 2;

/** @param {Partial<import('../adapters/crm-forecast.repository.js').LinhaAgregada>} extra */
const linha = (extra) => ({
  do_total: true,
  grupo_chave: null,
  grupo_rotulo: null,
  chave: OUT,
  realizado_quantidade: 0,
  realizado_soma: '0',
  ganhas_sem_valor: 0,
  aberto_quantidade: 0,
  aberto_soma: '0',
  aberto_ponderado: '0',
  previsto: '0',
  ...extra,
});

/** @param {string} realized @param {string} weighted */
const numeros = (realized, weighted) => ({
  realized,
  weighted,
  best_case: '0.00',
  won_count: 0,
  open_count: 0,
});

/** @param {Partial<import('../adapters/crm-forecast-snapshot.repository.js').SnapshotGravado>} extra */
const snapshot = (extra) => ({
  mes: OUT,
  semana: '2026-10-05',
  tirado_em: new Date('2026-10-05T09:00:00.000Z'),
  realized: '2000.00',
  weighted: '10000.50',
  by_owner: {},
  ...extra,
});

describe('periodoDaAssertividade', () => {
  it('sem período: os seis meses fechados antes do atual', () => {
    const { de, ate } = periodoDaAssertividade({}, HOJE);
    expect({ de, ate }).toEqual({ de: '2026-05', ate: OUT });
    expect(mesesDoPeriodo(de, ate)).toHaveLength(LIMITES_ASSERTIVIDADE.MESES_PADRAO);
  });

  it('só `ate`: seis meses até ele; só `de`: até o mês anterior', () => {
    expect(periodoDaAssertividade({ ate: SET }, HOJE)).toEqual({ de: '2026-04', ate: SET });
    expect(periodoDaAssertividade({ de: SET }, HOJE)).toEqual({ de: SET, ate: OUT });
  });

  it('de depois de ate é 400 em de', () => {
    expect(() => periodoDaAssertividade({ de: OUT, ate: SET }, HOJE)).toThrow(
      expect.objectContaining({ statusCode: HTTP_INVALIDO, fields: { de: [expect.any(String)] } }),
    );
  });

  it('aceita até o limite de meses e recusa um a mais, em ate', () => {
    const de = deslocarMes(OUT, 1 - LIMITES_FORECAST.MESES_MAXIMOS);
    expect(periodoDaAssertividade({ de, ate: OUT }, HOJE)).toEqual({ de, ate: OUT });
    expect(() => periodoDaAssertividade({ de: deslocarMes(de, -1), ate: OUT }, HOJE)).toThrow(
      expect.objectContaining({ fields: { ate: [expect.any(String)] } }),
    );
  });

  it('o mês atual ou depois é 400 em ate: só meses fechados', () => {
    for (const ate of ['2026-11', '2026-12']) {
      expect(() => periodoDaAssertividade({ de: SET, ate }, HOJE)).toThrow(
        expect.objectContaining({ fields: { ate: [expect.stringMatching(/fechados/)] } }),
      );
    }
  });
});

describe('snapshotsPorMes', () => {
  it('vale o de menor tirado_em com a semana dentro do mês', () => {
    const primeiro = snapshot({});
    const segundo = snapshot({
      semana: '2026-10-12',
      tirado_em: new Date('2026-10-12T09:00:00.000Z'),
    });
    const daSemanaDeSetembro = snapshot({
      semana: '2026-09-28',
      tirado_em: new Date('2026-09-28T09:00:00.000Z'),
    });
    const escolhidos = snapshotsPorMes([segundo, daSemanaDeSetembro, primeiro]);
    expect(escolhidos.get(OUT)).toBe(primeiro);
    expect(escolhidos.has(SET)).toBe(false);
  });

  it('só snapshot de semana do mês anterior: mês sem dados', () => {
    const escolhidos = snapshotsPorMes([snapshot({ semana: '2026-09-28' })]);
    expect(escolhidos.size).toBe(0);
  });
});

describe('razao', () => {
  it('quatro casas, arredondada, e previsto zero dá null', () => {
    expect(razao(CENTAVOS_UM_TERCO, CENTAVOS_TRES)).toBe(UM_TERCO);
    expect(razao(CENTAVOS_DOIS_TERCOS, CENTAVOS_TRES)).toBe(DOIS_TERCOS);
    expect(razao(CENTAVOS_DOBRO, CENTAVOS_TRES)).toBe(DOBRO);
    expect(razao(CENTAVOS_UM_TERCO, ZERO)).toBeNull();
    expect(razao(ZERO, ZERO)).toBeNull();
  });
});

describe('realizadosPorMes', () => {
  it('total e por dono, só de quem ganhou no mês', () => {
    const realizados = realizadosPorMes([
      linha({ realizado_quantidade: QTD, realizado_soma: '11000.00' }),
      linha({
        do_total: false,
        grupo_chave: MARIA,
        realizado_quantidade: 1,
        realizado_soma: '7000',
      }),
      linha({ do_total: false, realizado_quantidade: 1, realizado_soma: '4000' }),
      linha({ do_total: false, grupo_chave: JOAO, aberto_quantidade: 1, aberto_soma: '50' }),
    ]);
    const outubro = realizados.get(OUT);
    expect(outubro?.total).toBe(C_TOTAL_OUT);
    expect([...(outubro?.porDono.entries() ?? [])]).toEqual([
      [MARIA, C_MARIA],
      [SEM, C_SEM],
    ]);
  });
});

describe('montarPorResponsavel', () => {
  it('união do snapshot com o realizado, rótulos e ordem por previsto', () => {
    const doSnapshot = snapshot({
      by_owner: {
        [JOAO]: numeros('0.00', '4000.50'),
        [MARIA]: numeros('1000.00', '7000.00'),
        [SEM]: numeros('0.00', '0.00'),
      },
    });
    const realizado = new Map([
      [MARIA, C_MARIA],
      [JOAO, C_JOAO],
      [SUMIDO, C_SUMIDO],
    ]);

    expect(montarPorResponsavel(doSnapshot, realizado, NOMES)).toEqual([
      {
        responsavelId: MARIA,
        rotulo: 'Maria',
        previsto: PREVISTO_MARIA,
        realizado: REALIZADO_MARIA,
        assertividade: ASSERTIVIDADE_MARIA,
      },
      {
        responsavelId: JOAO,
        rotulo: 'João',
        previsto: PREVISTO_JOAO,
        realizado: REALIZADO_JOAO,
        assertividade: ASSERTIVIDADE_JOAO,
      },
      {
        responsavelId: SUMIDO,
        rotulo: ROTULO_RESPONSAVEL_REMOVIDO,
        previsto: 0,
        realizado: REALIZADO_SUMIDO,
        assertividade: null,
      },
      {
        responsavelId: null,
        rotulo: ROTULO_SEM_RESPONSAVEL,
        previsto: 0,
        realizado: 0,
        assertividade: null,
      },
    ]);
  });
});

describe('montarMesDaAssertividade', () => {
  it('com snapshot: previsto = realizado + ponderado no snapshot', () => {
    const mes = montarMesDaAssertividade(
      OUT,
      snapshot({}),
      { total: C_TOTAL_OUT, porDono: new Map() },
      NOMES,
    );
    expect(mes).toEqual({
      mes: OUT,
      semDados: false,
      snapshot: { semana: '2026-10-05', tiradoEm: new Date('2026-10-05T09:00:00.000Z') },
      previsto: PREVISTO_TOTAL,
      realizadoNoSnapshot: REALIZADO_NO_SNAPSHOT,
      ponderadoNoSnapshot: PONDERADO_NO_SNAPSHOT,
      realizado: REALIZADO,
      assertividade: ASSERTIVIDADE,
      porResponsavel: [],
    });
  });

  it('sem snapshot: só o realizado', () => {
    expect(
      montarMesDaAssertividade(SET, undefined, { total: C_TOTAL_SET, porDono: new Map() }, NOMES),
    ).toEqual({
      mes: SET,
      semDados: true,
      snapshot: null,
      previsto: null,
      realizadoNoSnapshot: null,
      ponderadoNoSnapshot: null,
      realizado: REALIZADO_SET,
      assertividade: null,
      porResponsavel: [],
    });
  });

  it('previsto zero no snapshot: assertividade null', () => {
    const mes = montarMesDaAssertividade(
      OUT,
      snapshot({ realized: '0.00', weighted: '0.00' }),
      undefined,
      NOMES,
    );
    expect(mes.previsto).toBe(0);
    expect(mes.realizado).toBe(0);
    expect(mes.assertividade).toBeNull();
  });
});
