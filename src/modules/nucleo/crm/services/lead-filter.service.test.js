import { describe, it, expect } from 'vitest';
import { condicaoDaSituacao, dataDaPurga, inicioDaLixeira, montarCondicoes } from './lead-filter.service.js';
import { CAMADA } from '../constants.js';
import { HTTP_STATUS } from '#shared/constants/index.js';

const CAMPOS = [
  { chave: 'nome', label: 'Nome', tipo: 'texto', camada: CAMADA.CAMADA_1 },
  { chave: 'status', label: 'Status', tipo: 'selecao', camada: CAMADA.CAMADA_1, opcoes: ['novo', 'ganho'] },
  { chave: 'tags', label: 'Tags', tipo: 'selecao_multipla', camada: CAMADA.CAMADA_1, opcoes: null },
  { chave: 'leadScore', label: 'Lead score', tipo: 'numero', camada: CAMADA.CAMADA_2 },
  { chave: 'segmento', label: 'Segmento', tipo: 'selecao', camada: CAMADA.CAMADA_3, opcoes: ['varejo', 'industria'] },
  { chave: 'renda', label: 'Renda', tipo: 'numero', camada: CAMADA.CAMADA_3 },
  { chave: 'aniversario', label: 'Aniversário', tipo: 'data', camada: CAMADA.CAMADA_3 },
];

const SCORE_MINIMO = 50;
const SCORE_MAXIMO = 90;

/** Junta o texto SQL de todas as condições, pra inspecionar o que foi gerado. */
function sqlDe(condicoes) {
  return condicoes.map((condicao) => condicao.sql).join(' AND ');
}

function valoresDe(condicoes) {
  return condicoes.flatMap((condicao) => condicao.values);
}

