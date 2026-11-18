import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { encerrarCache } from '#core/cache/cache.js';
import { getAdminClient } from '#core/db/tenantClient.js';
import { invalidarFeatures } from '#core/tenant/feature-flags.js';
import { HTTP_STATUS } from '#shared/constants/index.js';

import { contarEsfriandoPorResponsavel } from '../adapters/crm-inatividade.repository.js';
import { buscarPipelines } from '../adapters/crm-pipelines.repository.js';
import { buscarImportJob, transicionarStatus } from '../adapters/import-jobs.repository.js';
import { purgarLixeira } from '../adapters/leads.repository.js';
import { CRM_FEATURES, FAIXAS_SCORE_PADRAO, MODULO_CRM, TIPOS_PIPELINE } from '../constants.js';
import { arquivarLead, excluirLead, restaurarLead } from './arquivo.service.js';
import {
  atualizarConfiguracaoCampo,
  listarConfiguracaoCampos,
} from './configuracoes-campos.service.js';
import { obterSchemaCampos } from './field-schema.service.js';
import { processarImportacao, validarImportacao } from './import.service.js';
import { salvarInatividade } from './inatividade.service.js';
import {
  atualizarLeadExistente,
  buscarLeadFormatado,
  pesquisarLeads,
  registrarNovoLead,
} from './leads.service.js';
import { editarLeadsEmMassa } from './leads-bulk.service.js';
import { anonimizarLeadDoTitular } from './lgpd.service.js';
import { atualizarOpcao, listarListas } from './listas.service.js';
import { mesclarLeads } from './mesclagem.service.js';
import {
  criarOportunidade,
  definirLixeiraDaOportunidade,
  editarOportunidade,
  listarOportunidadesDaPessoa,
  mudarStatusDaOportunidade,
} from './oportunidades.service.js';
import { gerarPlanilha } from './planilha.service.js';
import { reconciliarTenant } from './reconcile.service.js';
import { salvarConfigScore } from './score.service.js';

/**
 * M2.5, F4: `/crm/leads` sobre a oportunidade, contra o Postgres. O que a API
 * devolve está em `leads.contrato.db.test.js`; aqui, para onde cada dado foi.
 *
 * GRAVA no banco de `DATABASE_URL` (tenant SMOKE, apagado no fim): só roda
 * com `CRM_DB_TESTS=1`, num banco de dev.
 */
const rodar =
  process.env.CRM_DB_TESTS === '1' && process.env.DATABASE_URL ? describe : describe.skip;

const TIMEOUT_MS = 120_000;
const TAMANHO_SUFIXO = 8;
const VALOR = 1500;
const OUTRO_VALOR = 300;
const PROBABILIDADE = 40;
const DIAS_PARA_ESFRIAR = 3;
const DIAS_ATRAS = 10;
const PONTOS_PROPOSTA = 30;
const TAMANHO_PAGINA = 10;

