import { describe, expect, it } from 'vitest';
import { cnpjValido, cpfValido } from '#shared/validators/index.js';
import { formatarCep, formatarCnpj, formatarCpf } from '#shared/formatters/index.js';
import { TIPOS_CAMPO } from '../constants.js';
import {
  converterCelula,
  normalizarValorDoTipo,
  textoDeBusca,
  valorAusente,
  valorValidoParaTipo,
} from './tipos-campo.service.js';

// Exemplos válidos: CPF de teste conhecido, CNPJ numérico e o exemplo
// oficial de CNPJ alfanumérico da Receita.
const CPF = '52998224725';
const CNPJ = '11222333000181';
const CNPJ_ALFANUMERICO = '12ABC34501DE35';
const USUARIO = '00000000-0000-0000-0000-0000000000aa';
const MEIO_DIA = 0.5;
const CEP_SEM_ZERO = 1310100;
// 00.000.000/0001-91 numa célula numérica.
const CNPJ_SEM_ZERO = 191;

describe('dígito verificador (#shared/validators)', () => {
  it.each([
    [CPF, true],
    ['52998224724', false],
    ['11111111111', false], // todos iguais passam no cálculo, mas não valem
    ['5299822472', false],
  ])('cpfValido(%s) = %s', (cpf, esperado) => {
    expect(cpfValido(cpf)).toBe(esperado);
  });

  it.each([
    [CNPJ, true],
    ['11222333000182', false],
    [CNPJ_ALFANUMERICO, true],
    ['12ABC34501DE34', false],
    ['12ABC34501DEAB', false], // dígitos verificadores são sempre números
    ['00000000000000', false],
  ])('cnpjValido(%s) = %s', (cnpj, esperado) => {
    expect(cnpjValido(cnpj)).toBe(esperado);
  });

  it('máscaras', () => {
    expect(formatarCpf(CPF)).toBe('529.982.247-25');
    expect(formatarCnpj('12abc34501de35')).toBe('12.ABC.345/01DE-35');
    expect(formatarCep('01310100')).toBe('01310-100');
    expect(formatarCep('123')).toBe('123'); // tamanho errado: devolve como veio
  });
});

describe('valorValidoParaTipo e normalização (M11)', () => {
  it.each([
    [TIPOS_CAMPO.CPF, '529.982.247-25', true],
    [TIPOS_CAMPO.CPF, '529.982.247-24', false],
    [TIPOS_CAMPO.CNPJ, '12.abc.345/01de-35', true],
    [TIPOS_CAMPO.CEP, '01310-100', true],
    [TIPOS_CAMPO.CEP, '1310-100', false],
    [TIPOS_CAMPO.HORA, '9:05', true],
    [TIPOS_CAMPO.HORA, '24:00', false],
    [TIPOS_CAMPO.USUARIO, USUARIO, true],
    [TIPOS_CAMPO.USUARIO, 'ana', false],
    [TIPOS_CAMPO.INTERVALO_DATAS, { de: '2026-02-01', ate: '2026-02-10' }, true],
    [TIPOS_CAMPO.INTERVALO_DATAS, { de: '2026-02-10', ate: '2026-02-01' }, false],
    [TIPOS_CAMPO.INTERVALO_DATAS, { de: '2026-02-01' }, false],
    [TIPOS_CAMPO.ENDERECO, { logradouro: 'Rua X', uf: 'sp', cep: '01310-100' }, true],
    [TIPOS_CAMPO.ENDERECO, { uf: 'SPX' }, false],
    [TIPOS_CAMPO.ENDERECO, { pais: 'Brasil' }, false],
  ])('%s %j → %s', (tipo, valor, esperado) => {
    expect(valorValidoParaTipo(tipo, valor)).toBe(esperado);
  });

  it('grava na forma canônica', () => {
    expect(normalizarValorDoTipo(TIPOS_CAMPO.CPF, '529.982.247-25')).toBe(CPF);
    expect(normalizarValorDoTipo(TIPOS_CAMPO.CNPJ, '12.abc.345/01de-35')).toBe(CNPJ_ALFANUMERICO);
    expect(normalizarValorDoTipo(TIPOS_CAMPO.HORA, '9:05')).toBe('09:05');
    expect(normalizarValorDoTipo(TIPOS_CAMPO.INTERVALO_DATAS, { ate: '2026-02-10T00:00:00Z', de: '2026-02-01' })).toEqual({
      de: '2026-02-01',
      ate: '2026-02-10',
    });
  });

  it('endereço: só as partes preenchidas, na ordem fixa (sem diff falso no histórico)', () => {
    const normalizado = normalizarValorDoTipo(TIPOS_CAMPO.ENDERECO, { uf: 'sp', logradouro: ' Rua X ', bairro: '', cep: '01310-100' });
    expect(JSON.stringify(normalizado)).toBe('{"cep":"01310100","logradouro":"Rua X","uf":"SP"}');
  });

  it('objeto sem parte preenchida conta como vazio', () => {
    expect(valorAusente({})).toBe(true);
    expect(valorAusente({ logradouro: '', cidade: null })).toBe(true);
    expect(valorAusente({ cidade: 'Recife' })).toBe(false);
  });

  it('texto de busca na forma gravada', () => {
    expect(textoDeBusca(TIPOS_CAMPO.CPF, '529.982')).toBe('529982');
    expect(textoDeBusca(TIPOS_CAMPO.CNPJ, '12.abc')).toBe('12ABC');
    expect(textoDeBusca(TIPOS_CAMPO.HORA, '9:05')).toBe('09:05');
  });
});

