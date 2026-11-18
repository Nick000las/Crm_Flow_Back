import { describe, expect, it } from 'vitest';

import { SNAPSHOT_FORECAST } from '../constants.js';
import {
  linhasDoSnapshot,
  momentoDoSnapshot,
  segundaDaSemana,
  textoDeCentavos,
} from './forecast-snapshot.service.js';

const SAO_PAULO = 'America/Sao_Paulo';
const DONO = '11111111-1111-4111-8111-111111111111';
const NOV = '2026-11';
const DEZ = '2026-12';
const QTD_GANHAS = 2;
const QTD_ABERTAS = 3;
const CENTAVOS_NEGATIVOS = -5n;
const CENTAVOS_GRANDES = 123450n;
const ZERO = 0n;

/** @param {Partial<import('../adapters/crm-forecast.repository.js').LinhaAgregada>} extra */
const linha = (extra) => ({
  do_total: true,
  grupo_chave: null,
  grupo_rotulo: null,
  chave: NOV,
  realizado_quantidade: 0,
  realizado_soma: '0',
  ganhas_sem_valor: 0,
  aberto_quantidade: 0,
  aberto_soma: '0',
  aberto_ponderado: '0',
  previsto: '0',
  ...extra,
});

describe('segundaDaSemana', () => {
  it('a própria segunda, o meio da semana e o domingo', () => {
    expect(segundaDaSemana('2026-11-16')).toBe('2026-11-16');
    expect(segundaDaSemana('2026-11-18')).toBe('2026-11-16');
    expect(segundaDaSemana('2026-11-22')).toBe('2026-11-16');
  });

  it('vira o mês e o ano', () => {
    expect(segundaDaSemana('2026-12-01')).toBe('2026-11-30');
    expect(segundaDaSemana('2027-01-01')).toBe('2026-12-28');
    expect(segundaDaSemana('2027-01-03')).toBe('2026-12-28');
  });
});

describe('momentoDoSnapshot', () => {
  it('segunda 05:59 local é cedo; 06:00 já grava a semana', () => {
    // São Paulo é UTC−3: 08:59Z = 05:59 local.
    expect(momentoDoSnapshot(new Date('2026-11-16T08:59:00Z'), SAO_PAULO)).toEqual({
      hoje: '2026-11-16',
      semana: '2026-11-16',
      cedo: true,
    });

    expect(momentoDoSnapshot(new Date('2026-11-16T09:00:00Z'), SAO_PAULO)).toEqual({
      hoje: '2026-11-16',
      semana: '2026-11-16',
      cedo: false,
    });
  });

  it('domingo 23h local ainda é a semana anterior, mesmo já segunda em UTC', () => {
    expect(momentoDoSnapshot(new Date('2026-11-23T02:00:00Z'), SAO_PAULO)).toEqual({
      hoje: '2026-11-22',
      semana: '2026-11-16',
      cedo: false,
    });
  });

  it('madrugada de outro dia não é cedo', () => {
    expect(momentoDoSnapshot(new Date('2026-11-18T04:00:00Z'), SAO_PAULO).cedo).toBe(false);
  });

  it('virada de ano no fuso do tenant', () => {
    expect(momentoDoSnapshot(new Date('2027-01-01T12:00:00Z'), SAO_PAULO)).toEqual({
      hoje: '2027-01-01',
      semana: '2026-12-28',
      cedo: false,
    });
  });
});

describe('textoDeCentavos', () => {
  it('sempre com duas casas', () => {
    expect(textoDeCentavos(ZERO)).toBe('0.00');
    expect(textoDeCentavos(CENTAVOS_GRANDES)).toBe('1234.50');
    expect(textoDeCentavos(CENTAVOS_NEGATIVOS)).toBe('-0.05');
  });
});

describe('linhasDoSnapshot', () => {
  it('uma linha por mês, com o total e o by_owner; mês vazio grava zeros', () => {
    const linhas = [
      linha({
        realizado_quantidade: QTD_GANHAS,
        realizado_soma: '1000.5',
        aberto_quantidade: QTD_ABERTAS,
        aberto_soma: '3000',
        aberto_ponderado: '1200.25',
      }),
      linha({
        do_total: false,
        grupo_chave: DONO,
        grupo_rotulo: 'Maria',
        realizado_quantidade: QTD_GANHAS,
        realizado_soma: '1000.50',
        aberto_quantidade: 1,
        aberto_soma: '1000',
        aberto_ponderado: '400',
      }),
      linha({
        do_total: false,
        aberto_quantidade: QTD_ABERTAS - 1,
        aberto_soma: '2000',
        aberto_ponderado: '800.25',
      }),
      linha({ chave: 'atrasadas', aberto_quantidade: 1, aberto_soma: '99' }),
    ];

    expect(linhasDoSnapshot(linhas, [NOV, DEZ])).toEqual([
      {
        mes: '2026-11-01',
        realized: '1000.50',
        weighted: '1200.25',
        best_case: '3000.00',
        won_count: QTD_GANHAS,
        open_count: QTD_ABERTAS,
        by_owner: {
          [DONO]: {
            realized: '1000.50',
            weighted: '400.00',
            best_case: '1000.00',
            won_count: QTD_GANHAS,
            open_count: 1,
          },
          [SNAPSHOT_FORECAST.CHAVE_SEM_RESPONSAVEL]: {
            realized: '0.00',
            weighted: '800.25',
            best_case: '2000.00',
            won_count: 0,
            open_count: QTD_ABERTAS - 1,
          },
        },
      },
      {
        mes: '2026-12-01',
        realized: '0.00',
        weighted: '0.00',
        best_case: '0.00',
        won_count: 0,
        open_count: 0,
        by_owner: {},
      },
    ]);
  });
});
