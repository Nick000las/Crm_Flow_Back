import { describe, it, expect, vi, beforeEach } from 'vitest';
import { featureAtiva } from '#core/tenant/feature-flags.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { anonimizarLead, buscarConfigLgpd, buscarSituacaoLgpd } from '../adapters/crm-lgpd.repository.js';
import { ORIGENS_REGISTRO } from '../constants.js';
import { atualizarConfiguracaoCampo, listarConfiguracaoCampos } from './configuracoes-campos.service.js';
import {
  anonimizarLeadDoTitular,
  basePadraoDoTenant,
  comDadosLgpdNaCriacao,
  erroDoLeadNaoEditado,
  personalizadosMantidos,
  salvarConfigLgpd,
} from './lgpd.service.js';
import { recalcularScoreDosLeads } from './score.service.js';

vi.mock('#core/tenant/feature-flags.js', () => ({ featureAtiva: vi.fn(), garantirFeature: vi.fn() }));
vi.mock('../adapters/crm-lgpd.repository.js', () => ({
  anonimizarLead: vi.fn(),
  buscarConfigLgpd: vi.fn(),
  buscarSituacaoLgpd: vi.fn(),
  salvarConfigLgpd: vi.fn(),
}));
vi.mock('./configuracoes-campos.service.js', () => ({
  listarConfiguracaoCampos: vi.fn(),
  atualizarConfiguracaoCampo: vi.fn(),
}));
vi.mock('./score.service.js', () => ({ recalcularScoreDosLeads: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-000000000001';
const LEAD = '00000000-0000-0000-0000-0000000000b1';
const DONO = '00000000-0000-0000-0000-0000000000b2';
const ID_SALARIO = '00000000-0000-0000-0000-0000000000c1';
const ID_APELIDO = '00000000-0000-0000-0000-0000000000c2';
const ID_SEGMENTO = '00000000-0000-0000-0000-0000000000c3';
const AGORA = new Date('2026-10-27T12:00:00Z');
const LEADS_ANONIMIZADOS = 2; // o lead e um mesclado nele
const EVENTOS_LIMPOS = 3;
const RESUMO = Object.freeze({ leads: LEADS_ANONIMIZADOS, atividades: 1, eventos: EVENTOS_LIMPOS });

vi.mock('./field-schema.service.js', () => ({
  obterSchemaCampos: vi.fn(async () => ({
    definicoes: [
      { id: ID_SALARIO, chave: 'salario', tipo: 'numero' },
      { id: ID_APELIDO, chave: 'apelido', tipo: 'texto' },
      { id: ID_SEGMENTO, chave: 'segmento', tipo: 'selecao' },
    ],
  })),
}));

const fechado = { create_form: false, detail: false, table: false, filter: false };
const camposLgpd = () => [
  { id: 'f1', chave: 'baseLegal', obrigatorio: false, visibilidade: { ...fechado } },
  { id: 'f2', chave: 'baseLegalEm', obrigatorio: false, visibilidade: { ...fechado } },
  { id: 'f3', chave: 'origemRegistro', obrigatorio: false, visibilidade: { ...fechado } },
  { id: 'f4', chave: 'optOutMarketingEm', obrigatorio: false, visibilidade: { ...fechado, detail: true, table: true, filter: true } },
  { id: 'f5', chave: 'empresa', obrigatorio: false, visibilidade: { ...fechado } },
];

beforeEach(() => {
  vi.clearAllMocks();
  featureAtiva.mockResolvedValue(true);
  listarConfiguracaoCampos.mockResolvedValue(camposLgpd());
});

describe('comDadosLgpdNaCriacao', () => {
  it('carimba origem e datas; a escolhida vence a padrão; opt-out vira data e sai do payload', () => {
    const criado = comDadosLgpdNaCriacao({ nome: 'Ana', optOutMarketing: true }, ORIGENS_REGISTRO.MANUAL, {
      basePadrao: 'legitimo_interesse',
      agora: AGORA,
    });
    expect(criado).toEqual({
      nome: 'Ana',
      baseLegal: 'legitimo_interesse',
      baseLegalEm: AGORA,
      origemRegistro: 'manual',
      optOutMarketingEm: AGORA,
    });
    expect(criado).not.toHaveProperty('optOutMarketing');

    const escolhida = comDadosLgpdNaCriacao({ baseLegal: 'consentimento' }, ORIGENS_REGISTRO.IMPORTACAO, {
      basePadrao: 'outra',
      agora: AGORA,
    });
    expect(escolhida).toMatchObject({ baseLegal: 'consentimento', baseLegalEm: AGORA, origemRegistro: 'importacao' });

    const semBase = comDadosLgpdNaCriacao({ nome: 'Bia' }, ORIGENS_REGISTRO.MANUAL);
    expect(semBase.baseLegal).toBeUndefined();
    expect(semBase.baseLegalEm).toBeUndefined();
    expect(semBase.optOutMarketingEm).toBeUndefined();
  });

  it('base padrão só com a flag e configurada', async () => {
    buscarConfigLgpd.mockResolvedValue({ base_legal_padrao: 'consentimento' });
    expect(await basePadraoDoTenant(TENANT)).toBe('consentimento');
    featureAtiva.mockResolvedValue(false);
    expect(await basePadraoDoTenant(TENANT)).toBeNull();
    expect(buscarConfigLgpd).toHaveBeenCalledTimes(1);
  });
});

describe('salvarConfigLgpd', () => {
  it('liga os campos LGPD (Base legal também no formulário) e a obrigatoriedade; não mexe nos outros', async () => {
    await salvarConfigLgpd(TENANT, { basePadrao: 'consentimento', obrigatoria: true });

    expect(atualizarConfiguracaoCampo).toHaveBeenCalledWith(TENANT, 'f1', {
      visibilidade: { detail: true, table: true, filter: true, create_form: true },
      obrigatorio: true,
    });
    expect(atualizarConfiguracaoCampo).toHaveBeenCalledWith(TENANT, 'f2', {
      visibilidade: { detail: true, table: true, filter: true },
    });
    // Opt-out já visível; empresa não é LGPD.
    const atualizados = atualizarConfiguracaoCampo.mock.calls.map(([, id]) => id);
    expect(atualizados).not.toContain('f4');
    expect(atualizados).not.toContain('f5');
  });
});

describe('anonimização', () => {
  it('mantém só os personalizados que não identificam a pessoa', () => {
    expect(
      personalizadosMantidos([
        { id: ID_SALARIO, tipo: 'numero' },
        { id: ID_APELIDO, tipo: 'texto' },
        { id: ID_SEGMENTO, tipo: 'selecao' },
        { id: 'x', tipo: 'email' },
      ]),
    ).toEqual([ID_SALARIO, ID_SEGMENTO]);
  });

  it('anonimiza, recalcula o score e devolve as contagens', async () => {
    buscarSituacaoLgpd.mockResolvedValue({ anonimizado: false });
    anonimizarLead.mockResolvedValue({ ...RESUMO });

    expect(await anonimizarLeadDoTitular(TENANT, LEAD, DONO)).toEqual({ leadId: LEAD, ...RESUMO });
    expect(anonimizarLead).toHaveBeenCalledWith(TENANT, LEAD, { autorId: DONO, mantidos: [ID_SALARIO, ID_SEGMENTO] });
    expect(recalcularScoreDosLeads).toHaveBeenCalledWith(TENANT, [LEAD]);
  });

  it('não existe → 404; já anonimizado (antes ou na corrida) → 409', async () => {
    buscarSituacaoLgpd.mockResolvedValueOnce(undefined);
    await expect(anonimizarLeadDoTitular(TENANT, LEAD, DONO)).rejects.toMatchObject({ statusCode: HTTP_STATUS.NOT_FOUND });

    buscarSituacaoLgpd.mockResolvedValueOnce({ anonimizado: true });
    await expect(anonimizarLeadDoTitular(TENANT, LEAD, DONO)).rejects.toMatchObject({ statusCode: HTTP_STATUS.CONFLICT });

    buscarSituacaoLgpd.mockResolvedValueOnce({ anonimizado: false });
    anonimizarLead.mockResolvedValueOnce(null);
    await expect(anonimizarLeadDoTitular(TENANT, LEAD, DONO)).rejects.toMatchObject({ statusCode: HTTP_STATUS.CONFLICT });
    expect(recalcularScoreDosLeads).not.toHaveBeenCalled();
  });

  it('edição sem linha: anonimizado → 409; senão o 404 de quem chamou', async () => {
    const naoEncontrado = new Error('404');
    buscarSituacaoLgpd.mockResolvedValueOnce({ anonimizado: true });
    expect(await erroDoLeadNaoEditado(TENANT, LEAD, naoEncontrado)).toMatchObject({ statusCode: HTTP_STATUS.CONFLICT });
    buscarSituacaoLgpd.mockResolvedValueOnce(undefined);
    expect(await erroDoLeadNaoEditado(TENANT, LEAD, naoEncontrado)).toBe(naoEncontrado);
  });
});
