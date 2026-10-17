import { describe, expect, it } from 'vitest';
import { CAMADA } from '../constants.js';
import casosCompartilhados from '../testing/regras.casos.json';
import { avaliarCondicao, avaliarRegras, resolverRegras, validarRegras } from './regras-campos.service.js';

const MOTIVO = { id: 'f-motivo', chave: 'motivoPerda', label: 'Motivo da perda', tipo: 'selecao', camada: CAMADA.CAMADA_2 };
const FONTE = { id: 'f-fonte', chave: 'fonteLead', label: 'Origem', tipo: 'selecao', camada: CAMADA.CAMADA_1 };
const SEGMENTO = { id: 'f-segmento', chave: 'segmento', label: 'Segmento', tipo: 'selecao', camada: CAMADA.CAMADA_3 };
const NOTA_ALTA = 9;
const NOTA_BAIXA = 3;
const NOTA_MINIMA = 5;

const regraMotivo = {
  id: 'r-motivo',
  kind: 'required_from_status',
  ativo: true,
  sistema: true,
  alvo: MOTIVO,
  condicao: { categorias: ['perdido'] },
  efeito: { obrigatorio: true },
};

describe('casos compartilhados com o front (testing/regras.casos.json)', () => {
  it.each(casosCompartilhados.casos.map((caso) => [caso.nome, caso]))('%s', (_nome, caso) => {
    const { obrigatorios, ocultos } = avaliarRegras(caso.regras, caso.lead, caso.contexto);
    expect({ obrigatorios, ocultos }).toEqual(caso.esperado);
  });
});

describe('avaliarCondicao', () => {
  it('número e booleano comparam pelo valor, não pelo texto', () => {
    expect(avaliarCondicao('numero', 'igual', '9', NOTA_ALTA)).toBe(true);
    expect(avaliarCondicao('numero', 'entre', { de: NOTA_MINIMA }, NOTA_BAIXA)).toBe(false);
    expect(avaliarCondicao('booleano', 'igual', true, true)).toBe(true);
  });

  it('telefone compara só os dígitos; operador desconhecido nunca casa', () => {
    expect(avaliarCondicao('telefone', 'igual', '(11) 98765-4321', '11987654321')).toBe(true);
    expect(avaliarCondicao('texto', 'parecido', 'a', 'a')).toBe(false);
  });
});

describe('validarRegras', () => {
  it('mensagem com o porquê; personalizado aponta pra customFields', () => {
    expect(validarRegras([regraMotivo], { status: 'perdido' }, { categoriaDoStatus: 'perdido' })).toEqual([
      { campo: 'motivoPerda', mensagem: '"Motivo da perda" é obrigatório quando o status é perdido' },
    ]);

    const regraSegmento = {
      id: 'r2',
      kind: 'conditional',
      ativo: true,
      sistema: false,
      alvo: SEGMENTO,
      condicao: { campo: FONTE, operador: 'igual', valor: 'evento' },
      efeito: { obrigatorio: true, visivel: false },
    };
    expect(validarRegras([regraSegmento], { fonteLead: 'evento', customFields: {} })).toEqual([
      { campo: 'customFields', mensagem: '"Segmento" é obrigatório por causa do valor de "Origem"' },
    ]);
  });

  it('com o valor preenchido, nenhum erro', () => {
    expect(
      validarRegras([regraMotivo], { status: 'perdido', motivoPerda: 'preco' }, { categoriaDoStatus: 'perdido' }),
    ).toEqual([]);
  });

  it('status pela key mostra o label da opção', () => {
    const regra = { ...regraMotivo, condicao: { status: ['perdido_preco'] } };
    const [erro] = validarRegras([regra], { status: 'perdido_preco' }, { labelDoStatus: { perdido_preco: 'Perdido: preço' } });
    expect(erro.mensagem).toContain('quando o status é Perdido: preço');
  });
});

describe('resolverRegras', () => {
  const campos = [MOTIVO, FONTE];

  it('linha → regra pronta; condição ganha o campo resolvido', () => {
    const [regra] = resolverRegras(
      [
        {
          id: 'r1',
          field_id: 'f-motivo',
          kind: 'conditional',
          condition: { campoId: 'f-fonte', operador: 'igual', valor: 'evento' },
          effect: { obrigatorio: true, visivel: false },
          position: 0,
          is_active: true,
          system_key: null,
        },
      ],
      campos,
    );
    expect(regra.condicao).toEqual({ campo: FONTE, operador: 'igual', valor: 'evento' });
    expect(regra.sistema).toBe(false);
  });

  it('alvo ou campo da condição fora do schema (excluído/desligado): a regra some', () => {
    const base = { kind: 'required_from_status', condition: { categorias: ['perdido'] }, effect: {}, position: 0, is_active: true, system_key: null };
    expect(resolverRegras([{ ...base, id: 'r1', field_id: 'f-nao-existe' }], campos)).toEqual([]);
    expect(
      resolverRegras(
        [{ ...base, id: 'r2', field_id: 'f-motivo', kind: 'conditional', condition: { campoId: 'f-sumiu', operador: 'vazio' } }],
        campos,
      ),
    ).toEqual([]);
  });
});