describe('montarCondicoes', () => {
  it('sem filtro nenhum, só a situação (ativos: fora da lixeira e do arquivo)', () => {
    const condicoes = montarCondicoes({}, CAMPOS);
    expect(condicoes).toHaveLength(1);
    expect(sqlDe(condicoes)).toBe('l.deleted_at IS NULL AND l.archived_at IS NULL');
  });

  it('busca textual vira ILIKE parametrizado com % e _ escapados', () => {
    const condicoes = montarCondicoes({ busca: '50%_off' }, CAMPOS);
    expect(sqlDe(condicoes)).toContain('l.nome ILIKE');
    expect(valoresDe(condicoes)).toContain('%50\\%\\_off%');
  });

  it('Camada 1/2 usa a coluna real do mapa fechado, nunca o texto do cliente', () => {
    const condicoes = montarCondicoes(
      {
        filtros: [
          { chave: 'status', operador: 'igual', valor: 'ganho' },
          { chave: 'leadScore', operador: 'entre', valor: { de: SCORE_MINIMO, ate: SCORE_MAXIMO } },
        ],
      },
      CAMPOS,
    );
    const sql = sqlDe(condicoes);
    expect(sql).toContain('l.status =');
    expect(sql).toContain('l.lead_score >=');
    expect(sql).toContain('l.lead_score <=');
    expect(valoresDe(condicoes)).toEqual(['ganho', SCORE_MINIMO, SCORE_MAXIMO]);
  });

  it('semResponsavel: sem responsável ou com responsável desativado', () => {
    const sql = sqlDe(montarCondicoes({ semResponsavel: true }, CAMPOS));
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.id = l.usuario_responsavel_id AND u.ativo)');
  });

  it('semResponsavel junto com usuarioResponsavelId é 400', () => {
    expect(() =>
      montarCondicoes({ semResponsavel: true, usuarioResponsavelId: '00000000-0000-0000-0000-000000000001' }, CAMPOS),
    ).toThrow(expect.objectContaining({ statusCode: HTTP_STATUS.BAD_REQUEST, fields: { semResponsavel: [expect.any(String)] } }));
  });

  it('valor malicioso continua sendo parâmetro, nunca SQL', () => {
    const ataque = "x'; DROP TABLE leads; --";
    const condicoes = montarCondicoes({ filtros: [{ chave: 'nome', operador: 'contem', valor: ataque }] }, CAMPOS);
    expect(sqlDe(condicoes)).not.toContain('DROP');
    expect(valoresDe(condicoes)).toContain(`%${ataque}%`);
  });

  it('Camada 3 de seleção usa containment (@>) pra aproveitar o GIN', () => {
    const condicoes = montarCondicoes(
      { filtros: [{ chave: 'segmento', operador: 'igual', valor: 'varejo' }] },
      CAMPOS,
    );
    expect(sqlDe(condicoes)).toContain('l.custom_fields @>');
    expect(valoresDe(condicoes)).toContain(JSON.stringify({ segmento: 'varejo' }));
  });

  it('Camada 3 numérica usa cast protegido por jsonb_typeof', () => {
    const condicoes = montarCondicoes(
      { filtros: [{ chave: 'renda', operador: 'entre', valor: { de: SCORE_MINIMO } }] },
      CAMPOS,
    );
    expect(sqlDe(condicoes)).toContain('jsonb_typeof');
  });

  it('tags (array nativo) usa ANY / && em vez de igualdade', () => {
    const contem = montarCondicoes({ filtros: [{ chave: 'tags', operador: 'contem', valor: 'vip' }] }, CAMPOS);
    expect(sqlDe(contem)).toContain('= ANY(l.tags)');

    const algum = montarCondicoes({ filtros: [{ chave: 'tags', operador: 'e_um_dos', valor: ['vip', 'b2b'] }] }, CAMPOS);
    expect(sqlDe(algum)).toContain('l.tags &&');
  });

  it('rejeita campo que não está entre os ativos (ex: Camada 2 desligada)', () => {
    expect(() =>
      montarCondicoes({ filtros: [{ chave: 'cpf', operador: 'igual', valor: '123' }] }, CAMPOS),
    ).toThrow('"cpf" não é um campo ativo para filtro');
  });

  it('rejeita operador incompatível com o tipo', () => {
    expect(() =>
      montarCondicoes({ filtros: [{ chave: 'leadScore', operador: 'contem', valor: 'x' }] }, CAMPOS),
    ).toThrow('Operador "contem" não se aplica');
  });

  it('rejeita valor de tipo errado', () => {
    expect(() =>
      montarCondicoes({ filtros: [{ chave: 'leadScore', operador: 'igual', valor: 'alto' }] }, CAMPOS),
    ).toThrow('Informe um número');
    expect(() =>
      montarCondicoes({ filtros: [{ chave: 'aniversario', operador: 'igual', valor: 'ontem' }] }, CAMPOS),
    ).toThrow('Informe uma data válida');
  });

  it('entre sem "de" nem "ate" é rejeitado', () => {
    expect(() =>
      montarCondicoes({ filtros: [{ chave: 'leadScore', operador: 'entre', valor: {} }] }, CAMPOS),
    ).toThrow('Informe "de" e/ou "ate"');
  });

  it('vazio/nao_vazio não exigem valor', () => {
    const condicoes = montarCondicoes(
      {
        filtros: [
          { chave: 'nome', operador: 'nao_vazio' },
          { chave: 'segmento', operador: 'vazio' },
        ],
      },
      CAMPOS,
    );
    expect(condicoes).toHaveLength(['situacao', 'nome', 'segmento'].length);
  });
});

describe('personalizado lido pelo id do campo', () => {
  const ID_SEGMENTO = '11111111-1111-1111-1111-111111111111';
  const CAMPOS_POR_ID = CAMPOS.map((campo) =>
    campo.chave === 'segmento' ? { ...campo, chaveArmazenamento: ID_SEGMENTO } : campo,
  );

  it('lê o JSONB pelo id, mas o cliente continua filtrando pela chave', () => {
    const condicoes = montarCondicoes(
      { filtros: [{ chave: 'segmento', operador: 'igual', valor: 'varejo' }] },
      CAMPOS_POR_ID,
    );
    expect(valoresDe(condicoes)).toContain(JSON.stringify({ [ID_SEGMENTO]: 'varejo' }));
    expect(valoresDe(condicoes)).not.toContain(JSON.stringify({ segmento: 'varejo' }));
  });

  it('operadores de texto/vazio também usam o id como caminho', () => {
    const condicoes = montarCondicoes({ filtros: [{ chave: 'segmento', operador: 'vazio' }] }, CAMPOS_POR_ID);
    expect(valoresDe(condicoes)).toContain(ID_SEGMENTO);
  });
});

