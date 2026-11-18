import { describe, expect, it } from 'vitest';

import { AGRUPAMENTOS_FORECAST, BLOCOS_FORECAST, LIMITES_FORECAST } from '../constants.js';
import {
  camposDesligados,
  centavos,
  chaveDoCache,
  deslocarMes,
  itemParaOPapel,
  mascararValores,
  mesesDoPeriodo,
  montarAgregado,
  periodoDoPedido,
  periodoPadrao,
} from './forecast.service.js';

const HOJE = '2026-11-19';
const UM_ANO = 12;
const DOIS_MESES = 2;
const MESES_DO_PADRAO = 7;
const NOV = '2026-11';
const DEZ = '2026-12';
const MESES = [NOV, DEZ];
const QTD_GANHAS = 2;
const QTD_ABERTAS = 3;
const QTD_SEM_VALOR = 4;
const QTD_FORA = 9;
const SOMA_GANHAS = 3000.5;
const MELHOR_CASO = 4000;
const PONDERADO = 1200.25;
const PREVISTO = 4200.75;
const ATRASADAS_SOMA = 500;
const ATRASADAS_PONDERADO = 200;
const VALOR = 1000;
const PROBABILIDADE = 60;
const PONDERADO_ITEM = 600;
const CENTAVOS_ZERO = 0n;
const CENTAVOS_GANHAS = 300050n;
const CENTAVOS_PONDERADO = 120025n;
const CENTAVOS_MAXIMO = 9999999999999999n;

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

const TODOS_OS_CAMPOS = {
  campos: ['valor', 'probabilidadeFechamento', 'dataPrevistaFechamento', 'status'].map((chave) => ({
    chave,
  })),
};

describe('meses do forecast', () => {
  it('desloca para frente e para trás, virando o ano', () => {
    expect(deslocarMes(NOV, DOIS_MESES)).toBe('2027-01');
    expect(deslocarMes('2026-01', -1)).toBe('2025-12');
    expect(deslocarMes(NOV, -UM_ANO)).toBe('2025-11');
  });

  it('lista o período inteiro, inclusive', () => {
    expect(mesesDoPeriodo('2026-11', '2027-02')).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);

    expect(mesesDoPeriodo(NOV, NOV)).toEqual([NOV]);
  });

  it('padrão: mês atual −3 a +3', () => {
    expect(periodoPadrao(HOJE)).toEqual({ de: '2026-08', ate: '2027-02' });

    const { de, ate } = periodoDoPedido({}, HOJE);

    expect(mesesDoPeriodo(de, ate)).toHaveLength(MESES_DO_PADRAO);
  });

  it('completa só o que faltou', () => {
    expect(periodoDoPedido({ de: '2026-10' }, HOJE)).toEqual({ de: '2026-10', ate: '2027-02' });
    expect(periodoDoPedido({ ate: '2026-12' }, HOJE)).toEqual({ de: '2026-08', ate: '2026-12' });
  });

  it('de depois de ate é 400 em de', () => {
    expect(() => periodoDoPedido({ de: DEZ, ate: NOV }, HOJE)).toThrow(
      expect.objectContaining({ fields: { de: [expect.any(String)] } }),
    );
  });

  it('aceita até o limite de meses e recusa um a mais, em ate', () => {
    const de = '2026-01';
    const noLimite = deslocarMes(de, LIMITES_FORECAST.MESES_MAXIMOS - 1);

    expect(periodoDoPedido({ de, ate: noLimite }, HOJE)).toEqual({ de, ate: noLimite });

    expect(() => periodoDoPedido({ de, ate: deslocarMes(noLimite, 1) }, HOJE)).toThrow(
      expect.objectContaining({ fields: { ate: [expect.any(String)] } }),
    );
  });
});

describe('centavos', () => {
  it('converte o decimal do banco sem float', () => {
    expect(centavos('0')).toBe(CENTAVOS_ZERO);
    expect(centavos('3000.5')).toBe(CENTAVOS_GANHAS);
    expect(centavos('1200.25')).toBe(CENTAVOS_PONDERADO);
    expect(centavos('99999999999999.99')).toBe(CENTAVOS_MAXIMO);
  });
});

