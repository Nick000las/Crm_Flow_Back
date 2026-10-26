import { describe, it, expect } from 'vitest';
import { proximoDaVez } from '../adapters/crm-rodizio.repository.js';
import { CAMADA } from '../constants.js';
import { candidatosAtivos, escolherDestino } from './distribuicao-motor.service.js';

const ID_FONTE = '00000000-0000-0000-0000-0000000000f1';
const ID_SEGMENTO = '00000000-0000-0000-0000-0000000000f2';
const CAMPOS = [
  { id: ID_FONTE, chave: 'fonteLead', tipo: 'selecao', camada: CAMADA.CAMADA_1 },
  { id: ID_SEGMENTO, chave: 'segmento', tipo: 'texto', camada: CAMADA.CAMADA_3 },
];

const ANA = 'aaaaaaaa-0000-0000-0000-000000000001';
const BRUNO = 'bbbbbbbb-0000-0000-0000-000000000002';
const CARLA = 'cccccccc-0000-0000-0000-000000000003';
const GRUPO = '99999999-0000-0000-0000-000000000009';

/** @param {Partial<import('../adapters/crm-distribuicao.repository.js').RegraDistribuicaoLinha>} regra */
const regra = (regra) => ({
  id: 'r',
  nome: 'Regra',
  posicao: 0,
  ativo: true,
  condicoes: [],
  destino_usuario_id: null,
  destino_grupo_id: null,
  ...regra,
});

const doSite = { campoId: ID_FONTE, operador: 'igual', valor: 'site' };
const varejo = { campoId: ID_SEGMENTO, operador: 'contem', valor: 'varejo' };

const contexto = (regras, lead, extras = {}) => ({
  regras,
  lead,
  campos: CAMPOS,
  ativos: new Set([ANA, BRUNO, CARLA]),
  membrosPorGrupo: new Map([[GRUPO, [CARLA, BRUNO]]]),
  ...extras,
});

describe('escolherDestino', () => {
  it('a primeira regra que casa decide', () => {
    const regras = [
      regra({ id: 'r1', condicoes: [doSite], destino_usuario_id: ANA }),
      regra({ id: 'r2', destino_usuario_id: BRUNO }),
    ];
    expect(escolherDestino(contexto(regras, { fonteLead: 'site' }))).toMatchObject({ tipo: 'usuario', usuarioId: ANA });
    expect(escolherDestino(contexto(regras, { fonteLead: 'indicacao' }))).toMatchObject({ tipo: 'usuario', usuarioId: BRUNO });
  });

  it('condições combinadas com E (personalizado pela chave em customFields)', () => {
    const regras = [regra({ condicoes: [doSite, varejo], destino_usuario_id: ANA })];
    expect(escolherDestino(contexto(regras, { fonteLead: 'site', customFields: { segmento: 'Varejo SP' } })).tipo).toBe('usuario');
    expect(escolherDestino(contexto(regras, { fonteLead: 'site', customFields: { segmento: 'Indústria' } })).tipo).toBe('fallback');
  });

  it('regra desligada não conta; nenhuma casa → fallback', () => {
    const regras = [regra({ ativo: false, destino_usuario_id: ANA })];
    expect(escolherDestino(contexto(regras, {}))).toEqual({ tipo: 'fallback' });
  });

  it('grupo: candidatos ativos e ordenados (a ordem do rodízio)', () => {
    const regras = [regra({ destino_grupo_id: GRUPO })];
    expect(escolherDestino(contexto(regras, {}))).toMatchObject({ tipo: 'grupo', grupoId: GRUPO, candidatos: [BRUNO, CARLA] });
  });

  it('destino indisponível pula a regra: usuário inativo ou grupo sem membro ativo', () => {
    const regras = [
      regra({ id: 'r1', destino_usuario_id: ANA }),
      regra({ id: 'r2', destino_grupo_id: GRUPO }),
      regra({ id: 'r3', destino_usuario_id: CARLA }),
    ];
    const destino = escolherDestino(contexto(regras, {}, { ativos: new Set([CARLA]), membrosPorGrupo: new Map([[GRUPO, [BRUNO]]]) }));
    expect(destino).toMatchObject({ tipo: 'usuario', usuarioId: CARLA, regra: { id: 'r3' } });
  });

  it('campo da condição excluído ou desligado: a regra não casa', () => {
    const regras = [regra({ condicoes: [{ campoId: '00000000-0000-0000-0000-00000000dead', operador: 'vazio' }], destino_usuario_id: ANA })];
    expect(escolherDestino(contexto(regras, {})).tipo).toBe('fallback');
  });
});

describe('rodízio', () => {
  it('candidatosAtivos tira inativo e repetido e ordena', () => {
    expect(candidatosAtivos([CARLA, ANA, CARLA, BRUNO], new Set([ANA, CARLA]))).toEqual([ANA, CARLA]);
  });

  it('proximoDaVez: o seguinte ao último, voltando ao início; sem histórico, o primeiro', () => {
    const fila = [ANA, BRUNO, CARLA];
    expect(proximoDaVez(fila, null)).toBe(ANA);
    expect(proximoDaVez(fila, ANA)).toBe(BRUNO);
    expect(proximoDaVez(fila, CARLA)).toBe(ANA);
  });

  it('proximoDaVez: quem recebeu por último saiu do grupo → segue a ordem pelo id', () => {
    expect(proximoDaVez([ANA, CARLA], BRUNO)).toBe(CARLA);
  });
});