describe('converterCelula (M11)', () => {
  const campo = (tipo, extra = {}) => ({ tipo, label: 'Campo', ...extra });

  it('documentos com ou sem máscara; célula numérica recupera o zero da frente', () => {
    expect(converterCelula(campo(TIPOS_CAMPO.CPF), '529.982.247-25')).toEqual({ valor: CPF });
    expect(converterCelula(campo(TIPOS_CAMPO.CEP), CEP_SEM_ZERO)).toEqual({ valor: '01310100' });
    expect(converterCelula(campo(TIPOS_CAMPO.CNPJ), CNPJ_SEM_ZERO)).toEqual({ valor: '00000000000191' });
    expect(converterCelula(campo(TIPOS_CAMPO.CPF), '123')).toHaveProperty('erro');
  });

  it('hora: texto, fração do dia do Excel e Date', () => {
    expect(converterCelula(campo(TIPOS_CAMPO.HORA), '14:30')).toEqual({ valor: '14:30' });
    expect(converterCelula(campo(TIPOS_CAMPO.HORA), MEIO_DIA)).toEqual({ valor: '12:00' });
    expect(converterCelula(campo(TIPOS_CAMPO.HORA), new Date('1899-12-30T08:15:00Z'))).toEqual({ valor: '08:15' });
  });

  it('período: duas datas ou uma só', () => {
    expect(converterCelula(campo(TIPOS_CAMPO.INTERVALO_DATAS), '01/02/2026 a 10/02/2026')).toEqual({
      valor: { de: '2026-02-01', ate: '2026-02-10' },
    });
    expect(converterCelula(campo(TIPOS_CAMPO.INTERVALO_DATAS), '05/03/2026')).toEqual({
      valor: { de: '2026-03-05', ate: '2026-03-05' },
    });
    expect(converterCelula(campo(TIPOS_CAMPO.INTERVALO_DATAS), '10/02/2026 - 01/02/2026')).toHaveProperty('erro');
  });

  it('usuário pelo nome (sem diferenciar maiúscula); endereço numa célula vai pro logradouro', () => {
    const usuarios = new Map([['bia souza', USUARIO]]);
    expect(converterCelula(campo(TIPOS_CAMPO.USUARIO, { usuarios }), 'Bia Souza')).toEqual({ valor: USUARIO });
    expect(converterCelula(campo(TIPOS_CAMPO.USUARIO, { usuarios }), 'Carlos')).toHaveProperty('erro');
    expect(converterCelula(campo(TIPOS_CAMPO.ENDERECO), 'Rua X, 10')).toEqual({ valor: { logradouro: 'Rua X, 10' } });
  });
});