describe('montarAgregado', () => {
  it('sem linha: todos os meses e blocos zerados', () => {
    const agregado = montarAgregado([], MESES, AGRUPAMENTOS_FORECAST.TOTAL);

    expect(agregado.meses.map((mes) => mes.mes)).toEqual(MESES);

    expect(agregado.meses[0]).toEqual({
      mes: NOV,
      realizado: { quantidade: 0, soma: 0 },
      ponderado: { quantidade: 0, soma: 0 },
      melhorCaso: { soma: 0 },
      previsto: 0,
      ganhasSemValor: 0,
    });

    expect(agregado.blocos).toEqual({
      atrasadas: { quantidade: 0, soma: 0, ponderado: 0 },
      antesDoPeriodo: { quantidade: 0, soma: 0, ponderado: 0 },
      semPrevisao: { quantidade: 0, soma: 0, ponderado: 0 },
      alemDoHorizonte: { quantidade: 0, soma: 0, ponderado: 0 },
      semValor: { quantidade: 0 },
    });

    expect(agregado.grupos).toEqual([]);
  });

  it('preenche mês e blocos com os números do banco', () => {
    const agregado = montarAgregado(
      [
        linha({
          realizado_quantidade: QTD_GANHAS,
          realizado_soma: '3000.50',
          ganhas_sem_valor: 1,
          aberto_quantidade: QTD_ABERTAS,
          aberto_soma: '4000.00',
          aberto_ponderado: '1200.25',
          previsto: '4200.75',
        }),
        linha({
          chave: BLOCOS_FORECAST.ATRASADAS,
          aberto_quantidade: 1,
          aberto_soma: '500',
          aberto_ponderado: '200',
          previsto: '200',
        }),
        linha({ chave: BLOCOS_FORECAST.SEM_VALOR, aberto_quantidade: QTD_SEM_VALOR }),
        // Mês fora do período não entra.
        linha({ chave: '2027-05', aberto_quantidade: QTD_FORA, previsto: '9' }),
      ],
      MESES,
      AGRUPAMENTOS_FORECAST.TOTAL,
    );

    expect(agregado.meses[0]).toEqual({
      mes: NOV,
      realizado: { quantidade: QTD_GANHAS, soma: SOMA_GANHAS },
      ponderado: { quantidade: QTD_ABERTAS, soma: PONDERADO },
      melhorCaso: { soma: MELHOR_CASO },
      previsto: PREVISTO,
      ganhasSemValor: 1,
    });

    expect(agregado.meses).toHaveLength(MESES.length);

    expect(agregado.blocos.atrasadas).toEqual({
      quantidade: 1,
      soma: ATRASADAS_SOMA,
      ponderado: ATRASADAS_PONDERADO,
    });

    expect(agregado.blocos.semValor).toEqual({ quantidade: QTD_SEM_VALOR });
  });

  it('grupos: os totais do topo vêm das linhas do total, ordem por previsto e rótulo', () => {
    const bia = { do_total: false, grupo_chave: 'u1', grupo_rotulo: 'Bia' };
    const agregado = montarAgregado(
      [
        linha({ aberto_quantidade: QTD_ABERTAS, previsto: '30' }),
        linha({ ...bia, aberto_quantidade: 1, previsto: '10' }),
        linha({ ...bia, aberto_quantidade: 1, chave: DEZ }),
        linha({ do_total: false, grupo_chave: 'u2', grupo_rotulo: 'Ana', aberto_quantidade: 1 }),
        linha({
          do_total: false,
          grupo_chave: null,
          aberto_quantidade: 1,
          previsto: '10.00',
        }),
        linha({
          do_total: false,
          grupo_chave: 'u3',
          grupo_rotulo: 'Caio',
          aberto_quantidade: 1,
          previsto: '20',
        }),
      ],
      MESES,
      AGRUPAMENTOS_FORECAST.RESPONSAVEL,
    );

    expect(agregado.meses[0].ponderado.quantidade).toBe(QTD_ABERTAS);

    expect(agregado.grupos.map((grupo) => grupo.rotulo)).toEqual([
      'Caio',
      'Bia',
      'Sem responsável',
      'Ana',
    ]);

    expect(agregado.grupos.find((grupo) => grupo.chave === null)?.rotulo).toBe('Sem responsável');
    expect(agregado.grupos[1].meses).toHaveLength(MESES.length);
  });

  it('grupo sem oportunidade no período fica de fora', () => {
    const agregado = montarAgregado(
      [linha({ do_total: false, grupo_chave: 'novo', grupo_rotulo: 'Novo', chave: '2030-01' })],
      MESES,
      AGRUPAMENTOS_FORECAST.STATUS,
    );

    expect(agregado.grupos).toEqual([]);
  });
});

