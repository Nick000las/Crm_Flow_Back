import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { featureAtiva } from '#core/tenant/feature-flags.js';
import { buscarCandidatos, buscarCandidatosEmLote, buscarRegras } from '../adapters/crm-duplicates.repository.js';
import {
  camposDeDuplicidadeAlterados,
  duplicadosDasLinhas,
  encontrarDuplicados,
  garantirSemDuplicados,
  obterRegras,
  regrasDoImport,
} from './duplicidade.service.js';
import { chaveDocumento, chaveEmail, chaveTelefone } from './tipos-campo.service.js';

vi.mock('#core/tenant/feature-flags.js', () => ({ featureAtiva: vi.fn().mockResolvedValue(true) }));
vi.mock('../adapters/crm-duplicates.repository.js', () => ({
  buscarRegras: vi.fn(),
  buscarCandidatos: vi.fn(),
  buscarCandidatosEmLote: vi.fn(),
}));

const TENANT = 'tenant-1';
const LINHA_ANA = 2;
const LINHA_BIA = 3;
const ANA = { id: 'lead-ana', nome: 'Ana', campos: ['email'] };

beforeEach(() => {
  vi.clearAllMocks();
  buscarRegras.mockResolvedValue([]);
  buscarCandidatos.mockResolvedValue([]);
});

describe('normalizadores (espelho das funções SQL da migration 0020)', () => {
  it.each([
    ['(11) 98765-4321', '1187654321'],
    ['+55 11 98765-4321', '1187654321'],
    ['5511987654321', '1187654321'],
    ['11 8765-4321', '1187654321'], // antigo, sem o 9
    ['11 3333-4444', '1133334444'], // fixo
    ['+55 (11) 3333-4444', '1133334444'],
    ['', null],
    ['abc', null],
  ])('telefone %s → %s', (entrada, chave) => {
    expect(chaveTelefone(entrada)).toBe(chave);
  });

  it('celular com e sem o 9 colidem; fixo não colide com celular', () => {
    expect(chaveTelefone('11987654321')).toBe(chaveTelefone('1187654321'));
    expect(chaveTelefone('11 3333-4444')).not.toBe(chaveTelefone('11 98333-4444'));
  });

  it('e-mail: trim + minúsculas; documento: só [0-9A-Z] maiúsculo (CNPJ alfanumérico)', () => {
    expect(chaveEmail('  Ana@X.COM ')).toBe('ana@x.com');
    expect(chaveDocumento('12.345.678/0001-90')).toBe('12345678000190');
    expect(chaveDocumento('12.abc.345/01de-35')).toBe('12ABC34501DE35');
    expect(chaveDocumento('123.456.789-09')).toBe('12345678909');
    expect(chaveDocumento('--')).toBeNull();
  });
});

describe('regras', () => {
  it('sem nada gravado: padrão (e-mail e telefone avisam, CNPJ/CPF desligados)', async () => {
    await expect(obterRegras(TENANT)).resolves.toEqual({
      regras: [
        { campo: 'email', acao: 'warn', ativo: true },
        { campo: 'telefone', acao: 'warn', ativo: true },
        { campo: 'cnpj', acao: 'warn', ativo: false },
        { campo: 'cpf', acao: 'warn', ativo: false },
      ],
      configurado: false,
    });
  });

  it('gravadas vencem o padrão; import sem a flag usa o padrão', async () => {
    buscarRegras.mockResolvedValue([{ campo: 'cnpj', acao: 'block', ativo: true }]);
    const { regras, configurado } = await obterRegras(TENANT);
    expect(regras.find((regra) => regra.campo === 'cnpj')).toEqual({ campo: 'cnpj', acao: 'block', ativo: true });
    expect(configurado).toBe(true);

    featureAtiva.mockResolvedValueOnce(false);
    expect((await regrasDoImport(TENANT)).every((regra) => regra.acao === 'warn')).toBe(true);
  });
});

describe('encontrarDuplicados e garantirSemDuplicados', () => {
  it('só consulta com chave de regra ativa; manda a chave normalizada', async () => {
    await expect(encontrarDuplicados(TENANT, { cnpj: '12.345' })).resolves.toEqual([]); // CNPJ desligado
    expect(buscarCandidatos).not.toHaveBeenCalled();

    await encontrarDuplicados(TENANT, { email: ' ANA@x.com', telefone: '(11) 98765-4321' }, { ignorarId: 'eu' });
    expect(buscarCandidatos).toHaveBeenCalledWith(TENANT, { email: 'ana@x.com', telefone: '1187654321' }, 'eu');
  });

  it('warn → 409 DUPLICATE_WARNING, a menos que confirme; block → 409 DUPLICATE_BLOCKED sempre', async () => {
    buscarCandidatos.mockResolvedValue([ANA]);
    await expect(garantirSemDuplicados(TENANT, { email: 'ana@x.com' })).rejects.toMatchObject({
      statusCode: HTTP_STATUS.CONFLICT,
      code: 'DUPLICATE_WARNING',
      details: { duplicados: [{ id: 'lead-ana', nome: 'Ana', campos: [{ campo: 'email', label: 'E-mail' }], acao: 'warn' }] },
    });
    await expect(garantirSemDuplicados(TENANT, { email: 'ana@x.com' }, { ignorarDuplicados: true })).resolves.toBeUndefined();

    buscarRegras.mockResolvedValue([{ campo: 'email', acao: 'block', ativo: true }]);
    await expect(
      garantirSemDuplicados(TENANT, { email: 'ana@x.com' }, { ignorarDuplicados: true }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_BLOCKED' });
  });

  it('na edição, só o que mudou de verdade (pela chave normalizada)', () => {
    const atual = { email: 'ana@x.com', telefone: '11987654321', cnpj: null, cpf: null };
    expect(camposDeDuplicidadeAlterados({ email: 'ANA@x.com', telefone: '(11) 8765-4321', nome: 'x' }, atual)).toEqual({});
    expect(camposDeDuplicidadeAlterados({ email: 'bia@x.com', cnpj: null }, atual)).toEqual({ email: 'bia@x.com' });
  });
});

describe('duplicadosDasLinhas (Revisar do import)', () => {
  it('uma consulta pra planilha toda; cada linha com os seus candidatos', async () => {
    buscarCandidatosEmLote.mockResolvedValue([
      { id: 'lead-ana', nome: 'Ana', dedup_email: 'ana@x.com', dedup_telefone: null, dedup_cnpj: null, dedup_cpf: null },
    ]);
    const regras = [
      { campo: 'email', acao: 'block', ativo: true },
      { campo: 'telefone', acao: 'warn', ativo: true },
    ];
    const resultado = await duplicadosDasLinhas(
      TENANT,
      [
        { linha: LINHA_ANA, dados: { email: 'Ana@x.com' } },
        { linha: LINHA_BIA, dados: { email: 'bia@x.com', telefone: '11 3333-4444' } },
      ],
      regras,
    );

    expect(buscarCandidatosEmLote).toHaveBeenCalledTimes(1);
    expect(buscarCandidatosEmLote).toHaveBeenCalledWith(TENANT, {
      email: ['ana@x.com', 'bia@x.com'],
      telefone: ['1133334444'],
    });
    expect(resultado).toEqual([
      {
        linha: LINHA_ANA,
        acao: 'block',
        leads: [{ id: 'lead-ana', nome: 'Ana', campos: [{ campo: 'email', label: 'E-mail' }], acao: 'block' }],
      },
    ]);
  });
});
