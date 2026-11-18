import { describe, expect, it } from 'vitest';

import { CAMADA } from '../constants.js';
import { valorDaPessoa, versaoPublica } from './formulario-publico.service.js';

const ALERGIAS = '00000000-0000-0000-0000-0000000000a1';
const NOME = '00000000-0000-0000-0000-0000000000a2';
const CPF = '00000000-0000-0000-0000-0000000000a3';

const PESSOA = {
  nome: 'Maria Souza',
  cpf: '12345678909',
  email: '',
  custom_fields: { [ALERGIAS]: 'Dipirona' },
};

describe('valorDaPessoa', () => {
  it('sistema pela coluna, personalizado pelo id do campo, vazio vira null', () => {
    expect(valorDaPessoa(PESSOA, { id: NOME, chave: 'nome', camada: CAMADA.CAMADA_1 })).toBe(
      'Maria Souza',
    );

    expect(valorDaPessoa(PESSOA, { id: CPF, chave: 'cpf', camada: CAMADA.CAMADA_2 })).toBe(
      '12345678909',
    );

    expect(
      valorDaPessoa(PESSOA, { id: ALERGIAS, chave: 'alergias', camada: CAMADA.CAMADA_3 }),
    ).toBe('Dipirona');

    expect(valorDaPessoa(PESSOA, { id: 'x', chave: 'email', camada: CAMADA.CAMADA_1 })).toBeNull();
  });
});

describe('versaoPublica', () => {
  const link = {
    introducao: null,
    termo: 'Aceito',
    pessoa: PESSOA,
    campos: {
      [NOME]: {
        chave: 'nome',
        label: 'Nome',
        tipo: 'texto',
        camada: 1,
        sensivel: false,
        opcoes: null,
      },
      [CPF]: {
        chave: 'cpf',
        label: 'CPF',
        tipo: 'cpf',
        camada: CAMADA.CAMADA_2,
        sensivel: false,
        opcoes: null,
      },
    },
    secoes: [
      {
        titulo: null,
        itens: [
          { campoId: NOME, obrigatorio: true, politica: 'overwrite', preencher: true },
          { campoId: CPF, obrigatorio: false, politica: 'fill_if_empty', preencher: true },
        ],
      },
    ],
  };

  it('só preenche o que pode agora; campo fora do CRM ou sensível vem vazio', () => {
    const agora = new Map([
      [NOME, { id: NOME, chave: 'nome', camada: CAMADA.CAMADA_1, podePreencher: true }],
      [CPF, { id: CPF, chave: 'cpf', camada: CAMADA.CAMADA_2, podePreencher: false }],
    ]);
    const [nome, cpf] = versaoPublica(link, agora).secoes[0].itens;

    expect(nome.valor).toBe('Maria Souza');
    expect(cpf.valor).toBeNull();
    expect(versaoPublica(link, new Map()).secoes[0].itens[0].valor).toBeNull();
  });
});
