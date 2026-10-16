import { describe, expect, it } from 'vitest';
import { TIPOS_CAMPO } from '../constants.js';
import {
  LIMITE_TEXTO_LONGO,
  converterCelula,
  textoDeBusca,
  normalizarTelefone,
  normalizarValorDoTipo,
  valorValidoParaTipo,
} from './tipos-campo.service.js';

const VALOR_REAIS = 1234.5;
const VALOR_TRES_CASAS = 10.123;
const VALOR_DEZ_E_DEZ = 10.1;
const VALOR_EM_CENTAVOS_EXATOS = 1234.56;

describe('valorValidoParaTipo — tipos MVP do M2', () => {
  it.each([
    [TIPOS_CAMPO.TEXTO_LONGO, 'linha 1\nlinha 2', true],
    [TIPOS_CAMPO.TEXTO_LONGO, 'x'.repeat(LIMITE_TEXTO_LONGO + 1), false],
    [TIPOS_CAMPO.MONETARIO, VALOR_REAIS, true],
    [TIPOS_CAMPO.MONETARIO, VALOR_DEZ_E_DEZ, true], // ponto flutuante não engana
    [TIPOS_CAMPO.MONETARIO, VALOR_TRES_CASAS, false],
    [TIPOS_CAMPO.MONETARIO, '1234,50', false],
    [TIPOS_CAMPO.TELEFONE, '(11) 99999-0000', true],
    [TIPOS_CAMPO.TELEFONE, '+55 11 3333-4444', true],
    [TIPOS_CAMPO.TELEFONE, '9999', false],
    [TIPOS_CAMPO.EMAIL, 'Ana@Empresa.com ', true],
    [TIPOS_CAMPO.EMAIL, 'ana@', false],
    [TIPOS_CAMPO.URL, 'https://empresa.com/x', true],
    [TIPOS_CAMPO.URL, 'ftp://empresa.com', false],
    [TIPOS_CAMPO.URL, 'empresa.com', false],
  ])('%s %j → %s', (tipo, valor, esperado) => {
    expect(valorValidoParaTipo(tipo, valor, null)).toBe(esperado);
  });

  it('tipos originais seguem iguais', () => {
    expect(valorValidoParaTipo(TIPOS_CAMPO.SELECAO, 'alta', ['alta'])).toBe(true);
    expect(valorValidoParaTipo(TIPOS_CAMPO.SELECAO, 'nenhuma', ['alta'])).toBe(false);
    expect(valorValidoParaTipo(TIPOS_CAMPO.NUMERO, Number.NaN, null)).toBe(false);
    expect(valorValidoParaTipo('tipo_inexistente', 'x', null)).toBe(false);
  });
});

describe('normalização (forma gravada)', () => {
  it('telefone vira só dígitos, sem DDI 55', () => {
    expect(normalizarTelefone('+55 (11) 99999-0000')).toBe('11999990000');
    expect(normalizarValorDoTipo(TIPOS_CAMPO.TELEFONE, '(11) 3333-4444')).toBe('1133334444');
  });

  it('e-mail minúsculo e sem espaço; url sem espaço; texto como veio', () => {
    expect(normalizarValorDoTipo(TIPOS_CAMPO.EMAIL, ' Ana@X.com ')).toBe('ana@x.com');
    expect(normalizarValorDoTipo(TIPOS_CAMPO.URL, ' https://x.com ')).toBe('https://x.com');
    expect(normalizarValorDoTipo(TIPOS_CAMPO.TEXTO, ' A ')).toBe(' A ');
  });
});

describe('converterCelula (import)', () => {
  const campo = (tipo) => ({ tipo, label: 'Campo' });

  it('monetário aceita "R$ 1.234,56" e arredonda pra centavos', () => {
    expect(converterCelula(campo(TIPOS_CAMPO.MONETARIO), 'R$ 1.234,56')).toEqual({
      valor: VALOR_EM_CENTAVOS_EXATOS,
    });
    expect(converterCelula(campo(TIPOS_CAMPO.MONETARIO), 'caro')).toHaveProperty('erro');
  });

  it('telefone, e-mail e link inválidos viram erro da linha', () => {
    expect(converterCelula(campo(TIPOS_CAMPO.TELEFONE), '123')).toHaveProperty('erro');
    expect(converterCelula(campo(TIPOS_CAMPO.EMAIL), 'sem-arroba')).toHaveProperty('erro');
    expect(converterCelula(campo(TIPOS_CAMPO.URL), 'nada')).toHaveProperty('erro');
  });

  it('valores válidos saem normalizados', () => {
    expect(converterCelula(campo(TIPOS_CAMPO.TELEFONE), '(11) 99999-0000')).toEqual({
      valor: '11999990000',
    });
    expect(converterCelula(campo(TIPOS_CAMPO.EMAIL), 'ANA@X.COM')).toEqual({
      valor: 'ana@x.com',
    });
  });

  it('tipos originais também convertem aqui (uma fonte só)', () => {
    const NUMERO_BR = 1234.5;
    expect(converterCelula(campo(TIPOS_CAMPO.TEXTO), 'x')).toEqual({ valor: 'x' });
    expect(converterCelula(campo(TIPOS_CAMPO.NUMERO), '1.234,50')).toEqual({ valor: NUMERO_BR });
    expect(converterCelula(campo(TIPOS_CAMPO.BOOLEANO), 'Sim')).toEqual({ valor: true });
    expect(converterCelula({ ...campo(TIPOS_CAMPO.SELECAO), opcoes: ['Alta'] }, 'alta')).toEqual({ valor: 'Alta' });
    expect(converterCelula(campo(TIPOS_CAMPO.DATA), '31/02/2026')).toHaveProperty('erro');
    expect(converterCelula(campo('tipo_inexistente'), 'x')).toHaveProperty('erro');
  });
});

describe('textoDeBusca (filtro)', () => {
  it('telefone parcial vira dígitos; e-mail minúsculo; resto como veio', () => {
    expect(textoDeBusca(TIPOS_CAMPO.TELEFONE, '(11) 9888')).toBe('119888');
    expect(textoDeBusca(TIPOS_CAMPO.EMAIL, ' Ana@X ')).toBe('ana@x');
    expect(textoDeBusca(TIPOS_CAMPO.TEXTO, ' A ')).toBe(' A ');
  });
});

describe('converterCelula — campo de lista (M3)', () => {
  const status = {
    tipo: TIPOS_CAMPO.SELECAO,
    label: 'Status',
    lista: 'status',
    opcoes: ['ganho'],
    opcoesLista: [
      { key: 'ganho', label: 'Fechou', ativo: true },
      { key: 'negociacao', label: 'Negociação', ativo: false },
    ],
  };

  it('aceita o nome ou a key de uma opção ativa e grava a key', () => {
    expect(converterCelula(status, 'fechou')).toEqual({ valor: 'ganho' });
    expect(converterCelula(status, 'GANHO')).toEqual({ valor: 'ganho' });
  });

  it('opção inativa não entra pela planilha', () => {
    expect(converterCelula(status, 'Negociação')).toHaveProperty('erro');
  });

  it('tag é livre (vira opção ao gravar a linha)', () => {
    const tags = { tipo: TIPOS_CAMPO.SELECAO_MULTIPLA, label: 'Tags', lista: 'tag', opcoes: null, opcoesLista: [] };
    expect(converterCelula(tags, 'Feira; VIP')).toEqual({ valor: ['Feira', 'VIP'] });
  });
});
