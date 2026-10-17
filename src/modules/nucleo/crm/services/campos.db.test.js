import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encerrarCache } from '#core/cache/cache.js';
import { getAdminClient } from '#core/db/tenantClient.js';
import { invalidarFeatures } from '#core/tenant/feature-flags.js';
import { buscarLeadDuplicado, purgarLixeira } from '../adapters/leads.repository.js';
import {
  CAMPOS_SISTEMA,
  CRM_FEATURES,
  LISTA_CONTEXTOS_VISIBILIDADE,
  LISTAS_SEMEADAS,
  MODULO_CRM,
  OPCOES_SUGERIDAS,
} from '../constants.js';
import { arquivarLead, excluirLead, restaurarLead } from './arquivo.service.js';
import { editarAtividade, listarAtividades, registrarAtividade } from './atividades.service.js';
import { listarHistorico } from './historico.service.js';
import { exportarLeads } from './export.service.js';
import {
  atualizarConfiguracaoCampo,
  listarConfiguracaoCampos,
  restaurarOrdemPadrao,
} from './configuracoes-campos.service.js';
import { criarNovaDefinicao, removerDefinicao } from './field-definitions.service.js';
import { camposDoContexto, obterSchemaCampos } from './field-schema.service.js';
import { inicioDaLixeira } from './lead-filter.service.js';
import {
  atualizarLeadExistente,
  buscarLeadFormatado,
  pesquisarLeads,
  registrarNovoLead,
} from './leads.service.js';
import { obterLayout, salvarMeu, salvarPadrao } from './layout.service.js';
import { excluirOpcao, listarListas } from './listas.service.js';
import { reconciliarTenant } from './reconcile.service.js';

/**
 * Integração dos campos (`crm_field`) contra o Postgres de verdade: semear
 * os campos do sistema é idempotente, `custom_fields` vai por `id` e volta
 * por `chave`, filtro e Configurações (M2) funcionam no SQL real.
 *
 * GRAVA no banco de `DATABASE_URL` (tenant "SMOKE campos", apagado no fim)
 * — por isso só roda com `CRM_DB_TESTS=1`, num banco de dev:
 *
 *   CRM_DB_TESTS=1 pnpm vitest run src/modules/nucleo/crm/services/campos.db.test.js
 *
 * Exige as migrations até a 0019 aplicadas.
 */

const rodar = process.env.CRM_DB_TESTS === '1' && process.env.DATABASE_URL ? describe : describe.skip;

const TAMANHO_PAGINA = 50;
const TAMANHO_SUFIXO_SUBDOMINIO = 8;
const ORDEM_SEGMENTO = 40;

