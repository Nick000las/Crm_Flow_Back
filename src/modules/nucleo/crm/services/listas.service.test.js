import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTP_STATUS } from '#shared/constants/index.js';
import {
  atualizarOpcao as atualizarOpcaoRepository,
  contarUsos,
  excluirOpcao as excluirOpcaoRepository,
  inserirOpcoes,
  proximaPosicao,
  reordenarOpcoes,
} from '../adapters/crm-options.repository.js';
import { CATEGORIAS_STATUS, TIPOS_LISTA } from '../constants.js';
import { opcoesSemeadas } from '../testing/listas.fixture.js';
import { agruparPorLista, invalidarSchemaCampos } from './field-schema.service.js';
import {
  atualizarOpcao,
  categoriaDoStatus,
  chaveUnica,
  criarOpcao,
  excluirOpcao,
  gravarTagsNovas,
  reordenarLista,
  resolverOpcoesDoLead,
} from './listas.service.js';

vi.mock('../adapters/crm-options.repository.js', async () =>
  (await import('../testing/listas.fixture.js')).mockRepositorioOpcoes(),
);

// O service lê as listas do resolver; aqui elas vêm direto da fixture,
// ajustável por teste.
let listas;
vi.mock('./field-schema.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  obterSchemaCampos: vi.fn(async () => ({ listas })),
  invalidarSchemaCampos: vi.fn(),
}));

const TENANT = 'tenant-1';
const USOS_PERDIDO = 3;
const POSICAO_FINAL = 7;

/** @param {string} kind @param {string} key */
const opcao = (kind, key) => listas[kind].find((item) => item.key === key);

/** @param {string} kind @param {string} key @param {object} ajuste */
function ajustar(kind, key, ajuste) {
  listas[kind] = listas[kind].map((item) => (item.key === key ? { ...item, ...ajuste } : item));
}

beforeEach(() => {
  vi.clearAllMocks();
  listas = agruparPorLista(opcoesSemeadas());
  contarUsos.mockResolvedValue(new Map());
  proximaPosicao.mockResolvedValue(POSICAO_FINAL);
});

describe('criarOpcao', () => {
  it('key = slug do nome, no fim da lista, e invalida o schema', async () => {
    await criarOpcao(TENANT, TIPOS_LISTA.FONTE_LEAD, { label: 'Feira de Negócios', color: '#123ABC' });
    expect(inserirOpcoes).toHaveBeenCalledWith(TENANT, TIPOS_LISTA.FONTE_LEAD, [
      { key: 'feira_de_negocios', label: 'Feira de Negócios', color: '#123ABC', category: null, position: POSICAO_FINAL },
    ]);
    expect(invalidarSchemaCampos).toHaveBeenCalledWith(TENANT);
  });

  it('slug que colide com uma key existente ganha sufixo (a key nunca é reaproveitada)', async () => {
    ajustar(TIPOS_LISTA.FONTE_LEAD, 'evento', { label: 'Evento antigo' });
    await criarOpcao(TENANT, TIPOS_LISTA.FONTE_LEAD, { label: 'Evento' });
    expect(inserirOpcoes.mock.calls[0][2][0].key).toBe('evento_2');
  });

  it('nome repetido na lista (sem diferenciar maiúscula) → 409', async () => {
    await expect(criarOpcao(TENANT, TIPOS_LISTA.FONTE_LEAD, { label: 'whatsapp' })).rejects.toMatchObject({
      statusCode: HTTP_STATUS.CONFLICT,
    });
    expect(inserirOpcoes).not.toHaveBeenCalled();
  });

  it('status exige categoria; outra lista não aceita categoria', async () => {
    await expect(criarOpcao(TENANT, TIPOS_LISTA.STATUS, { label: 'Pausado' })).rejects.toMatchObject({
      fields: { category: [expect.stringContaining('categoria')] },
    });
    await expect(
      criarOpcao(TENANT, TIPOS_LISTA.MOTIVO_PERDA, { label: 'Sumiu', category: CATEGORIAS_STATUS.PERDIDO }),
    ).rejects.toMatchObject({ fields: { category: [expect.stringContaining('Status')] } });
  });
});

