import { describe, expect, it } from 'vitest';

import { CAMADA, POLITICAS_ESCRITA } from '../constants.js';
import {
  camposElegiveis,
  comPadroes,
  retratoDosCampos,
  temAlteracoesNaoPublicadas,
  validarRascunho,
} from './formularios.service.js';

const ID = {
  nome: '00000000-0000-0000-0000-000000000001',
  email: '00000000-0000-0000-0000-000000000002',
  status: '00000000-0000-0000-0000-000000000003',
  tags: '00000000-0000-0000-0000-000000000004',
  alergias: '00000000-0000-0000-0000-000000000005',
  vendedor: '00000000-0000-0000-0000-000000000006',
  endereco: '00000000-0000-0000-0000-000000000007',
  cidade: '00000000-0000-0000-0000-000000000008',
};

const CAMPOS = [
  { id: ID.nome, chave: 'nome', label: 'Nome', tipo: 'texto', camada: CAMADA.CAMADA_1 },
  { id: ID.email, chave: 'email', label: 'E-mail', tipo: 'email', camada: CAMADA.CAMADA_1 },
  { id: ID.status, chave: 'status', label: 'Status', tipo: 'selecao', camada: CAMADA.CAMADA_1 },
  { id: ID.tags, chave: 'tags', label: 'Tags', tipo: 'selecao_multipla', camada: CAMADA.CAMADA_1 },
  { id: ID.endereco, chave: 'endereco', label: 'Endereço', tipo: 'texto', camada: CAMADA.CAMADA_2 },
  { id: ID.cidade, chave: 'cidade', label: 'Cidade', tipo: 'texto', camada: CAMADA.CAMADA_2 },
  {
    id: ID.alergias,
    chave: 'alergias',
    label: 'Alergias',
    tipo: 'selecao',
    opcoes: ['nenhuma', 'dipirona'],
    camada: CAMADA.CAMADA_3,
    sensivel: true,
  },
  {
    id: ID.vendedor,
    chave: 'vendedor',
    label: 'Vendedor',
    tipo: 'usuario',
    camada: CAMADA.CAMADA_3,
  },
  // Sem `id`: campo do sistema sem linha em crm_field não é referenciável.
  { id: null, chave: 'cargo', label: 'Cargo', tipo: 'texto', camada: CAMADA.CAMADA_2 },
];

const ELEGIVEIS = camposElegiveis(CAMPOS);

describe('camposElegiveis', () => {
  it('só os campos da pessoa que ela mesma responde', () => {
    expect(ELEGIVEIS.map((campo) => campo.chave)).toEqual([
      'nome',
      'email',
      'endereco',
      'cidade',
      'alergias',
    ]);
  });

  it('contato e documento preenchem só se vazio; o resto sobrescreve', () => {
    const politica = Object.fromEntries(ELEGIVEIS.map((c) => [c.chave, c.politicaPadrao]));

    expect(politica).toMatchObject({
      email: POLITICAS_ESCRITA.PREENCHER_SE_VAZIO,
      nome: POLITICAS_ESCRITA.SOBRESCREVER,
      alergias: POLITICAS_ESCRITA.SOBRESCREVER,
    });
  });

  it('leva a marca de sensível', () => {
    expect(ELEGIVEIS.find((campo) => campo.chave === 'alergias').sensivel).toBe(true);
  });
});

