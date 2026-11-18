import { describe, expect, it } from 'vitest';

import { CAMADA } from '../constants.js';
import {
  entradaDoLead,
  itensDaVersao,
  planejarPelaPolitica,
  validarRespostas,
} from './formulario-respostas.service.js';

const NOME = '00000000-0000-0000-0000-0000000000b1';
const EMAIL = '00000000-0000-0000-0000-0000000000b2';
const ALERGIAS = '00000000-0000-0000-0000-0000000000b3';
const DOR = '00000000-0000-0000-0000-0000000000b4';
const FUMA = '00000000-0000-0000-0000-0000000000b5';

const RETRATOS = {
  [NOME]: { chave: 'nome', label: 'Nome', tipo: 'texto', camada: CAMADA.CAMADA_1, opcoes: null },
  [EMAIL]: {
    chave: 'email',
    label: 'E-mail',
    tipo: 'email',
    camada: CAMADA.CAMADA_1,
    opcoes: null,
  },
  [ALERGIAS]: {
    chave: 'alergias',
    label: 'Alergias',
    tipo: 'texto',
    camada: CAMADA.CAMADA_3,
    opcoes: null,
  },
};
const SECOES = [
  {
    titulo: null,
    itens: [
      { campoId: NOME, obrigatorio: true, politica: 'overwrite' },
      { campoId: EMAIL, obrigatorio: false, politica: 'fill_if_empty', preencher: false },
      { campoId: ALERGIAS, obrigatorio: false, politica: 'overwrite', preencher: true },
      {
        pergunta: {
          id: DOR,
          rotulo: 'Dor',
          tipo: 'selecao',
          opcoes: ['Leve', 'Forte'],
          sensivel: true,
        },
        obrigatorio: false,
      },
      {
        pergunta: { id: FUMA, rotulo: 'Fuma?', tipo: 'booleano', opcoes: null },
        obrigatorio: true,
      },
    ],
  },
];
const ITENS = itensDaVersao(SECOES, RETRATOS);

describe('validarRespostas', () => {
  it('normaliza e separa campos de perguntas; vazio não entra', () => {
    expect(
      validarRespostas(ITENS, {
        [NOME]: '  Ana  ',
        [EMAIL]: ' ANA@Exemplo.com ',
        [ALERGIAS]: '',
        [DOR]: 'Leve',
        [FUMA]: false,
      }),
    ).toEqual({
      campos: { [NOME]: 'Ana', [EMAIL]: 'ana@exemplo.com' },
      perguntas: { [DOR]: 'Leve', [FUMA]: false },
    });
  });

  it('obrigatório, tipo, opção e pergunta de fora são 400 no lugar certo', () => {
    expect(() =>
      validarRespostas(ITENS, { [EMAIL]: 'não é e-mail', [DOR]: 'Média', extra: 1 }),
    ).toThrow(
      expect.objectContaining({
        fields: {
          'respostas.extra': [expect.any(String)],
          [`respostas.${NOME}`]: [expect.any(String)],
          [`respostas.${EMAIL}`]: [expect.any(String)],
          [`respostas.${DOR}`]: [expect.any(String)],
          [`respostas.${FUMA}`]: [expect.any(String)],
        },
      }),
    );
  });
});

describe('planejarPelaPolitica', () => {
  const agora = new Map(Object.entries(RETRATOS).map(([id, retrato]) => [id, { id, ...retrato }]));
  const pessoa = { nome: 'Ana', email: 'ana@antigo.com', custom_fields: {} };

  it('igual é ignorado, fill_if_empty com valor vai para revisão, overwrite grava', () => {
    const { relatorio, aGravar } = planejarPelaPolitica(
      ITENS,
      { [NOME]: 'Ana', [EMAIL]: 'ana@novo.com', [ALERGIAS]: 'Iodo' },
      pessoa,
      agora,
    );

    expect(relatorio.map(({ campoId, resultado, motivo }) => [campoId, resultado, motivo])).toEqual(
      [
        [NOME, 'ignorado', 'igual'],
        [EMAIL, 'revisao', 'valor_diferente'],
        [ALERGIAS, 'gravado', undefined],
      ],
    );

    expect(aGravar).toEqual([
      { campoId: ALERGIAS, chave: 'alergias', camada: CAMADA.CAMADA_3, valor: 'Iodo' },
    ]);
  });

  it('fill_if_empty grava quando a pessoa não tem valor; campo fora do CRM vai para revisão', () => {
    const semEmail = { ...pessoa, email: null };
    const semAlergias = new Map([...agora].filter(([id]) => id !== ALERGIAS));
    const { relatorio, aGravar } = planejarPelaPolitica(
      ITENS,
      { [NOME]: 'Ana', [EMAIL]: 'ana@novo.com', [ALERGIAS]: 'Iodo' },
      semEmail,
      semAlergias,
    );

    expect(aGravar.map((item) => item.chave)).toEqual(['email']);

    expect(relatorio.find((linha) => linha.campoId === ALERGIAS)).toMatchObject({
      resultado: 'revisao',
      motivo: 'campo_indisponivel',
    });
  });

  it('sem resposta é ignorado, nunca apaga', () => {
    const { relatorio, aGravar } = planejarPelaPolitica(ITENS, { [NOME]: 'Ana' }, pessoa, agora);

    expect(aGravar).toEqual([]);

    expect(relatorio.find((linha) => linha.campoId === EMAIL)).toMatchObject({
      resultado: 'ignorado',
      motivo: 'sem_resposta',
    });
  });
});

describe('entradaDoLead', () => {
  it('sistema na raiz, personalizado em customFields pela chave', () => {
    expect(
      entradaDoLead([
        { chave: 'email', camada: CAMADA.CAMADA_1, valor: 'a@b.com' },
        { chave: 'alergias', camada: CAMADA.CAMADA_3, valor: 'Iodo' },
      ]),
    ).toEqual({ email: 'a@b.com', customFields: { alergias: 'Iodo' } });

    expect(entradaDoLead([])).toEqual({});
  });
});
