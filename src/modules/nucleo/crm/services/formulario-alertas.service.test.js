import { describe, expect, it } from 'vitest';

import { CAMADA } from '../constants.js';
import { alertasDaResposta } from './formulario-alertas.service.js';
import { camposElegiveis, validarRascunho, valorDaCondicao } from './formularios.service.js';

const ALERGIAS = '00000000-0000-0000-0000-0000000000c1';
const IDADE = '00000000-0000-0000-0000-0000000000c2';
const FUMA = '00000000-0000-0000-0000-0000000000c3';
const DOR = '00000000-0000-0000-0000-0000000000c4';
const DESCONHECIDO = '00000000-0000-0000-0000-0000000000c9';
const IDADE_LIMITE = 60;
const IDADE_ALTA = 72;

const ELEGIVEIS = camposElegiveis([
  {
    id: ALERGIAS,
    chave: 'alergias',
    label: 'Alergias',
    tipo: 'texto',
    camada: CAMADA.CAMADA_3,
    sensivel: true,
  },
  { id: IDADE, chave: 'idade', label: 'Idade', tipo: 'numero', camada: CAMADA.CAMADA_3 },
]);

const ITENS_DO_RASCUNHO = [
  { campoId: ALERGIAS },
  { campoId: IDADE },
  { pergunta: { id: FUMA, rotulo: 'Fuma?', tipo: 'booleano', sensivel: true } },
  { pergunta: { id: DOR, rotulo: 'Dor', tipo: 'selecao', opcoes: ['Leve', 'Forte'] } },
];
const comAlertas = (alertas) => ({ secoes: [{ itens: ITENS_DO_RASCUNHO }], alertas });
const alerta = (extra) => ({ nivel: 'critical', texto: ' Atenção ', ...extra });

describe('regras de alerta no rascunho', () => {
  it('normaliza: id gerado, texto aparado, valor do tipo', () => {
    const { alertas } = validarRascunho(
      comAlertas([
        alerta({ alvo: { campoId: ALERGIAS }, operador: 'contem', valor: ' dipirona ' }),
        alerta({ alvo: { perguntaId: FUMA }, operador: 'igual', valor: true, nivel: 'warning' }),
        alerta({ alvo: { perguntaId: DOR }, operador: 'nao_vazio', valor: 'ignorado' }),
      ]),
      ELEGIVEIS,
    );

    expect(alertas[0]).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      alvo: { campoId: ALERGIAS },
      operador: 'contem',
      valor: 'dipirona',
      nivel: 'critical',
      texto: 'Atenção',
    });

    expect(alertas[1]).toMatchObject({ alvo: { perguntaId: FUMA }, valor: true });
    expect(alertas[2]).not.toHaveProperty('valor');
  });

  it('alvo fora do rascunho, operador que não vale para o tipo e valor inválido são 400', () => {
    expect(() =>
      validarRascunho(
        comAlertas([
          alerta({ alvo: { campoId: DESCONHECIDO }, operador: 'nao_vazio' }),
          alerta({ alvo: { perguntaId: FUMA }, operador: 'contem', valor: 'x' }),
          alerta({ alvo: { perguntaId: DOR }, operador: 'igual', valor: 'Média' }),
          alerta({ alvo: { campoId: IDADE }, operador: 'entre', valor: {} }),
        ]),
        ELEGIVEIS,
      ),
    ).toThrow(
      expect.objectContaining({
        fields: {
          'rascunho.alertas.0.alvo': [expect.any(String)],
          'rascunho.alertas.1.operador': [expect.any(String)],
          'rascunho.alertas.2.operador': [expect.any(String)],
          'rascunho.alertas.3.operador': [expect.any(String)],
        },
      }),
    );
  });

  it('valorDaCondicao: lista e intervalo pelo tipo do elemento', () => {
    expect(
      valorDaCondicao({ tipo: 'selecao', opcoes: ['Leve', 'Forte'] }, 'e_um_dos', ['Forte']),
    ).toEqual({
      valor: ['Forte'],
    });

    expect(
      valorDaCondicao({ tipo: 'numero', opcoes: null }, 'entre', { de: IDADE_LIMITE }),
    ).toEqual({ valor: { de: IDADE_LIMITE, ate: null } });
  });
});

describe('alertasDaResposta', () => {
  const itens = [
    { chave: ALERGIAS, ehPergunta: false, tipo: 'texto', sensivel: true },
    { chave: IDADE, ehPergunta: false, tipo: 'numero', sensivel: false },
    { chave: FUMA, ehPergunta: true, tipo: 'booleano', sensivel: true },
  ];
  const regras = [
    {
      id: 'r1',
      alvo: { campoId: ALERGIAS },
      operador: 'contem',
      valor: 'dipirona',
      nivel: 'critical',
      texto: 'Alergia',
    },
    {
      id: 'r2',
      alvo: { campoId: IDADE },
      operador: 'entre',
      valor: { de: IDADE_LIMITE, ate: null },
      nivel: 'info',
      texto: 'Idoso',
    },
    {
      id: 'r3',
      alvo: { perguntaId: FUMA },
      operador: 'igual',
      valor: true,
      nivel: 'warning',
      texto: 'Fumante',
    },
    { id: 'r4', alvo: { campoId: DESCONHECIDO }, operador: 'vazio', nivel: 'info', texto: 'Nunca' },
  ];

  it('só as regras que casam, com a marca de sensível do alvo', () => {
    expect(
      alertasDaResposta(regras, itens, {
        campos: { [ALERGIAS]: 'Dipirona e AAS', [IDADE]: IDADE_ALTA },
        perguntas: { [FUMA]: false },
      }),
    ).toEqual([
      { regraId: 'r1', nivel: 'critical', texto: 'Alergia', sensivel: true },
      { regraId: 'r2', nivel: 'info', texto: 'Idoso', sensivel: false },
    ]);
  });

  it('sem resposta não casa operador com valor', () => {
    expect(alertasDaResposta(regras, itens, { campos: {}, perguntas: {} })).toEqual([]);
  });
});