describe('validarRascunho', () => {
  const rascunho = (itens, extra = {}) => ({ secoes: [{ titulo: ' Saúde ', itens }], ...extra });

  it('normaliza: título aparado, obrigatório falso e política padrão do campo', () => {
    expect(
      validarRascunho(
        rascunho([{ campoId: ID.email }, { campoId: ID.alergias, obrigatorio: true }]),
        ELEGIVEIS,
      ),
    ).toEqual({
      secoes: [
        {
          titulo: 'Saúde',
          itens: [
            {
              campoId: ID.email,
              obrigatorio: false,
              politica: POLITICAS_ESCRITA.PREENCHER_SE_VAZIO,
              preencher: false,
            },
            {
              campoId: ID.alergias,
              obrigatorio: true,
              politica: POLITICAS_ESCRITA.SOBRESCREVER,
              preencher: false,
            },
          ],
        },
      ],
      introducao: null,
      termo: null,
      alertas: [],
    });
  });

  it('a política escolhida vence a padrão', () => {
    const { secoes } = validarRascunho(
      rascunho([{ campoId: ID.email, politica: POLITICAS_ESCRITA.SOBRESCREVER }]),
      ELEGIVEIS,
    );

    expect(secoes[0].itens[0].politica).toBe(POLITICAS_ESCRITA.SOBRESCREVER);
  });

  it('campo fora da pessoa, de usuário ou inexistente é 400 no item', () => {
    expect(() =>
      validarRascunho(
        rascunho([{ campoId: ID.status }, { campoId: ID.vendedor }, { campoId: ID.nome }]),
        ELEGIVEIS,
      ),
    ).toThrow(
      expect.objectContaining({
        fields: {
          'rascunho.secoes.0.itens.0.campoId': [expect.any(String)],
          'rascunho.secoes.0.itens.1.campoId': [expect.any(String)],
        },
      }),
    );
  });

  it('o mesmo campo duas vezes é 400, mesmo em seções diferentes', () => {
    expect(() =>
      validarRascunho(
        { secoes: [{ itens: [{ campoId: ID.nome }] }, { itens: [{ campoId: ID.nome }] }] },
        ELEGIVEIS,
      ),
    ).toThrow(
      expect.objectContaining({
        fields: { 'rascunho.secoes.1.itens.0.campoId': [expect.any(String)] },
      }),
    );
  });

  it('rascunho vazio salva; para publicar, exige um campo e o termo', () => {
    expect(validarRascunho({ secoes: [] }, ELEGIVEIS).secoes).toEqual([]);

    expect(() =>
      validarRascunho({ secoes: [], termo: '  ' }, ELEGIVEIS, { publicar: true }),
    ).toThrow(
      expect.objectContaining({
        fields: { 'rascunho.secoes': [expect.any(String)], 'rascunho.termo': [expect.any(String)] },
      }),
    );
  });
});

describe('retratoDosCampos', () => {
  it('guarda label, tipo e opções de cada campo usado, sem a política padrão', () => {
    const validado = validarRascunho(rascunho2(), ELEGIVEIS);

    expect(retratoDosCampos(validado, ELEGIVEIS)).toEqual({
      [ID.alergias]: {
        chave: 'alergias',
        label: 'Alergias',
        tipo: 'selecao',
        camada: CAMADA.CAMADA_3,
        sensivel: true,
        opcoes: ['nenhuma', 'dipirona'],
      },
    });
  });
});

describe('temAlteracoesNaoPublicadas', () => {
  it('sem versão, há alterações', () => {
    expect(
      temAlteracoesNaoPublicadas({ secoes: [], introducao: null, termo: null }, undefined),
    ).toBe(true);
  });

  it('ignora a ordem das chaves que o jsonb muda', () => {
    const rascunho = validarRascunho(rascunho2({ termo: 'Aceito' }), ELEGIVEIS);
    const doBanco = {
      termo: 'Aceito',
      introducao: null,
      secoes: [
        {
          itens: [{ politica: 'overwrite', campoId: ID.alergias, obrigatorio: false }],
          titulo: null,
        },
      ],
    };

    expect(temAlteracoesNaoPublicadas(doBanco, rascunho)).toBe(false);
    expect(temAlteracoesNaoPublicadas({ ...doBanco, termo: 'Outro' }, rascunho)).toBe(true);
  });
});

function rascunho2(extra = {}) {
  return { secoes: [{ itens: [{ campoId: ID.alergias }] }], ...extra };
}