describe('atualizarOpcao', () => {
  it('desativar o único status "perdido" ativo → 409; com outro perdido ativo, pode', async () => {
    const perdido = opcao(TIPOS_LISTA.STATUS, 'perdido');
    await expect(atualizarOpcao(TENANT, TIPOS_LISTA.STATUS, perdido.id, { ativo: false })).rejects.toMatchObject({
      statusCode: HTTP_STATUS.CONFLICT,
    });

    listas.status.push({ ...perdido, id: 'outro-perdido', key: 'desistiu', label: 'Desistiu' });
    atualizarOpcaoRepository.mockResolvedValueOnce({ ...perdido, ativo: false });
    await expect(atualizarOpcao(TENANT, TIPOS_LISTA.STATUS, perdido.id, { ativo: false })).resolves.toBeTruthy();
  });

  it('mudar a categoria do único "ganho" pra aberto também é barrado', async () => {
    const ganho = opcao(TIPOS_LISTA.STATUS, 'ganho');
    await expect(
      atualizarOpcao(TENANT, TIPOS_LISTA.STATUS, ganho.id, { category: CATEGORIAS_STATUS.ABERTO }),
    ).rejects.toMatchObject({ statusCode: HTTP_STATUS.CONFLICT });
  });

  it('renomear muda só o label — a categoria (e as regras por ela) segue a mesma', async () => {
    const perdido = opcao(TIPOS_LISTA.STATUS, 'perdido');
    atualizarOpcaoRepository.mockResolvedValueOnce({ ...perdido, label: 'Não fechou' });
    await atualizarOpcao(TENANT, TIPOS_LISTA.STATUS, perdido.id, { label: 'Não fechou' });

    expect(atualizarOpcaoRepository).toHaveBeenCalledWith(TENANT, perdido.id, { label: 'Não fechou' });
    ajustar(TIPOS_LISTA.STATUS, 'perdido', { label: 'Não fechou' });
    expect(categoriaDoStatus(listas, 'perdido')).toBe(CATEGORIAS_STATUS.PERDIDO);
  });

  it('opção de outra lista (ou de outro tenant) → 404', async () => {
    const whatsapp = opcao(TIPOS_LISTA.FONTE_LEAD, 'whatsapp');
    await expect(atualizarOpcao(TENANT, TIPOS_LISTA.STATUS, whatsapp.id, { label: 'X' })).rejects.toMatchObject({
      statusCode: HTTP_STATUS.NOT_FOUND,
    });
  });
});

describe('reordenarLista', () => {
  it('exige todas as opções da lista, uma vez cada', async () => {
    const ids = listas.motivo_perda.map((item) => item.id);
    await expect(reordenarLista(TENANT, TIPOS_LISTA.MOTIVO_PERDA, ids.slice(1))).rejects.toMatchObject({
      statusCode: HTTP_STATUS.BAD_REQUEST,
    });

    await reordenarLista(TENANT, TIPOS_LISTA.MOTIVO_PERDA, [...ids].reverse());
    expect(reordenarOpcoes).toHaveBeenCalledWith(TENANT, TIPOS_LISTA.MOTIVO_PERDA, [...ids].reverse());
  });
});

describe('excluirOpcao', () => {
  it('opção em uso → 409 sugerindo desativar, sem excluir', async () => {
    const perdido = opcao(TIPOS_LISTA.STATUS, 'perdido');
    listas.status.push({ ...perdido, id: 'outro-perdido', key: 'desistiu', label: 'Desistiu' });
    contarUsos.mockResolvedValueOnce(new Map([['perdido', USOS_PERDIDO]]));

    await expect(excluirOpcao(TENANT, TIPOS_LISTA.STATUS, perdido.id)).rejects.toThrow(/desative em vez de excluir/);
    expect(excluirOpcaoRepository).not.toHaveBeenCalled();
  });

  it('sem uso, exclui; a última opção de uma lista semeada não sai', async () => {
    const evento = opcao(TIPOS_LISTA.FONTE_LEAD, 'evento');
    excluirOpcaoRepository.mockResolvedValueOnce({ id: evento.id });
    await expect(excluirOpcao(TENANT, TIPOS_LISTA.FONTE_LEAD, evento.id)).resolves.toEqual({ removido: true });

    listas.fonte_lead = [evento];
    await expect(excluirOpcao(TENANT, TIPOS_LISTA.FONTE_LEAD, evento.id)).rejects.toThrow(/ao menos uma opção/);
  });
});