describe('tipos MVP do M2 no filtro', () => {
  const VALOR_MIN = 100;
  const CAMPOS_M2 = [
    { chave: 'celular', label: 'Celular', tipo: 'telefone', camada: CAMADA.CAMADA_3 },
    { chave: 'contrato', label: 'Contrato', tipo: 'monetario', camada: CAMADA.CAMADA_3 },
    { chave: 'contato', label: 'Contato', tipo: 'email', camada: CAMADA.CAMADA_3 },
    { chave: 'notas', label: 'Notas', tipo: 'texto_longo', camada: CAMADA.CAMADA_3 },
  ];

  it('telefone com máscara casa com o valor gravado só em dígitos', () => {
    const condicoes = montarCondicoes(
      { filtros: [{ chave: 'celular', operador: 'igual', valor: '(11) 99999-0000' }] },
      CAMPOS_M2,
    );
    expect(valoresDe(condicoes)).toContain(JSON.stringify({ celular: '11999990000' }));
  });

  it('monetário aceita faixa numérica com cast protegido', () => {
    const condicoes = montarCondicoes(
      { filtros: [{ chave: 'contrato', operador: 'entre', valor: { de: VALOR_MIN } }] },
      CAMPOS_M2,
    );
    expect(sqlDe(condicoes)).toContain('jsonb_typeof');
    expect(valoresDe(condicoes)).toContain(VALOR_MIN);
  });

  it('e-mail compara em minúsculas', () => {
    const condicoes = montarCondicoes(
      { filtros: [{ chave: 'contato', operador: 'igual', valor: 'Ana@X.COM' }] },
      CAMPOS_M2,
    );
    expect(valoresDe(condicoes)).toContain(JSON.stringify({ contato: 'ana@x.com' }));
  });

  it('texto longo não aceita igualdade (só contém/vazio)', () => {
    expect(() =>
      montarCondicoes({ filtros: [{ chave: 'notas', operador: 'igual', valor: 'x' }] }, CAMPOS_M2),
    ).toThrow(/não se aplica/);
  });
});

describe('e-mail e telefone nativos (tipos email/telefone)', () => {
  const NATIVOS = [
    { chave: 'email', label: 'E-mail', tipo: 'email', camada: CAMADA.CAMADA_1 },
    { chave: 'telefone', label: 'Telefone', tipo: 'telefone', camada: CAMADA.CAMADA_1 },
  ];

  it('telefone compara sem máscara dos dois lados (cobre linha antiga com máscara)', () => {
    const condicoes = montarCondicoes(
      { filtros: [{ chave: 'telefone', operador: 'contem', valor: '(11) 9888' }] },
      NATIVOS,
    );
    expect(sqlDe(condicoes)).toContain("regexp_replace(l.telefone, '[^0-9]', '', 'g') ILIKE");
    expect(valoresDe(condicoes)).toEqual(['%119888%']);
  });

  it('e-mail compara em minúsculas', () => {
    const condicoes = montarCondicoes(
      { filtros: [{ chave: 'email', operador: 'igual', valor: ' Ana@X.com ' }] },
      NATIVOS,
    );
    expect(sqlDe(condicoes)).toContain('lower(l.email) =');
    expect(valoresDe(condicoes)).toEqual(['ana@x.com']);
  });

  it('busca com cara de telefone procura pelos dígitos; busca com letra, não', () => {
    const porTelefone = montarCondicoes({ busca: '(11) 9888-7' }, NATIVOS);
    expect(sqlDe(porTelefone)).toContain("regexp_replace(l.telefone, '[^0-9]', '', 'g') LIKE");
    expect(valoresDe(porTelefone)).toContain('%1198887%');

    const porNome = montarCondicoes({ busca: 'Ana 2' }, NATIVOS);
    expect(sqlDe(porNome)).toContain('l.telefone ILIKE');
  });
});