describe('FM2b: perguntas próprias e pré-preenchimento', () => {
  const PERGUNTA_ID = '00000000-0000-0000-0000-0000000000aa';
  const comItens = (itens, extra = {}) => ({ secoes: [{ itens }], ...extra });

  it('campo sensível não pode ser pré-preenchido; os outros podem', () => {
    const podem = Object.fromEntries(ELEGIVEIS.map((c) => [c.chave, c.podePreencher]));

    expect(podem).toMatchObject({ nome: true, email: true, alergias: false });

    expect(
      validarRascunho(comItens([{ campoId: ID.email, preencher: true }]), ELEGIVEIS).secoes[0]
        .itens[0].preencher,
    ).toBe(true);

    expect(() =>
      validarRascunho(comItens([{ campoId: ID.alergias, preencher: true }]), ELEGIVEIS),
    ).toThrow(
      expect.objectContaining({
        fields: { 'rascunho.secoes.0.itens.0.preencher': [expect.any(String)] },
      }),
    );
  });

  it('pergunta é normalizada, ganha id se não tiver e mantém o que veio', () => {
    const { secoes } = validarRascunho(
      comItens([
        { pergunta: { rotulo: ' Fuma? ', tipo: 'booleano' } },
        {
          pergunta: {
            id: PERGUNTA_ID,
            rotulo: 'Dor',
            tipo: 'selecao',
            opcoes: [' leve ', 'forte'],
          },
          obrigatorio: true,
        },
      ]),
      ELEGIVEIS,
    );
    const [fuma, dor] = secoes[0].itens;

    expect(fuma).toEqual({
      pergunta: {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        rotulo: 'Fuma?',
        ajuda: null,
        tipo: 'booleano',
        opcoes: null,
        sensivel: false,
      },
      obrigatorio: false,
    });

    expect(dor.pergunta).toMatchObject({ id: PERGUNTA_ID, opcoes: ['leve', 'forte'] });
    expect(dor.obrigatorio).toBe(true);
  });

  it('opções: seleção exige, outro tipo recusa, repetida é erro', () => {
    expect(() =>
      validarRascunho(
        comItens([
          { pergunta: { rotulo: 'A', tipo: 'selecao', opcoes: [] } },
          { pergunta: { rotulo: 'B', tipo: 'texto', opcoes: ['x'] } },
          { pergunta: { rotulo: 'C', tipo: 'selecao_multipla', opcoes: ['Sim', 'sim'] } },
        ]),
        ELEGIVEIS,
      ),
    ).toThrow(
      expect.objectContaining({
        fields: {
          'rascunho.secoes.0.itens.0.pergunta.opcoes': [expect.any(String)],
          'rascunho.secoes.0.itens.1.pergunta.opcoes': [expect.any(String)],
          'rascunho.secoes.0.itens.2.pergunta.opcoes': [expect.any(String)],
        },
      }),
    );
  });

  it('a mesma pergunta duas vezes é 400', () => {
    const pergunta = { id: PERGUNTA_ID, rotulo: 'Fuma?', tipo: 'booleano' };

    expect(() => validarRascunho(comItens([{ pergunta }, { pergunta }]), ELEGIVEIS)).toThrow(
      expect.objectContaining({
        fields: { 'rascunho.secoes.0.itens.1.pergunta.id': [expect.any(String)] },
      }),
    );
  });

  it('formulário só com perguntas publica, e pergunta não entra no retrato', () => {
    const validado = validarRascunho(
      comItens([{ pergunta: { rotulo: 'Fuma?', tipo: 'booleano' } }], { termo: 'Aceito' }),
      ELEGIVEIS,
      { publicar: true },
    );

    expect(retratoDosCampos(validado, ELEGIVEIS)).toEqual({});
  });

  it('item de campo gravado antes da FM2b vale sem pré-preenchimento', () => {
    const antigo = [
      { titulo: null, itens: [{ campoId: ID.nome, obrigatorio: false, politica: 'overwrite' }] },
    ];

    expect(comPadroes(antigo)[0].itens[0]).toEqual({
      campoId: ID.nome,
      obrigatorio: false,
      politica: 'overwrite',
      preencher: false,
    });
  });
});