rodar('campos do CRM no banco (CRM_DB_TESTS=1)', () => {
  const prisma = getAdminClient();
  const tenantId = randomUUID();
  const usuarioId = randomUUID();

  async function contar() {
    const [linha] = await prisma.$queryRaw`
      SELECT
        (SELECT count(*)::int FROM modulo_crm.crm_field WHERE tenant_id = ${tenantId}::uuid) AS campos,
        (SELECT count(*)::int FROM modulo_crm.crm_field_visibility WHERE tenant_id = ${tenantId}::uuid) AS visibilidades
    `;
    return linha;
  }

  beforeAll(async () => {
    await prisma.tenant.create({
      data: { id: tenantId, nome: 'SMOKE campos', subdomain: `smoke-campos-${tenantId.slice(0, TAMANHO_SUFIXO_SUBDOMINIO)}` },
    });
    await prisma.usuario.create({
      data: { id: usuarioId, tenantId, nome: 'Smoke', email: `smoke-${tenantId}@smoke.test`, role: 'DONO', ativo: true },
    });
  });

  afterAll(async () => {
    // Leads antes: `fk_leads_usuario_responsavel` não tem cascade e barra o
    // cascade tenant → usuarios enquanto um lead aponta pro responsável.
    await prisma.$executeRaw`DELETE FROM modulo_crm.leads WHERE tenant_id = ${tenantId}::uuid`;
    await prisma.tenant.deleteMany({ where: { id: tenantId } }); // cascade
    await encerrarCache();
  });

  it('reconcile duas vezes: semeia os campos do sistema uma vez só', async () => {
    const primeira = await reconciliarTenant(tenantId);
    const depois = await contar();
    const segunda = await reconciliarTenant(tenantId);

    const opcoesSugeridas = LISTAS_SEMEADAS.reduce((total, kind) => total + OPCOES_SUGERIDAS[kind].length, 0);
    expect(primeira).toEqual([
      { passo: 'campos-sistema', resultado: { criados: CAMPOS_SISTEMA.length } },
      { passo: 'listas-padrao', resultado: { criadas: opcoesSugeridas } }, // tenant sem lead: padrão da spec
    ]);
    expect(segunda).toEqual([
      { passo: 'campos-sistema', resultado: { criados: 0 } },
      { passo: 'listas-padrao', resultado: { criadas: 0 } },
    ]);
    expect(depois.campos).toBe(CAMPOS_SISTEMA.length);
    expect(depois.visibilidades).toBe(CAMPOS_SISTEMA.length * LISTA_CONTEXTOS_VISIBILIDADE.length);
    expect(await contar()).toEqual(depois);
  });

  it('personalizado: grava por id, volta por chave, filtra pelo id; excluir esconde sem apagar', async () => {
    const campo = await criarNovaDefinicao(tenantId, {
      label: 'Segmento smoke',
      tipo: 'texto',
      obrigatorio: false,
      ordem: ORDEM_SEGMENTO,
    });
    const { id: leadId } = await registrarNovoLead(
      tenantId,
      { nome: 'Lead A', email: 'a@smoke.test', customFields: { segmento_smoke: 'varejo' } },
      usuarioId,
    );

    const [gravado] = await prisma.$queryRaw`
      SELECT custom_fields FROM modulo_crm.leads WHERE id = ${leadId}::uuid
    `;
    expect(gravado.custom_fields).toEqual({ [campo.id]: 'varejo' });
    expect((await buscarLeadFormatado(tenantId, leadId)).custom_fields).toEqual({ segmento_smoke: 'varejo' });

    const busca = await pesquisarLeads(tenantId, {
      filtros: [{ chave: 'segmento_smoke', operador: 'igual', valor: 'varejo' }],
      paginacao: { pagina: 1, tamanho: TAMANHO_PAGINA },
    });
    expect(busca.total).toBe(1);

    await removerDefinicao(tenantId, campo.id);
    expect((await buscarLeadFormatado(tenantId, leadId)).custom_fields).toEqual({});
    const [aindaGravado] = await prisma.$queryRaw`
      SELECT custom_fields FROM modulo_crm.leads WHERE id = ${leadId}::uuid
    `;
    expect(aindaGravado.custom_fields).toEqual({ [campo.id]: 'varejo' });
  });

  it('Configurações (M2): ocultar só na tabela, renomear e voltar ao padrão', async () => {
    const empresa = (await listarConfiguracaoCampos(tenantId)).find((campo) => campo.chave === 'empresa');

    await atualizarConfiguracaoCampo(tenantId, empresa.id, {
      label: 'Razão social',
      visibilidade: { create_form: true, detail: true, filter: true, table: false },
    });
    const { campos } = await obterSchemaCampos(tenantId);
    expect(camposDoContexto(campos, 'table').map((campo) => campo.chave)).not.toContain('empresa');
    expect(camposDoContexto(campos, 'detail').find((campo) => campo.chave === 'empresa').label).toBe(
      'Razão social',
    );

    const ordenados = await restaurarOrdemPadrao(tenantId);
    expect(ordenados.map((campo) => campo.ordem)).toEqual(ordenados.map((_, indice) => indice));
  });

  it('Listas (M3): só opção da lista entra, tag nova vira opção, opção em uso não é excluída', async () => {
    await expect(
      registrarNovoLead(tenantId, { nome: 'Lead B', email: 'b@smoke.test', status: 'negociacao' }, usuarioId),
    ).rejects.toThrow(/não é uma opção de Status/); // tenant novo: padrão da spec, sem "negociacao"

    const { id: leadId } = await registrarNovoLead(
      tenantId,
      { nome: 'Lead C', email: 'c@smoke.test', status: 'proposta', tags: ['Feira 2026'] },
      usuarioId,
    );
    const [gravado] = await prisma.$queryRaw`SELECT status, tags FROM modulo_crm.leads WHERE id = ${leadId}::uuid`;
    expect(gravado).toEqual({ status: 'proposta', tags: ['feira_2026'] });

    const listas = await listarListas(tenantId);
    expect(listas.tag).toEqual([expect.objectContaining({ key: 'feira_2026', label: 'Feira 2026', usos: 1 })]);
    const proposta = listas.status.find((opcao) => opcao.key === 'proposta');
    expect(proposta.usos).toBe(1);
    await expect(excluirOpcao(tenantId, 'status', proposta.id)).rejects.toThrow(/desative em vez de excluir/);
  });

  it('Layout (M4): CNPJ como identificador, Empresa · Cidade no subtítulo, busca com e sem pontuação', async () => {
    const configurados = await listarConfiguracaoCampos(tenantId);
    const id = (chave) => configurados.find((campo) => campo.chave === chave).id;
    const todosOsContextos = { create_form: true, detail: true, table: true, filter: true };
    for (const chave of ['cnpj', 'empresa', 'cidade']) {
      await atualizarConfiguracaoCampo(tenantId, id(chave), { visibilidade: todosOsContextos });
    }

    const padrao = {
      identificador: id('cnpj'),
      subtitulo: [id('empresa'), id('cidade')],
      destaques: ['lead.valor', id('status')],
      secoes: [{ nome: 'Empresa', campos: [id('empresa'), id('cnpj'), id('cidade')] }],
      colunas: [id('empresa'), id('telefone')],
    };
    await salvarPadrao(tenantId, usuarioId, padrao);
    const { id: leadId } = await registrarNovoLead(
      tenantId,
      { nome: 'Acme', email: 'acme@smoke.test', cnpj: '12.345.678/0001-90', empresa: 'Acme SA', cidade: 'Joinville' },
      usuarioId,
    );

    for (const busca of ['12.345.678/0001-90', '12345678000190', '12.345']) {
      const resultado = await pesquisarLeads(tenantId, { busca, paginacao: { pagina: 1, tamanho: TAMANHO_PAGINA } });
      expect(resultado.itens.map((lead) => lead.id), busca).toEqual([leadId]);
    }

    const { efetivo } = await obterLayout(tenantId, usuarioId);
    expect(efetivo.identificador.chave).toBe('cnpj');
    expect(efetivo.subtitulo.map((item) => item.chave)).toEqual(['empresa', 'cidade']);

    // Override do usuário; depois o DONO acrescenta uma coluna → entra no fim da lista dele.
    await salvarMeu(tenantId, usuarioId, { colunas: [id('telefone')] });
    await salvarPadrao(tenantId, usuarioId, { ...padrao, colunas: [...padrao.colunas, id('cidade')] });
    const depois = await obterLayout(tenantId, usuarioId);
    expect(depois.efetivo.colunas.map((item) => item.chave)).toEqual(['telefone', 'cidade']);
  });

  it('Arquivo e lixeira (M5): nada vaza da lixeira, restaurar no prazo, purga depois', async () => {
    await prisma.tenantModule.create({ data: { tenantId, moduleKey: MODULO_CRM } });
    await prisma.tenantModuleFeature.create({
      data: { tenantId, moduleKey: MODULO_CRM, featureKey: CRM_FEATURES.ARQUIVO },
    });
    await invalidarFeatures(tenantId);

    const criar = async (nome, email) => (await registrarNovoLead(tenantId, { nome, email }, usuarioId)).id;
    const arquivado = await criar('M5 arquivado', 'm5-arq@smoke.test');
    const excluido = await criar('M5 excluido', 'm5-exc@smoke.test');
    const vencido = await criar('M5 vencido', 'm5-venc@smoke.test');
    await arquivarLead(tenantId, arquivado);
    await excluirLead(tenantId, excluido);
    await excluirLead(tenantId, vencido);
    // Excluído há 31 dias: passou do prazo, mas a purga ainda não rodou.
    await prisma.$executeRaw`
      UPDATE modulo_crm.leads SET deleted_at = now() - interval '31 days' WHERE id = ${vencido}::uuid
    `;

    const buscar = (situacao) =>
      pesquisarLeads(tenantId, { busca: 'm5', situacao, paginacao: { pagina: 1, tamanho: TAMANHO_PAGINA } });
    const ids = async (situacao) => (await buscar(situacao)).itens.map((lead) => lead.id);

    // Busca e contagem.
    expect(await ids()).toEqual([]);
    expect(await ids('arquivados')).toEqual([arquivado]);
    const lixeira = await buscar('lixeira');
    expect(lixeira.itens.map((lead) => lead.id)).toEqual([excluido]); // o vencido já não aparece
    expect(lixeira.total).toBe(1);
    expect(lixeira.itens[0].purga_em).toBeInstanceOf(Date);

    // Detalhe e edição: 404. Arquivado continua legível.
    await expect(buscarLeadFormatado(tenantId, excluido)).rejects.toThrow('Lead não encontrado');
    await expect(atualizarLeadExistente(tenantId, excluido, { nome: 'Outro' })).rejects.toThrow('Lead não encontrado');
    await expect(buscarLeadFormatado(tenantId, arquivado)).resolves.toMatchObject({ id: arquivado });
    // Edição (de arquivado inclusive) devolve as colunas da leitura, `estagio_nome` incluso.
    const editado = await atualizarLeadExistente(tenantId, arquivado, { nome: 'M5 arquivado editado' });
    expect(editado).toHaveProperty('estagio_nome');
    expect(editado.archived_at).toBeInstanceOf(Date);

    // Deduplicação do import: lixeira não conta, arquivado conta.
    await expect(buscarLeadDuplicado(tenantId, { email: 'm5-exc@smoke.test' })).resolves.toBeUndefined();
    await expect(buscarLeadDuplicado(tenantId, { email: 'm5-arq@smoke.test' })).resolves.toEqual({ id: arquivado });

    // Export: a lixeira não sai.
    await expect(exportarLeads(tenantId, { colunas: ['nome'], filtro: { situacao: 'lixeira' } })).rejects.toThrow(
      'A lixeira não pode ser exportada',
    );

    // Restaurar: dentro do prazo volta; fora dele, 404.
    await expect(restaurarLead(tenantId, vencido)).rejects.toThrow('Lead não encontrado');
    await restaurarLead(tenantId, excluido);
    expect(await ids()).toEqual([excluido]);

    // Purga (só deste tenant): apaga de vez o vencido.
    await expect(purgarLixeira(tenantId, inicioDaLixeira())).resolves.toBe(1);
    const [{ existe }] = await prisma.$queryRaw`
      SELECT EXISTS (SELECT 1 FROM modulo_crm.leads WHERE id = ${vencido}::uuid) AS existe
    `;
    expect(existe).toBe(false);
  });

  it('Atividades e histórico (M6): interação, diff só do que mudou, append-only', async () => {
    const autorId = randomUUID();
    await prisma.usuario.create({
      data: { id: autorId, tenantId, nome: 'Smoke operador', email: `smoke-op-${autorId}@smoke.test`, role: 'OPERADOR', ativo: true },
    });
    const { listas } = await obterSchemaCampos(tenantId);
    const [statusA, statusB] = listas.status.map((opcao) => opcao.key);
    const { id: leadId } = await registrarNovoLead(tenantId, { nome: 'M6 lead', email: 'm6@smoke.test', status: statusA }, autorId);

    const interacao = async () => {
      const [{ ultima_interacao_em: valor }] = await prisma.$queryRaw`
        SELECT ultima_interacao_em FROM modulo_crm.leads WHERE id = ${leadId}::uuid
      `;
      return valor;
    };
    const voltarInteracao = () => prisma.$executeRaw`
      UPDATE modulo_crm.leads SET ultima_interacao_em = '2020-01-01' WHERE id = ${leadId}::uuid
    `;
    const ANTIGA = new Date('2020-01-01T00:00:00Z');

    // Editar um campo não conta como interação (D1); mudar o status conta.
    await atualizarLeadExistente(tenantId, leadId, { nome: 'M6 lead editado' }, autorId);
    expect(await interacao()).toBeNull();
    await atualizarLeadExistente(tenantId, leadId, { status: statusB }, autorId);
    expect(await interacao()).not.toBeNull();
    // Mesmo status de novo: nem interação nem evento.
    await voltarInteracao();
    await atualizarLeadExistente(tenantId, leadId, { status: statusB }, autorId);
    expect(await interacao()).toEqual(ANTIGA);

    // Concluir atividade (na criação ou depois) atualiza a interação.
    await registrarAtividade(tenantId, leadId, { tipo: 'ligacao', titulo: 'Liguei', concluida: true }, autorId);
    expect((await interacao()) > ANTIGA).toBe(true);
    await voltarInteracao();
    const reuniao = await registrarAtividade(
      tenantId,
      leadId,
      { tipo: 'reuniao', titulo: 'Apresentação', agendadaPara: new Date('2030-01-01T13:00:00Z') },
      autorId,
    );
    expect(await interacao()).toEqual(ANTIGA); // agendar não é interação
    await editarAtividade(tenantId, leadId, reuniao.id, { concluida: true });
    expect((await interacao()) > ANTIGA).toBe(true);
    const atividades = await listarAtividades(tenantId, leadId);
    expect(atividades.map((atividade) => atividade.titulo).sort()).toEqual(['Apresentação', 'Liguei']);
    expect(atividades[0].autor).toEqual({ id: autorId, nome: 'Smoke operador' });

    // Histórico: mais novo primeiro, só os campos alterados, autor do token.
    const { itens } = await listarHistorico(tenantId, leadId, { pagina: 1, tamanho: TAMANHO_PAGINA });
    expect(itens.map((evento) => evento.tipo)).toEqual(['atualizado', 'atualizado', 'criado']);
    expect(itens[0].diff).toEqual([
      expect.objectContaining({ campo: 'status', chave: 'status', antes: statusA, depois: statusB }),
    ]);
    expect(itens[1].diff).toEqual([
      expect.objectContaining({ campo: 'nome', antes: 'M6 lead', depois: 'M6 lead editado' }),
    ]);
    expect(itens[2].autor).toEqual({ id: autorId, nome: 'Smoke operador' });

    // Append-only: o conteúdo não muda...
    await expect(prisma.$executeRaw`
      UPDATE modulo_crm.crm_lead_event SET diff = '[]' WHERE lead_id = ${leadId}::uuid
    `).rejects.toThrow(/append-only/);
    // ...mas o usuário pode sair: o autor vira nulo (ON DELETE SET NULL passa no trigger).
    await prisma.usuario.delete({ where: { id: autorId } });
    const depois = await listarHistorico(tenantId, leadId, { pagina: 1, tamanho: TAMANHO_PAGINA });
    expect(depois.itens.every((evento) => evento.autor === null)).toBe(true);
  });
});
