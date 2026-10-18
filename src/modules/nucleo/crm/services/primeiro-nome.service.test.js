import { describe, it, expect } from 'vitest';
import {
  comPrimeiroNomeNaCriacao,
  comPrimeiroNomeNaEdicao,
  precisaDoLeadAtual,
  primeiroNomeDe,
} from './primeiro-nome.service.js';

describe('primeiroNomeDe', () => {
  it('primeira palavra, sem espaço sobrando', () => {
    expect(primeiroNomeDe('  Maria   da Silva ')).toBe('Maria');
    expect(primeiroNomeDe('Ana')).toBe('Ana');
  });

  it('vazio ou não-texto → null', () => {
    expect(primeiroNomeDe('   ')).toBeNull();
    expect(primeiroNomeDe(undefined)).toBeNull();
  });
});

describe('criação', () => {
  it('sem primeiro nome (ou vazio) → derivado do nome', () => {
    expect(comPrimeiroNomeNaCriacao({ nome: 'Maria Souza' }).primeiroNome).toBe('Maria');
    expect(comPrimeiroNomeNaCriacao({ nome: 'Maria Souza', primeiroNome: '  ' }).primeiroNome).toBe('Maria');
  });

  it('informado → fica o informado', () => {
    expect(comPrimeiroNomeNaCriacao({ nome: 'José Souza', primeiroNome: ' Zé ' }).primeiroNome).toBe('Zé');
  });
});

describe('edição', () => {
  const ATUAL_DERIVADO = { nome: 'Maria Souza', primeiro_nome: 'Maria' };
  const ATUAL_EDITADO = { nome: 'José Souza', primeiro_nome: 'Zé' };

  it('mudar o nome rederiva enquanto o primeiro nome seguia o nome', () => {
    expect(comPrimeiroNomeNaEdicao({ nome: 'Mariana Souza' }, ATUAL_DERIVADO).primeiroNome).toBe('Mariana');
    expect(comPrimeiroNomeNaEdicao({ nome: 'Mariana' }, { nome: 'X', primeiro_nome: null }).primeiroNome).toBe('Mariana');
  });

  it('mudar o nome não mexe no primeiro nome editado à mão', () => {
    expect(comPrimeiroNomeNaEdicao({ nome: 'José Santos' }, ATUAL_EDITADO)).toEqual({ nome: 'José Santos' });
  });

  it('primeiro nome null/vazio volta ao derivado (do nome novo ou do atual)', () => {
    expect(comPrimeiroNomeNaEdicao({ primeiroNome: null }, ATUAL_EDITADO).primeiroNome).toBe('José');
    expect(comPrimeiroNomeNaEdicao({ nome: 'Pedro Lima', primeiroNome: '' }, ATUAL_EDITADO).primeiroNome).toBe('Pedro');
  });

  it('sem nome nem primeiro nome no payload, nada muda', () => {
    expect(comPrimeiroNomeNaEdicao({ cargo: 'Gerente' }, null)).toEqual({ cargo: 'Gerente' });
  });

  it('só lê o lead atual quando precisa', () => {
    expect(precisaDoLeadAtual({ cargo: 'Gerente' })).toBe(false);
    expect(precisaDoLeadAtual({ primeiroNome: 'Zé' })).toBe(false);
    expect(precisaDoLeadAtual({ nome: 'Pedro Lima', primeiroNome: null })).toBe(false);
    expect(precisaDoLeadAtual({ nome: 'Pedro Lima' })).toBe(true);
    expect(precisaDoLeadAtual({ primeiroNome: null })).toBe(true);
  });
});