describe('mascararValores', () => {
  it('dinheiro vira null; contagens ficam', () => {
    const agregado = montarAgregado(
      [
        linha({ realizado_quantidade: 1, realizado_soma: '10', previsto: '10' }),
        linha({ chave: BLOCOS_FORECAST.SEM_VALOR, aberto_quantidade: QTD_SEM_VALOR }),
        linha({ do_total: false, grupo_chave: 'x', grupo_rotulo: 'X', realizado_quantidade: 1 }),
      ],
      MESES,
      AGRUPAMENTOS_FORECAST.STATUS,
    );
    const mascarado = mascararValores(agregado);

    expect(mascarado.meses[0]).toEqual({
      mes: NOV,
      realizado: { quantidade: 1, soma: null },
      ponderado: { quantidade: 0, soma: null },
      melhorCaso: { soma: null },
      previsto: null,
      ganhasSemValor: 0,
    });

    expect(mascarado.blocos.atrasadas).toEqual({ quantidade: 0, soma: null, ponderado: null });
    expect(mascarado.blocos.semValor).toEqual({ quantidade: QTD_SEM_VALOR });
    expect(mascarado.grupos[0].meses[0].previsto).toBeNull();
    expect(mascarado.grupos[0].blocos.semPrevisao.soma).toBeNull();
    // O original não muda (é o que fica em cache).
    expect(agregado.meses[0].realizado.soma).not.toBeNull();
  });
});

describe('camposDesligados', () => {
  it('lista os campos do forecast que o papel não tem', () => {
    expect(camposDesligados(TODOS_OS_CAMPOS)).toEqual([]);

    expect(camposDesligados({ campos: [{ chave: 'probabilidadeFechamento' }] })).toEqual([
      'dataPrevistaFechamento',
    ]);
  });
});

describe('itemParaOPapel', () => {
  const ATUALIZADA = new Date('2026-11-01T12:00:00Z');
  const bruta = {
    id: 'd1',
    lead_id: 'l1',
    pessoa: 'Ana',
    pipeline_id: 'p1',
    status: 'proposta',
    status_label: 'Proposta',
    status_category: 'aberto',
    valor: '1000.00',
    probabilidade: PROBABILIDADE,
    ponderado: '600.00',
    data_prevista: '2026-12-10',
    won_at: null,
    owner_id: null,
    updated_at: ATUALIZADA,
  };

  it('formata a linha para quem vê tudo', () => {
    expect(itemParaOPapel(bruta, TODOS_OS_CAMPOS)).toEqual({
      id: 'd1',
      leadId: 'l1',
      pessoa: 'Ana',
      pipelineId: 'p1',
      status: 'proposta',
      statusLabel: 'Proposta',
      categoria: 'aberto',
      valor: VALOR,
      probabilidadeEfetiva: PROBABILIDADE,
      ponderado: PONDERADO_ITEM,
      dataPrevistaFechamento: '2026-12-10',
      ganhaEm: null,
      responsavelId: null,
      atualizadaEm: ATUALIZADA,
    });
  });

  it('sem valor nulo vira null, não zero', () => {
    const item = itemParaOPapel({ ...bruta, valor: null, ponderado: null }, TODOS_OS_CAMPOS);

    expect(item.valor).toBeNull();
    expect(item.ponderado).toBeNull();
  });

  it('remove as chaves do que o papel não vê', () => {
    const item = itemParaOPapel(bruta, { campos: [] });

    for (const chave of [
      'valor',
      'ponderado',
      'probabilidadeEfetiva',
      'dataPrevistaFechamento',
      'status',
      'statusLabel',
      'categoria',
      'ganhaEm',
    ]) {
      expect(item).not.toHaveProperty(chave);
    }

    expect(item).toHaveProperty('pessoa', 'Ana');
  });
});

describe('chaveDoCache', () => {
  it('muda com a marca e com o pedido; o hash é curto', () => {
    const pedido = { de: NOV, ate: DEZ, ocultos: [] };
    const chave = chaveDoCache('t1', 'm1', pedido);

    expect(chave).toMatch(/^crm:forecast:t1:m1:[0-9a-f]{16}$/);
    expect(chaveDoCache('t1', 'm2', pedido)).not.toBe(chave);
    expect(chaveDoCache('t1', 'm1', { ...pedido, ate: NOV })).not.toBe(chave);
    expect(chaveDoCache('t1', 'm1', { ...pedido })).toBe(chave);
  });
});