rodar('lead sobre a oportunidade (CRM_DB_TESTS=1)', { timeout: TIMEOUT_MS }, () => {
  const prisma = getAdminClient();
  const tenantId = randomUUID();
  const donoId = randomUUID();
  const outroId = randomUUID();
  let vendas;
  let atendimento;
  let listas;

  const novoLead = async (campos = {}) =>
    (
      await registrarNovoLead(
        tenantId,
        { nome: 'Pessoa', email: `${randomUUID()}@smoke.test`, ...campos },
        donoId,
      )
    ).id;
  const editar = (id, campos) => atualizarLeadExistente(tenantId, id, campos, donoId);
  const ler = (id) => buscarLeadFormatado(tenantId, id);
  const oportunidades = (id) => listarOportunidadesDaPessoa(tenantId, id);

  /** @param {string} id */
  const linhaDoLead = async (id) => {
    const [linha] = await prisma.$queryRaw`
      SELECT lifecycle_stage, principal_deal_id::text, ultima_interacao_em, deleted_at
      FROM modulo_crm.leads WHERE id = ${id}::uuid
    `;

    return linha;
  };
  /** @param {string} leadId */
  const linhasDeOportunidade = (leadId) => prisma.$queryRaw`
    SELECT id::text, status, title, amount, owner_id::text, deleted_at, pipeline_id::text
    FROM modulo_crm.crm_deal WHERE lead_id = ${leadId}::uuid ORDER BY created_at, id
  `;
  /** @param {string} id */
  const timeline = (id) => prisma.$queryRaw`
    SELECT tipo, diff FROM modulo_crm.crm_lead_event WHERE lead_id = ${id}::uuid ORDER BY created_at
  `;
  /** @param {string} dealId */
  const outbox = async (dealId) =>
    (
      await prisma.$queryRaw`
        SELECT tipo FROM modulo_crm.crm_event
        WHERE tenant_id = ${tenantId}::uuid AND entidade_id = ${dealId}::uuid
        ORDER BY occurred_at
      `
    ).map((linha) => linha.tipo);

  beforeAll(async () => {
    await prisma.tenant.create({
      data: {
        id: tenantId,
        nome: 'SMOKE lead oportunidade',
        subdomain: `smoke-leadop-${tenantId.slice(0, TAMANHO_SUFIXO)}`,
      },
    });

    await prisma.usuario.createMany({
      data: [donoId, outroId].map((id) => ({
        id,
        tenantId,
        nome: 'Usuário',
        email: `${id}@smoke.test`,
        senhaHash: 'test',
        role: 'DONO',
      })),
    });

    await prisma.tenantModule.create({ data: { tenantId, moduleKey: MODULO_CRM } });

    await prisma.tenantModuleFeature.createMany({
      data: [
        CRM_FEATURES.LGPD,
        CRM_FEATURES.ARQUIVO,
        CRM_FEATURES.INATIVIDADE,
        CRM_FEATURES.MASSA,
        CRM_FEATURES.DUPLICIDADE,
        CRM_FEATURES.SCORE,
      ].map((featureKey) => ({ tenantId, moduleKey: MODULO_CRM, featureKey })),
    });

    await invalidarFeatures(tenantId);
    await reconciliarTenant(tenantId);

    const campos = await listarConfiguracaoCampos(tenantId);

    for (const chave of ['dataConversao', 'probabilidadeFechamento', 'motivoPerda']) {
      await atualizarConfiguracaoCampo(tenantId, campos.find((campo) => campo.chave === chave).id, {
        visibilidade: { create_form: true, detail: true, table: true, filter: true },
      });
    }

    const pipelines = await buscarPipelines(tenantId);

    vendas = pipelines.find((pipeline) => pipeline.padrao);
    atendimento = pipelines.find((pipeline) => pipeline.tipo === TIPOS_PIPELINE.ATENDIMENTO);
    listas = await listarListas(tenantId);
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM modulo_crm.leads WHERE tenant_id = ${tenantId}::uuid`;
    await prisma.$executeRaw`DELETE FROM modulo_crm.crm_event WHERE tenant_id = ${tenantId}::uuid`;
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await encerrarCache();
  });

  describe('criar', () => {
    it('nasce com oportunidade em Vendas, que é a principal', async () => {
      const id = await novoLead({ status: 'proposta', valor: VALOR });

      const [deal, ...resto] = await linhasDeOportunidade(id);

      expect(resto).toEqual([]);
      expect(deal).toMatchObject({ pipeline_id: vendas.id, status: 'proposta', owner_id: donoId });
      expect(Number(deal.amount)).toBe(VALOR);

      expect(await linhaDoLead(id)).toMatchObject({
        lifecycle_stage: 'oportunidade',
        principal_deal_id: deal.id,
      });
    });

    it('a timeline mostra só "criado"; o outbox registra a oportunidade', async () => {
      const id = await novoLead();
      const [deal] = await linhasDeOportunidade(id);

      expect((await timeline(id)).map((evento) => evento.tipo)).toEqual(['criado']);
      expect(await outbox(deal.id)).toEqual(['deal.created']);
    });

    it('nascer ganho vira cliente e já abre o atendimento', async () => {
      const id = await novoLead({ status: 'ganho' });

      expect((await linhaDoLead(id)).lifecycle_stage).toBe('cliente');
      expect((await oportunidades(id)).map((deal) => deal.pipelineId)).toContain(atendimento.id);
    });

    it('data de conversão fora de venda ganha: 400 e nada é criado', async () => {
      const email = `${randomUUID()}@smoke.test`;

      await expect(novoLead({ email, dataConversao: new Date() })).rejects.toMatchObject({
        statusCode: HTTP_STATUS.BAD_REQUEST,
        fields: { dataConversao: expect.any(Array) },
      });

      const [{ total }] = await prisma.$queryRaw`
        SELECT count(*)::int AS total FROM modulo_crm.leads WHERE email = ${email}
      `;

      expect(total).toBe(0);
    });
  });

  describe('editar', () => {
    it('o comercial vai para a principal, e a resposta vem igual', async () => {
      const id = await novoLead();
      const lead = await editar(id, {
        valor: VALOR,
        probabilidadeFechamento: PROBABILIDADE,
        empresa: 'Acme',
      });

      expect(Number(lead.valor)).toBe(VALOR);
      expect(Number(lead.probabilidade_fechamento)).toBe(PROBABILIDADE);

      const [deal] = await linhasDeOportunidade(id);

      expect(Number(deal.amount)).toBe(VALOR);
    });

    it('um PUT é um evento só na timeline, com o diff do comercial', async () => {
      const id = await novoLead();

      await editar(id, { status: 'proposta', valor: VALOR, cidade: 'Curitiba' });

      const eventos = await timeline(id);

      expect(eventos.map((evento) => evento.tipo)).toEqual(['criado', 'atualizado']);

      const campos = eventos[1].diff.map((entrada) => entrada.campo);

      expect(campos).toEqual(expect.arrayContaining(['status', 'valor']));
    });

    it('ganhar pelo PUT tem todos os efeitos do service único', async () => {
      const id = await novoLead();
      const lead = await editar(id, { status: 'ganho' });

      expect(lead.data_conversao).toEqual(expect.any(Date));
      expect((await linhaDoLead(id)).lifecycle_stage).toBe('cliente');

      const criadas = await oportunidades(id);

      expect(criadas.filter((deal) => deal.pipelineId === atendimento.id)).toHaveLength(1);

      const venda = criadas.find((deal) => deal.pipelineId === vendas.id);

      expect(await outbox(venda.id)).toEqual(['deal.created', 'deal.won']);
    });

    it('reabrir pelo PUT limpa a data e avisa o atendimento', async () => {
      const id = await novoLead();

      await editar(id, { status: 'ganho' });

      const lead = await editar(id, { status: 'novo' });

      expect(lead.data_conversao).toBeNull();

      const [atendimentoDela] = (await oportunidades(id)).filter(
        (deal) => deal.pipelineId === atendimento.id,
      );

      expect(atendimentoDela.origemReabertaEm).not.toBeNull();
    });

    it('mudar para o mesmo status não grava evento nem conta como interação', async () => {
      const id = await novoLead({ status: 'proposta' });
      const antes = (await linhaDoLead(id)).ultima_interacao_em;

      await editar(id, { status: 'proposta' });

      expect((await linhaDoLead(id)).ultima_interacao_em).toEqual(antes);

      const [deal] = await linhasDeOportunidade(id);

      expect(await outbox(deal.id)).toEqual(['deal.created']);
    });

    it('funilEstagioId, como a leitura devolve, troca o status', async () => {
      const id = await novoLead();
      const proposta = listas.status.find((opcao) => opcao.key === 'proposta');

      expect((await editar(id, { funilEstagioId: proposta.id })).status).toBe('proposta');
    });

    it('status nulo: 400, e nada muda', async () => {
      const id = await novoLead({ status: 'proposta' });

      await expect(editar(id, { status: null, cidade: 'Lapa' })).rejects.toMatchObject({
        statusCode: HTTP_STATUS.BAD_REQUEST,
        fields: { status: expect.any(Array) },
      });

      expect(await ler(id)).toMatchObject({ status: 'proposta' });
    });

    it('falha na oportunidade desfaz o contato (transação única)', async () => {
      const id = await novoLead();

      await expect(
        editar(id, { nome: 'Outro nome', dataConversao: new Date() }),
      ).rejects.toMatchObject({ statusCode: HTTP_STATUS.BAD_REQUEST });

      expect((await ler(id)).nome).toBe('Pessoa');
    });

    it('falha no outbox desfaz a edição inteira', async () => {
      const id = await novoLead();
      const outboxRepo = await import('../adapters/crm-outbox.repository.js');

      vi.resetModules();

      vi.doMock('../adapters/crm-outbox.repository.js', () => ({
        ...outboxRepo,
        publicarEvento: () => Promise.reject(new Error('outbox fora')),
      }));

      const { atualizarLeadExistente: editarSemOutbox } = await import('./leads.service.js');

      await expect(
        editarSemOutbox(tenantId, id, { valor: VALOR, nome: 'Outro nome' }),
      ).rejects.toThrow('outbox fora');

      vi.doUnmock('../adapters/crm-outbox.repository.js');
      vi.resetModules();

      const lead = await ler(id);

      expect(lead.valor).toBeNull();
      expect(lead.nome).toBe('Pessoa');
    });

    it('lead sem oportunidade: dado comercial cria outra; só contato, não', async () => {
      const id = await novoLead();
      const [deal] = await linhasDeOportunidade(id);

      await definirLixeiraDaOportunidade(tenantId, deal.id, true, donoId);

      await editar(id, { cidade: 'Lapa', usuarioResponsavelId: outroId });
      expect(await oportunidades(id)).toHaveLength(0);

      await editar(id, { valor: VALOR });

      const [nova, ...resto] = await oportunidades(id);

      expect(resto).toEqual([]);
      expect(nova.responsavelId).toBe(outroId);
      expect(Number((await ler(id)).valor)).toBe(VALOR);
    });
  });

  describe('responsável', () => {
    it('alcança a principal; o atendimento mantém o dono dele', async () => {
      const id = await novoLead({ status: 'ganho' });

      await editar(id, { usuarioResponsavelId: outroId });

      const linhas = await oportunidades(id);

      expect(linhas.find((deal) => deal.pipelineId === vendas.id).responsavelId).toBe(outroId);
      expect(linhas.find((deal) => deal.pipelineId === atendimento.id).responsavelId).toBe(donoId);
    });

    it('edição em massa também alcança', async () => {
      const id = await novoLead();

      await editarLeadsEmMassa(
        tenantId,
        { ids: [id], alteracoes: { usuarioResponsavelId: outroId, status: 'proposta' } },
        donoId,
      );

      const [deal] = await linhasDeOportunidade(id);

      expect(deal).toMatchObject({ owner_id: outroId, status: 'proposta' });
    });
  });

  describe('leitura', () => {
    it('o que o service único grava aparece no lead', async () => {
      const id = await novoLead();
      const [{ id: dealId }] = await linhasDeOportunidade(id);

      await editarOportunidade(tenantId, dealId, { valor: OUTRO_VALOR }, donoId);
      await mudarStatusDaOportunidade(tenantId, dealId, { status: 'proposta' }, donoId);

      const lead = await ler(id);

      expect(lead.status).toBe('proposta');
      expect(Number(lead.valor)).toBe(OUTRO_VALOR);
    });

    it('filtro por estágio acha o lead pela opção de status', async () => {
      const marca = randomUUID();
      const id = await novoLead({ nome: `Estágio ${marca}`, status: 'proposta' });

      await novoLead({ nome: `Estágio ${marca}` });

      const proposta = listas.status.find((opcao) => opcao.key === 'proposta');

      const { itens } = await pesquisarLeads(tenantId, {
        busca: marca,
        funilEstagioId: proposta.id,
        filtros: [],
        paginacao: { pagina: 1, tamanho: TAMANHO_PAGINA },
      });

      expect(itens.map((lead) => lead.id)).toEqual([id]);
    });

    it('score lê o status da principal, e recalcula pelo service único', async () => {
      const { campos } = await obterSchemaCampos(tenantId);

      await salvarConfigScore(tenantId, {
        regras: [
          {
            nome: 'Em proposta',
            ativo: true,
            pontos: PONTOS_PROPOSTA,
            condicoes: [
              {
                campoId: campos.find((campo) => campo.chave === 'status').id,
                operador: 'igual',
                valor: 'proposta',
              },
            ],
          },
        ],
        faixas: FAIXAS_SCORE_PADRAO.map((faixa) => ({ ...faixa })),
      });

      const id = await novoLead({ status: 'proposta' });

      expect(Number((await ler(id)).lead_score)).toBe(PONTOS_PROPOSTA);

      const [deal] = await linhasDeOportunidade(id);

      await mudarStatusDaOportunidade(tenantId, deal.id, { status: 'novo' }, donoId);
      expect(Number((await ler(id)).lead_score)).toBe(0);
    });

    it('esfriando olha o status da principal, e no pipeline certo', async () => {
      await salvarInatividade(tenantId, { status: { proposta: DIAS_PARA_ESFRIAR } });

      const id = await novoLead({ status: 'proposta', usuarioResponsavelId: outroId });

      await prisma.$executeRaw`
        UPDATE modulo_crm.leads
        SET created_at = now() - make_interval(days => ${DIAS_ATRAS}::int)
        WHERE id = ${id}::uuid
      `;

      expect((await ler(id)).esfriando_desde).toEqual(expect.any(Date));

      const contagem = await contarEsfriandoPorResponsavel(tenantId, new Date());

      expect(contagem).toContainEqual({ usuario_id: outroId, total: 1 });

      await editar(id, { status: 'perdido' });
      expect((await ler(id)).esfriando_desde).toBeNull();
    });
  });

  describe('importar', () => {
    const importar = async (email, estrategiaDuplicata) => {
      const planilha = await gerarPlanilha(
        ['Nome', 'E-mail', 'Status', 'Valor'],
        [['Importado', email, 'proposta', VALOR]],
      );
      const { jobId } = await validarImportacao(tenantId, donoId, planilha, {
        mapeamento: { Nome: 'nome', 'E-mail': 'email', Status: 'status', Valor: 'valor' },
        estrategiaDuplicata,
      });

      await transicionarStatus(tenantId, jobId, 'pendente', 'processando');
      await processarImportacao(tenantId, jobId);

      return buscarImportJob(tenantId, jobId);
    };

    it('lead novo vem com oportunidade', async () => {
      const email = `${randomUUID()}@smoke.test`;

      expect(await importar(email, 'criar')).toMatchObject({ linhas_criadas: 1 });

      const [{ id }] = await prisma.$queryRaw`
        SELECT id::text FROM modulo_crm.leads WHERE email = ${email}
      `;
      const [deal, ...resto] = await linhasDeOportunidade(id);

      expect(resto).toEqual([]);
      expect(deal.status).toBe('proposta');
      expect((await linhaDoLead(id)).principal_deal_id).toBe(deal.id);
    });

    it('a coluna Estágio casa com o nome do status; inativo ou desconhecido não entra', async () => {
      const email = `${randomUUID()}@smoke.test`;
      const planilha = await gerarPlanilha(
        ['Nome', 'E-mail', 'Estágio'],
        [
          ['Com estágio', email, 'PROPOSTA'],
          ['Sem estágio', `${randomUUID()}@smoke.test`, 'Não existe'],
        ],
      );
      const { jobId } = await validarImportacao(tenantId, donoId, planilha, {
        mapeamento: { Nome: 'nome', 'E-mail': 'email', Estágio: 'funilEstagio' },
        estrategiaDuplicata: 'criar',
      });

      await transicionarStatus(tenantId, jobId, 'pendente', 'processando');
      await processarImportacao(tenantId, jobId);

      expect(await buscarImportJob(tenantId, jobId)).toMatchObject({ linhas_criadas: 1 });

      const [{ id }] = await prisma.$queryRaw`
        SELECT id::text FROM modulo_crm.leads WHERE email = ${email}
      `;

      expect((await ler(id)).status).toBe('proposta');
    });

    it('duplicado com "atualizar" muda a principal, sem criar outra', async () => {
      const email = `${randomUUID()}@smoke.test`;
      const id = await novoLead({ email });

      expect(await importar(email, 'atualizar')).toMatchObject({ linhas_atualizadas: 1 });

      const [deal, ...resto] = await linhasDeOportunidade(id);

      expect(resto).toEqual([]);
      expect(deal.status).toBe('proposta');
      expect(Number(deal.amount)).toBe(VALOR);
    });
  });

  describe('mesclar', () => {
    it('as oportunidades passam para o principal, sem sobrar nada no secundário', async () => {
      const principal = await novoLead({ status: 'proposta', valor: OUTRO_VALOR });
      const secundario = await novoLead({ status: 'ganho', valor: VALOR });

      await mesclarLeads(tenantId, { principalId: principal, secundarioId: secundario }, donoId);

      const vendasDele = (await oportunidades(principal)).filter(
        (deal) => deal.pipelineId === vendas.id,
      );

      expect(vendasDele.map((deal) => deal.status).sort()).toEqual(['ganho', 'proposta']);
      expect(await linhasDeOportunidade(secundario)).toEqual([]);

      expect(await linhaDoLead(secundario)).toMatchObject({
        principal_deal_id: null,
        lifecycle_stage: 'lead',
      });
    });

    it('recalcula: venda ganha do secundário faz do principal um cliente', async () => {
      const principal = await novoLead({ status: 'proposta', valor: OUTRO_VALOR });
      const secundario = await novoLead({ status: 'ganho', valor: VALOR });
      const [ganha] = await linhasDeOportunidade(secundario);

      await mesclarLeads(tenantId, { principalId: principal, secundarioId: secundario }, donoId);

      const lead = await linhaDoLead(principal);

      expect(lead.lifecycle_stage).toBe('cliente');
      expect((await ler(principal)).status).toBe('proposta');
      expect(await outbox(ganha.id)).toContain('deal.updated');
    });

    it('oportunidade na lixeira do secundário também passa', async () => {
      const principal = await novoLead();
      const secundario = await novoLead();
      const [deal] = await linhasDeOportunidade(secundario);

      await definirLixeiraDaOportunidade(tenantId, deal.id, true, donoId);

      await mesclarLeads(tenantId, { principalId: principal, secundarioId: secundario }, donoId);

      expect((await linhasDeOportunidade(principal)).map((linha) => linha.id)).toContain(deal.id);
    });

    it('o responsável escolhido alcança a principal', async () => {
      const principal = await novoLead();
      const secundario = await novoLead({ usuarioResponsavelId: outroId });

      await mesclarLeads(
        tenantId,
        {
          principalId: principal,
          secundarioId: secundario,
          escolhas: { usuarioResponsavelId: 'secundario' },
        },
        donoId,
      );

      const { principal_deal_id: dealId } = await linhaDoLead(principal);
      const deal = (await linhasDeOportunidade(principal)).find((linha) => linha.id === dealId);

      expect(deal.owner_id).toBe(outroId);
    });
  });

  describe('anonimizar', () => {
    it('limpa o título em toda a cadeia; status e valor ficam', async () => {
      const titular = await novoLead({ valor: VALOR });
      const mesclado = await novoLead();

      await criarOportunidade(tenantId, mesclado, { titulo: 'Reforma da Ana' }, donoId);
      await mesclarLeads(tenantId, { principalId: titular, secundarioId: mesclado }, donoId);

      await anonimizarLeadDoTitular(tenantId, titular, donoId);

      const linhas = await linhasDeOportunidade(titular);

      expect(linhas.length).toBeGreaterThan(1);

      for (const linha of linhas) {
        expect(linha.title).toBeNull();
      }

      expect(linhas.some((linha) => Number(linha.amount) === VALOR)).toBe(true);
      expect(JSON.stringify(await timeline(titular))).not.toContain('Reforma da Ana');
    });

    it('o outbox não guarda dado pessoal', async () => {
      const nome = `Titular ${randomUUID()}`;
      const titular = await novoLead({ nome, status: 'ganho' });

      await anonimizarLeadDoTitular(tenantId, titular, donoId);

      const [{ total }] = await prisma.$queryRaw`
        SELECT count(*)::int AS total FROM modulo_crm.crm_event
        WHERE tenant_id = ${tenantId}::uuid AND payload::text LIKE ${`%${nome}%`}
      `;

      expect(total).toBe(0);
    });
  });

  describe('lixeira e purga', () => {
    it('a oportunidade acompanha; na lixeira, o lead ainda mostra o comercial', async () => {
      const id = await novoLead({ valor: VALOR });

      await excluirLead(tenantId, id, donoId);

      const [deal] = await linhasDeOportunidade(id);

      expect(deal.deleted_at).not.toBeNull();
      expect(await outbox(deal.id)).toContain('deal.deleted');

      const [lido] = await prisma.$queryRaw`
        SELECT d.amount FROM modulo_crm.leads l
        JOIN modulo_crm.crm_deal d ON d.id = l.principal_deal_id WHERE l.id = ${id}::uuid
      `;

      expect(Number(lido.amount)).toBe(VALOR);
    });

    it('restaurar traz só as que foram junto', async () => {
      const id = await novoLead();
      const extra = await criarOportunidade(tenantId, id, {}, donoId);

      await definirLixeiraDaOportunidade(tenantId, extra.id, true, donoId);
      await excluirLead(tenantId, id, donoId);

      await restaurarLead(tenantId, id, donoId);

      const ativas = await oportunidades(id);

      expect(ativas).toHaveLength(1);
      expect(ativas[0].id).not.toBe(extra.id);
    });

    it('oportunidade de lead na lixeira não volta sozinha', async () => {
      const id = await novoLead();
      const [deal] = await linhasDeOportunidade(id);

      await excluirLead(tenantId, id, donoId);

      await expect(
        definirLixeiraDaOportunidade(tenantId, deal.id, false, donoId),
      ).rejects.toMatchObject({ statusCode: HTTP_STATUS.NOT_FOUND });
    });

    it('purgar apaga as oportunidades junto', async () => {
      const id = await novoLead();

      await excluirLead(tenantId, id, donoId);

      // O limite sai do relógio do banco, que carimbou `deleted_at`: o do Neon
      // anda quase 1 s à frente desta máquina, e `Date.now()` deixava a linha escapar.
      const [{ deleted_at: excluidoEm }] = await linhasDeOportunidade(id);

      await purgarLixeira(tenantId, new Date(excluidoEm.getTime() + 1));
      expect(await linhasDeOportunidade(id)).toEqual([]);
    });

    it('arquivar o lead não mexe na oportunidade', async () => {
      const id = await novoLead();

      await arquivarLead(tenantId, id, donoId);
      expect(await oportunidades(id)).toHaveLength(1);
    });
  });

  describe('configuração', () => {
    it('categoria de status em uso não muda; sem uso, muda', async () => {
      await novoLead({ status: 'proposta' });

      const proposta = listas.status.find((opcao) => opcao.key === 'proposta');

      await expect(
        atualizarOpcao(tenantId, 'status', proposta.id, { category: 'ganho' }),
      ).rejects.toMatchObject({
        statusCode: HTTP_STATUS.CONFLICT,
        fields: { category: expect.any(Array) },
      });

      const livre = listas.status.find(
        (opcao) => opcao.category === 'aberto' && !['novo', 'proposta'].includes(opcao.key),
      );

      await expect(
        atualizarOpcao(tenantId, 'status', livre.id, { category: 'perdido' }),
      ).resolves.toMatchObject({ category: 'perdido' });
    });
  });
});
