import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  atualizarAtividade,
  buscarAtividade,
  criarAtividade,
  excluirAtividade,
  listarAtividadesDoLead,
} from '../adapters/crm-activities.repository.js';
import {
  editarAtividade,
  listarAtividades,
  listarTiposDeAtividade,
  registrarAtividade,
  removerAtividade,
} from './atividades.service.js';

vi.mock('../adapters/crm-activities.repository.js', () => ({
  listarAtividadesDoLead: vi.fn(),
  buscarAtividade: vi.fn(),
  criarAtividade: vi.fn(),
  atualizarAtividade: vi.fn(),
  excluirAtividade: vi.fn(),
}));
vi.mock('./field-schema.service.js', () => ({
  obterSchemaCampos: vi.fn(async () => ({
    listas: {
      tipo_atividade: [
        { key: 'ligacao', label: 'Ligação', ativo: true },
        { key: 'fax', label: 'Fax', ativo: false },
      ],
    },
  })),
}));

const TENANT = 'tenant-1';
const LEAD = 'lead-1';
const AGORA = new Date('2026-10-16T15:00:00Z');

const linha = (extra = {}) => ({
  id: 'at-1',
  lead_id: LEAD,
  tipo: 'ligacao',
  titulo: 'Ligar',
  notas: null,
  agendada_para: null,
  concluida_em: null,
  autor_id: 'u-1',
  autor_nome: 'Dono',
  created_at: AGORA,
  updated_at: AGORA,
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('listarTiposDeAtividade', () => {
  it('todas as opções, com `ativo`, sem depender da tela de Listas', async () => {
    await expect(listarTiposDeAtividade(TENANT)).resolves.toEqual([
      { key: 'ligacao', label: 'Ligação', color: undefined, ativo: true },
      { key: 'fax', label: 'Fax', color: undefined, ativo: false },
    ]);
  });
});

describe('registrarAtividade', () => {
  it('em aberto por padrão; `concluida: true` grava a conclusão agora', async () => {
    criarAtividade.mockResolvedValue(linha());
    await registrarAtividade(TENANT, LEAD, { tipo: 'ligacao', titulo: 'Ligar' }, 'u-1');
    expect(criarAtividade).toHaveBeenLastCalledWith(TENANT, LEAD, expect.objectContaining({ concluidaEm: null, autorId: 'u-1' }));

    await registrarAtividade(TENANT, LEAD, { tipo: 'ligacao', titulo: 'Liguei', concluida: true }, 'u-1');
    expect(criarAtividade).toHaveBeenLastCalledWith(TENANT, LEAD, expect.objectContaining({ concluidaEm: AGORA }));
  });

  it('formata pra API (camelCase, autor com nome)', async () => {
    criarAtividade.mockResolvedValueOnce(linha());
    await expect(registrarAtividade(TENANT, LEAD, { tipo: 'ligacao', titulo: 'Ligar' })).resolves.toMatchObject({
      id: 'at-1',
      leadId: LEAD,
      concluidaEm: null,
      autor: { id: 'u-1', nome: 'Dono' },
    });
  });

  it('tipo fora da lista ou desativado → 400; lead na lixeira → 404', async () => {
    await expect(registrarAtividade(TENANT, LEAD, { tipo: 'pombo', titulo: 'x' })).rejects.toThrow(
      '"pombo" não é um tipo de atividade',
    );
    await expect(registrarAtividade(TENANT, LEAD, { tipo: 'fax', titulo: 'x' })).rejects.toThrow('está desativado');

    criarAtividade.mockResolvedValueOnce(undefined);
    await expect(registrarAtividade(TENANT, LEAD, { tipo: 'ligacao', titulo: 'x' })).rejects.toThrow(
      'Lead não encontrado',
    );
  });
});

describe('editarAtividade', () => {
  it('concluir grava a data; concluir de novo não muda; reabrir limpa', async () => {
    atualizarAtividade.mockResolvedValue(linha());

    buscarAtividade.mockResolvedValueOnce(linha());
    await editarAtividade(TENANT, LEAD, 'at-1', { concluida: true });
    expect(atualizarAtividade).toHaveBeenLastCalledWith(TENANT, LEAD, 'at-1', { concluidaEm: AGORA });

    buscarAtividade.mockResolvedValueOnce(linha({ concluida_em: new Date('2026-10-01T00:00:00Z') }));
    await editarAtividade(TENANT, LEAD, 'at-1', { concluida: true, titulo: 'Novo' });
    expect(atualizarAtividade).toHaveBeenLastCalledWith(TENANT, LEAD, 'at-1', { titulo: 'Novo' });

    buscarAtividade.mockResolvedValueOnce(linha({ concluida_em: AGORA }));
    await editarAtividade(TENANT, LEAD, 'at-1', { concluida: false });
    expect(atualizarAtividade).toHaveBeenLastCalledWith(TENANT, LEAD, 'at-1', { concluidaEm: null });
  });

  it('tipo desativado só passa se a atividade já tinha ele', async () => {
    atualizarAtividade.mockResolvedValue(linha({ tipo: 'fax' }));
    buscarAtividade.mockResolvedValueOnce(linha({ tipo: 'fax' }));
    await expect(editarAtividade(TENANT, LEAD, 'at-1', { tipo: 'fax' })).resolves.toMatchObject({ tipo: 'fax' });

    buscarAtividade.mockResolvedValueOnce(linha());
    await expect(editarAtividade(TENANT, LEAD, 'at-1', { tipo: 'fax' })).rejects.toThrow('está desativado');
  });

  it('atividade de outro lead (ou lead na lixeira) → 404', async () => {
    buscarAtividade.mockResolvedValueOnce(undefined);
    await expect(editarAtividade(TENANT, LEAD, 'at-x', { titulo: 'x' })).rejects.toThrow('Atividade não encontrada');
    expect(atualizarAtividade).not.toHaveBeenCalled();
  });
});

describe('listar e remover', () => {
  it('lead inexistente → 404; atividade inexistente → 404', async () => {
    listarAtividadesDoLead.mockResolvedValueOnce(undefined);
    await expect(listarAtividades(TENANT, LEAD)).rejects.toThrow('Lead não encontrado');

    excluirAtividade.mockResolvedValueOnce(undefined);
    await expect(removerAtividade(TENANT, LEAD, 'at-x')).rejects.toThrow('Atividade não encontrada');

    excluirAtividade.mockResolvedValueOnce({ id: 'at-1' });
    await expect(removerAtividade(TENANT, LEAD, 'at-1')).resolves.toEqual({ removido: true });
  });
});