describe('resolverOpcoesDoLead', () => {
  it('opção que não existe na lista → 400 no campo', async () => {
    await expect(resolverOpcoesDoLead(listas, { status: 'inventado' })).rejects.toMatchObject({
      fields: { status: [expect.stringContaining('não é uma opção de Status')] },
    });
  });

  it('opção inativa: barrada em lead novo; aceita se o lead já tinha', async () => {
    ajustar(TIPOS_LISTA.FONTE_LEAD, 'evento', { ativo: false });
    await expect(resolverOpcoesDoLead(listas, { fonteLead: 'evento' })).rejects.toThrow(/desativada/);

    const carregarAtual = vi.fn(async () => ({ fonte_lead: 'evento' }));
    await expect(resolverOpcoesDoLead(listas, { fonteLead: 'evento' }, carregarAtual)).resolves.toBeTruthy();
    expect(carregarAtual).toHaveBeenCalledTimes(1);
  });

  it('opção ativa não lê o lead atual', async () => {
    const carregarAtual = vi.fn();
    await resolverOpcoesDoLead(listas, { status: 'novo', motivoPerda: 'preco' }, carregarAtual);
    expect(carregarAtual).not.toHaveBeenCalled();
  });

  it('tags: casa por key, nome ou slug; texto novo vira tag nova (sem duplicar)', async () => {
    listas.tag = [{ id: 't1', kind: 'tag', key: 'vip', label: 'Cliente VIP', ativo: true, position: 0 }];
    const { input, tagsNovas } = await resolverOpcoesDoLead(listas, {
      tags: ['cliente vip', 'VIP', 'Feira 2026', 'feira 2026', ' '],
    });
    expect(input.tags).toEqual(['vip', 'feira_2026']);
    expect(tagsNovas).toEqual([{ key: 'feira_2026', label: 'Feira 2026' }]);
  });

  it('tag desativada: barrada se o lead ainda não a tinha', async () => {
    listas.tag = [{ id: 't1', kind: 'tag', key: 'frio', label: 'Frio', ativo: false, position: 0 }];
    await expect(resolverOpcoesDoLead(listas, { tags: ['Frio'] })).rejects.toThrow(/desativada/);
    await expect(
      resolverOpcoesDoLead(listas, { tags: ['frio'] }, async () => ({ tags: ['frio'] })),
    ).resolves.toMatchObject({ input: { tags: ['frio'] } });
  });

  it('gravarTagsNovas cria no fim da lista de tags e invalida o schema', async () => {
    await gravarTagsNovas(TENANT, [{ key: 'feira_2026', label: 'Feira 2026' }]);
    expect(inserirOpcoes).toHaveBeenCalledWith(TENANT, TIPOS_LISTA.TAG, [
      { key: 'feira_2026', label: 'Feira 2026', position: POSICAO_FINAL },
    ]);
    expect(invalidarSchemaCampos).toHaveBeenCalled();

    vi.clearAllMocks();
    await gravarTagsNovas(TENANT, []);
    expect(inserirOpcoes).not.toHaveBeenCalled();
  });
});

describe('chaveUnica', () => {
  it('base livre fica; ocupada ganha o primeiro sufixo livre', () => {
    expect(chaveUnica('vip', new Set())).toBe('vip');
    expect(chaveUnica('vip', new Set(['vip', 'vip_2']))).toBe('vip_3');
  });
});
