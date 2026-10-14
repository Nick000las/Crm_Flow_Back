import { describe, it, expect } from 'vitest';
import { montarCondicoes } from './lead-filter.service.js';
import { CAMADA } from '../constants.js';

const CAMPOS = [
  { chave: 'nome', label: 'Nome', tipo: 'texto', camada: CAMADA.CAMADA_1 },
  { chave: 'status', label: 'Status', tipo: 'selecao', camada: CAMADA.CAMADA_1, opcoes: ['novo', 'ganho'] },
  { chave: 'tags', label: 'Tags', tipo: 'selecao_multipla', camada: CAMADA.CAMADA_1, opcoes: null },
  { chave: 'leadScore', label: 'Lead score', tipo: 'numero', camada: CAMADA.CAMADA_2 },
  { chave: 'segmento', label: 'Segmento', tipo: 'selecao', camada: CAMADA.CAMADA_3, opcoes: ['varejo', 'industria'] },
  { chave: 'renda', label: 'Renda', tipo: 'numero', camada: CAMADA.CAMADA_3 },
  { chave: 'aniversario', label: 'Aniversário', tipo: 'data', camada: CAMADA.CAMADA_3 },
];

const SCORE_MINIMO = 50;
const SCORE_MAXIMO = 90;

/** Junta o texto SQL de todas as condições, pra inspecionar o que foi gerado. */
function sqlDe(condicoes) {
  return condicoes.map((condicao) => condicao.sql).join(' AND ');
}

function valoresDe(condicoes) {
  return condicoes.flatMap((condicao) => condicao.values);
}

describe('montarCondicoes', () => {
  it('sem filtro nenhum, não gera condição', () => {
    expect(montarCondicoes({}, CAMPOS)).toEqual([]);
  });

  it('busca textual vira ILIKE parametrizado com % e _ escapados', () => {
    const condicoes = montarCondicoes({ busca: '50%_off' }, CAMPOS);
    expect(sqlDe(condicoes)).toContain('l.nome ILIKE');
    expect(valoresDe(condicoes)).toContain('%50\\%\\_off%');
  });

  it('Camada 1/2 usa a coluna real do mapa fechado, nunca o texto do cliente', () => {
    const condicoes = montarCondicoes(
      {
        filtros: [
          { chave: 'status', operador: 'igual', valor: 'ganho' },
          { chave: 'leadScore', operador: 'entre', valor: { de: SCORE_MINIMO, ate: SCORE_MAXIMO } },
        ],
      },
      CAMPOS,
    );
    const sql = sqlDe(condicoes);
    expect(sql).toContain('l.status =');
    expect(sql).toContain('l.lead_score >=');
    expect(sql).toContain('l.lead_score <=');
    expect(valoresDe(condicoes)).toEqual(['ganho', SCORE_MINIMO, SCORE_MAXIMO]);
  });

  it('valor malicioso continua sendo parâmetro, nunca SQL', () => {
    const ataque = "x'; DROP TABLE leads; --";
    const condicoes = montarCondicoes({ filtros: [{ chave: 'nome', operador: 'contem', valor: ataque }] }, CAMPOS);
    expect(sqlDe(condicoes)).not.toContain('DROP');
    expect(valoresDe(condicoes)).toContain(`%${ataque}%`);
  });

  it('Camada 3 de seleção usa containment (@>) pra aproveitar o GIN', () => {
    const condicoes = montarCondicoes(
      { filtros: [{ chave: 'segmento', operador: 'igual', valor: 'varejo' }] },
      CAMPOS,
    );
    expect(sqlDe(condicoes)).toContain('l.custom_fields @>');
    expect(valoresDe(condicoes)).toContain(JSON.stringify({ segmento: 'varejo' }));
  });

  it('Camada 3 numérica usa cast protegido por jsonb_typeof', () => {
    const condicoes = montarCondicoes(
      { filtros: [{ chave: 'renda', operador: 'entre', valor: { de: SCORE_MINIMO } }] },
      CAMPOS,
    );
    expect(sqlDe(condicoes)).toContain('jsonb_typeof');
  });

  it('tags (array nativo) usa ANY / && em vez de igualdade', () => {
    const contem = montarCondicoes({ filtros: [{ chave: 'tags', operador: 'contem', valor: 'vip' }] }, CAMPOS);
    expect(sqlDe(contem)).toContain('= ANY(l.tags)');

    const algum = montarCondicoes({ filtros: [{ chave: 'tags', operador: 'e_um_dos', valor: ['vip', 'b2b'] }] }, CAMPOS);
    expect(sqlDe(algum)).toContain('l.tags &&');
  });

  it('rejeita campo que não está entre os ativos (ex: Camada 2 desligada)', () => {
    expect(() =>
      montarCondicoes({ filtros: [{ chave: 'cpf', operador: 'igual', valor: '123' }] }, CAMPOS),
    ).toThrow('"cpf" não é um campo ativo para filtro');
  });

  it('rejeita operador incompatível com o tipo', () => {
    expect(() =>
      montarCondicoes({ filtros: [{ chave: 'leadScore', operador: 'contem', valor: 'x' }] }, CAMPOS),
    ).toThrow('Operador "contem" não se aplica');
  });

  it('rejeita valor de tipo errado', () => {
    expect(() =>
      montarCondicoes({ filtros: [{ chave: 'leadScore', operador: 'igual', valor: 'alto' }] }, CAMPOS),
    ).toThrow('Informe um número');
    expect(() =>
      montarCondicoes({ filtros: [{ chave: 'aniversario', operador: 'igual', valor: 'ontem' }] }, CAMPOS),
    ).toThrow('Informe uma data válida');
  });

  it('entre sem "de" nem "ate" é rejeitado', () => {
    expect(() =>
      montarCondicoes({ filtros: [{ chave: 'leadScore', operador: 'entre', valor: {} }] }, CAMPOS),
    ).toThrow('Informe "de" e/ou "ate"');
  });

  it('vazio/nao_vazio não exigem valor', () => {
    const condicoes = montarCondicoes(
      {
        filtros: [
          { chave: 'nome', operador: 'nao_vazio' },
          { chave: 'segmento', operador: 'vazio' },
        ],
      },
      CAMPOS,
    );
    expect(condicoes).toHaveLength(['nome', 'segmento'].length);
  });
});