describe('busca pelo identificador do layout (M4)', () => {
  const CNPJ = { chave: 'cnpj', camada: CAMADA.CAMADA_2, id: 'id-cnpj' };

  it('CNPJ com e sem pontuação geram a mesma condição (chave dedup_cnpj, prefixo)', () => {
    const comMascara = montarCondicoes({ busca: '12.345.678/0001-90' }, CAMPOS, { identificador: CNPJ });
    const semMascara = montarCondicoes({ busca: '12345678000190' }, CAMPOS, { identificador: CNPJ });

    expect(sqlDe(comMascara)).toContain('l.dedup_cnpj LIKE');
    expect(valoresDe(comMascara)).toContain('12345678000190%');
    expect(valoresDe(semMascara)).toContain('12345678000190%');
  });

  it('CNPJ alfanumérico (M7): letras viram maiúsculas na chave; identificador de texto vira ILIKE', () => {
    expect(valoresDe(montarCondicoes({ busca: '12.abc.345/01de' }, CAMPOS, { identificador: CNPJ }))).toContain(
      '12ABC34501DE%',
    );
    expect(sqlDe(montarCondicoes({ busca: '---' }, CAMPOS, { identificador: CNPJ }))).not.toContain('dedup_cnpj');

    const empresa = montarCondicoes({ busca: 'Acme' }, CAMPOS, {
      identificador: { chave: 'empresa', camada: CAMADA.CAMADA_2 },
    });
    expect(sqlDe(empresa)).toContain('l.empresa ILIKE');

    const personalizado = montarCondicoes({ busca: 'Acme' }, CAMPOS, {
      identificador: { chave: 'razao', camada: CAMADA.CAMADA_3, id: 'id-razao' },
    });
    expect(sqlDe(personalizado)).toContain('l.custom_fields->>');
    expect(valoresDe(personalizado)).toContain('id-razao');
  });

  it('sem identificador (Nome), a busca segue igual', () => {
    expect(sqlDe(montarCondicoes({ busca: '123' }, CAMPOS))).not.toContain('cnpj');
  });
});

describe('situação do lead (M5)', () => {
  const AGORA = new Date('2026-10-16T12:00:00Z');

  it('toda consulta exclui a lixeira, a menos que ela seja pedida', () => {
    for (const situacao of [undefined, 'ativos', 'arquivados']) {
      expect(sqlDe(montarCondicoes({ situacao, busca: 'ana' }, CAMPOS))).toContain('l.deleted_at IS NULL');
    }
  });

  it('arquivados: fora da lixeira e com archived_at', () => {
    expect(condicaoDaSituacao('arquivados').sql).toBe('l.deleted_at IS NULL AND l.archived_at IS NOT NULL');
  });

  it('lixeira: só o que foi excluído dentro do prazo de 30 dias', () => {
    const condicao = condicaoDaSituacao('lixeira', { agora: AGORA });
    expect(condicao.sql).toBe('l.deleted_at >= ?');
    expect(condicao.values).toEqual([new Date('2026-09-16T12:00:00Z')]);
  });

  it('sem a feature crm.arquivo, "ativos" inclui os arquivados (kill switch não esconde lead)', () => {
    expect(condicaoDaSituacao('ativos', { comArquivo: false }).sql).toBe('l.deleted_at IS NULL');
  });

  it('prazo e purga são o mesmo intervalo', () => {
    const excluidoEm = new Date('2026-10-01T00:00:00Z');
    expect(dataDaPurga(excluidoEm)).toEqual(new Date('2026-10-31T00:00:00Z'));
    expect(inicioDaLixeira(dataDaPurga(excluidoEm))).toEqual(excluidoEm);
  });
});
