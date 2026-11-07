import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#api/app.js';
import { encerrarCache } from '#core/cache/cache.js';
import { getAdminClient } from '#core/db/tenantClient.js';
import { invalidarFeatures } from '#core/tenant/feature-flags.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
import { CRM_FEATURES, MODULO_CRM } from '../constants.js';
import {
  atualizarConfiguracaoCampo,
  listarConfiguracaoCampos,
} from '../services/configuracoes-campos.service.js';
import { reconciliarTenant } from '../services/reconcile.service.js';

/**
 * M3: o CRM como provedor do motor de quadros, pelas rotas do Kanban. Cobre o
 * aceite do marco e a visibilidade por pipeline (D4). GRAVA no banco de
 * `DATABASE_URL` (tenant SMOKE, apagado no fim): só roda com `CRM_DB_TESTS=1`.
 */
const rodar =
  process.env.CRM_DB_TESTS === '1' && process.env.DATABASE_URL ? describe : describe.skip;

const TIMEOUT_MS = 120_000;
const TAMANHO_SUFIXO = 8;
const VALOR = 1500;
const OUTRO_VALOR = 300;
const TERCEIRO_VALOR = 700;
const LIMITE = 20;
const TRES = 3;
const DUAS = 2;
const BOARD = 'crm_oportunidades';
const FLAG_KANBAN = 'kanban_universal.quadros_entidade';

rodar('quadro comercial (CRM_DB_TESTS=1)', { timeout: TIMEOUT_MS }, () => {
  const prisma = getAdminClient();
  const tenantId = randomUUID();
  const donoId = randomUUID();
  const operadorId = randomUUID();
  let app;
  let vendas;
  let atendimento;

  const operador = { papel: 'OPERADOR', userId: operadorId };

  async function chamar(method, url, payload, { papel = 'DONO', userId = donoId } = {}) {
    const token = app.jwt.access.sign({ tenantId, userId, role: papel });
    const resposta = await app.inject({
      method,
      url,
      payload,
      headers: { authorization: `Bearer ${token}` },
    });
    const corpo = resposta.body ? JSON.parse(resposta.body) : null;
    return { status: resposta.statusCode, corpo, dados: corpo?.data };
  }
  const ok = async (promessa, status = HTTP_STATUS.OK) => {
    const resposta = await promessa;
    expect(resposta.status, JSON.stringify(resposta.corpo)).toBe(status);
    return resposta.dados;
  };

  const quadro = (pipelineId) => `/kanban/quadros/${BOARD}/${pipelineId}`;
  const cards = (pipelineId, colunaRef, opcoes, consulta = {}) =>
    ok(
      chamar(
        'POST',
        `${quadro(pipelineId)}/cards/busca`,
        { colunaRef, limite: LIMITE, ...consulta },
        opcoes,
      ),
    );
  const novoLead = async (campos = {}) =>
    (
      await ok(
        chamar('POST', '/crm/leads', {
          nome: 'Pessoa',
          email: `${randomUUID()}@smoke.test`,
          ...campos,
        }),
        HTTP_STATUS.CREATED,
      )
    ).id;
  const oportunidades = (leadId, opcoes) =>
    ok(chamar('GET', `/crm/leads/${leadId}/oportunidades`, undefined, opcoes));
  const mover = (pipelineId, entidadeId, colunaDestino, opcoes) =>
    chamar('PATCH', `${quadro(pipelineId)}/cards/${entidadeId}/mover`, { colunaDestino }, opcoes);
  const ligarPermissao = async (acessos) => {
    const { campos } = await ok(chamar('GET', '/crm/configuracoes/permissoes'));
    const id = (chave) => campos.find((campo) => campo.chave === chave).id;
    await ok(
      chamar('PUT', '/crm/configuracoes/permissoes', {
        OPERADOR: Object.fromEntries(
          Object.entries(acessos).map(([chave, acesso]) => [id(chave), acesso]),
        ),
      }),
    );
  };
  const ocultar = (id, oculto) =>
    ok(chamar('PUT', `/crm/configuracoes/pipelines/${id}`, { visivelOperador: !oculto }));

  beforeAll(async () => {
    await prisma.tenant.create({
      data: {
        id: tenantId,
        nome: 'SMOKE quadro comercial',
        subdomain: `smoke-quadro-${tenantId.slice(0, TAMANHO_SUFIXO)}`,
      },
    });
    await prisma.usuario.createMany({
      data: [
        { id: donoId, role: 'DONO' },
        { id: operadorId, role: 'OPERADOR' },
      ].map(({ id, role }) => ({
        id,
        tenantId,
        nome: 'Usuário',
        email: `${id}@smoke.test`,
        senhaHash: 'test',
        role,
      })),
    });
    await prisma.tenantModule.createMany({
      data: [MODULO_CRM, 'kanban_universal'].map((moduleKey) => ({ tenantId, moduleKey })),
    });
    await prisma.tenantModuleFeature.createMany({
      data: [
        { moduleKey: MODULO_CRM, featureKey: CRM_FEATURES.QUADRO_COMERCIAL },
        { moduleKey: MODULO_CRM, featureKey: CRM_FEATURES.PERMISSOES },
        { moduleKey: MODULO_CRM, featureKey: CRM_FEATURES.REGRAS },
        { moduleKey: MODULO_CRM, featureKey: CRM_FEATURES.INATIVIDADE },
        { moduleKey: MODULO_CRM, featureKey: CRM_FEATURES.TIMELINE },
        { moduleKey: MODULO_CRM, featureKey: CRM_FEATURES.ARQUIVO },
        { moduleKey: MODULO_CRM, featureKey: CRM_FEATURES.ATIVIDADES },
        { moduleKey: MODULO_CRM, featureKey: CRM_FEATURES.MASSA },
        { moduleKey: 'kanban_universal', featureKey: FLAG_KANBAN },
      ].map((linha) => ({ tenantId, ...linha })),
    });
    await invalidarFeatures(tenantId);
    await reconciliarTenant(tenantId);
    const campos = await listarConfiguracaoCampos(tenantId);
    await atualizarConfiguracaoCampo(
      tenantId,
      campos.find((campo) => campo.chave === 'motivoPerda').id,
      { visibilidade: { create_form: true, detail: true, table: true, filter: true } },
    );
    app = await buildApp({
      config: {
        APP_NAME: 'crm-quadro',
        NODE_ENV: 'test',
        CORS_ORIGIN: '*',
        JWT_SECRET: 'local-test-secret-access-only',
        JWT_REFRESH_SECRET: 'local-test-secret-refresh-only',
      },
    });
    [vendas, atendimento] = await ok(chamar('GET', '/crm/configuracoes/pipelines'));
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM modulo_crm.leads WHERE tenant_id = ${tenantId}::uuid`;
    await prisma.$executeRaw`DELETE FROM modulo_crm.crm_event WHERE tenant_id = ${tenantId}::uuid`;
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await app?.close();
    await encerrarCache();
  });

  describe('aceite do M3', () => {
    it('arrastar para Perdido sem motivo é recusado com a lista de campos', async () => {
      const leadId = await novoLead();
      const [deal] = await oportunidades(leadId);

      const resposta = await mover(vendas.id, deal.id, 'perdido');

      expect(resposta.status).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(resposta.corpo.error.code).toBe(ERROR_CODES.CAMPOS_OBRIGATORIOS);
      expect(resposta.corpo.error.fields).toHaveProperty('motivoPerda');
      expect((await oportunidades(leadId))[0].status).toBe('novo');
    });

    it('a oportunidade movida aparece igual na tabela, no quadro e na timeline', async () => {
      const leadId = await novoLead();
      const [deal] = await oportunidades(leadId);

      await ok(mover(vendas.id, deal.id, 'proposta'));

      expect((await ok(chamar('GET', `/crm/leads/${leadId}`))).status).toBe('proposta');
      const { itens } = await cards(vendas.id, 'proposta');
      expect(itens.map((card) => card.entidadeId)).toContain(deal.id);
      const historico = await ok(chamar('GET', `/crm/leads/${leadId}/historico`));
      expect(JSON.stringify(historico.itens)).toContain('proposta');
    });

    it('pipeline criado pelo dono aparece como quadro, e desativado some', async () => {
      const novo = await ok(
        chamar('POST', '/crm/configuracoes/pipelines', { nome: 'Recompra', tipo: 'sales' }),
        HTTP_STATUS.CREATED,
      );
      const refs = async () =>
        (await ok(chamar('GET', '/kanban/boards')))
          .filter((item) => item.modo === 'entidade')
          .map((item) => item.quadroRef);

      expect(await refs()).toContain(novo.id);
      const colunas = await ok(chamar('GET', `${quadro(novo.id)}/colunas`));
      expect(colunas.map((coluna) => coluna.ref)).toEqual(['novo', 'ganho', 'perdido']);

      await ok(chamar('PUT', `/crm/configuracoes/pipelines/${novo.id}`, { ativo: false }));
      expect(await refs()).not.toContain(novo.id);
      await ok(chamar('DELETE', `/crm/configuracoes/pipelines/${novo.id}`));
    });

    it('venda ganha gera card no quadro de atendimento; desligada, não', async () => {
      const comAutomacao = await novoLead();
      const [venda] = await oportunidades(comAutomacao);
      await ok(mover(vendas.id, venda.id, 'ganho'));
      const { itens } = await cards(atendimento.id, 'aguardando');
      const noQuadro = (await oportunidades(comAutomacao)).find(
        (deal) => deal.pipelineId === atendimento.id,
      );
      expect(itens.map((card) => card.entidadeId)).toContain(noQuadro.id);

      await ok(
        chamar('PUT', `/crm/configuracoes/pipelines/${atendimento.id}`, {
          automacao: { ativa: false },
        }),
      );
      const semAutomacao = await novoLead();
      const [outra] = await oportunidades(semAutomacao);
      await ok(mover(vendas.id, outra.id, 'ganho'));
      expect(await oportunidades(semAutomacao)).toHaveLength(1);
      await ok(
        chamar('PUT', `/crm/configuracoes/pipelines/${atendimento.id}`, {
          automacao: { ativa: true },
        }),
      );
    });

    it('OPERADOR sem acesso a Valor não recebe valor nem soma', async () => {
      const leadId = await novoLead({ status: 'qualificado', valor: VALOR });
      await ligarPermissao({ valor: 'hidden' });

      const dono = await ok(
        chamar('POST', `${quadro(vendas.id)}/resumo`, { colunaRef: 'qualificado' }),
      );
      expect(dono.soma).toBe(VALOR);
      const visto = await ok(
        chamar('POST', `${quadro(vendas.id)}/resumo`, { colunaRef: 'qualificado' }, operador),
      );
      expect(visto.soma).toBeNull();

      expect(JSON.stringify(await cards(vendas.id, 'qualificado', operador))).not.toContain(
        String(VALOR),
      );
      expect(
        await ok(chamar('GET', `/crm/leads/${leadId}`, undefined, operador)),
      ).not.toHaveProperty('valor');
      const [deal] = await oportunidades(leadId, operador);
      expect(deal).not.toHaveProperty('valor');
      const busca = await chamar(
        'POST',
        '/crm/leads/search',
        { valorMin: 1, paginacao: { pagina: 1, tamanho: LIMITE } },
        operador,
      );
      expect(busca.status).toBe(HTTP_STATUS.BAD_REQUEST);
      const escrita = await chamar('PUT', `/crm/leads/${leadId}`, { valor: 1 }, operador);
      expect(escrita.status).toBe(HTTP_STATUS.FORBIDDEN);

      await ok(chamar('PUT', '/crm/configuracoes/permissoes', { OPERADOR: {} }));
    });

    it('nenhuma tabela do Kanban guarda dado pessoal do CRM', async () => {
      const nome = `Pessoa ${randomUUID()}`;
      const leadId = await novoLead({ nome });
      const [deal] = await oportunidades(leadId);
      await ok(mover(vendas.id, deal.id, 'proposta'));

      const colunas = await prisma.$queryRaw`
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'modulo_kanban_universal'
          AND data_type IN ('text', 'character varying', 'jsonb')
      `;
      for (const { table_name: tabela, column_name: coluna } of colunas) {
        const [{ total }] = await prisma.$queryRawUnsafe(
          `SELECT count(*)::int AS total FROM modulo_kanban_universal."${tabela}"
           WHERE tenant_id = $1::uuid AND "${coluna}"::text LIKE $2`,
          tenantId,
          `%${nome}%`,
        );
        expect(total, `${tabela}.${coluna}`).toBe(0);
      }
    });
  });

  describe('o card', () => {
    it('traz layout, selos e rota, sem expor nada a mais', async () => {
      const leadId = await novoLead({ nome: 'Ana Card', valor: OUTRO_VALOR });
      const [deal] = await oportunidades(leadId);
      await ok(mover(vendas.id, deal.id, 'proposta'));

      const { itens } = await cards(vendas.id, 'proposta');
      const card = itens.find((item) => item.entidadeId === deal.id);
      expect(card).toMatchObject({ titulo: 'Ana Card', leadId, responsavelId: donoId });
      expect(card.rotaFicha).toContain(deal.id);
      const valor = card.destaques.find((item) => item.chave === 'valor');
      expect(valor?.valor).toBe(OUTRO_VALOR);
      expect(card.destaques.find((item) => item.chave === 'status')?.valor).toBe('Proposta');
    });

    it('venda reaberta marca o card de atendimento', async () => {
      const leadId = await novoLead();
      const [venda] = await oportunidades(leadId);
      await ok(mover(vendas.id, venda.id, 'ganho'));
      await ok(mover(vendas.id, venda.id, 'novo'));

      const { itens } = await cards(atendimento.id, 'aguardando');
      const atendimentoDela = (await oportunidades(leadId)).find(
        (deal) => deal.pipelineId === atendimento.id,
      );
      const card = itens.find((item) => item.entidadeId === atendimentoDela.id);
      expect(card.selos.map((selo) => selo.tipo)).toContain('origem_reaberta');
    });

    it('paginação por cursor passa por todos, sem repetir', async () => {
      const coluna = 'em_contato';
      const ids = [];
      for (let criados = 0; criados < TRES; criados += 1) {
        const [deal] = await oportunidades(await novoLead({ status: coluna }));
        ids.push(deal.id);
      }
      const vistos = [];
      let cursor;
      do {
        const pagina = await cards(vendas.id, coluna, undefined, { limite: 1, cursor });
        vistos.push(...pagina.itens.map((item) => item.entidadeId));
        cursor = pagina.proximoCursor ?? undefined;
      } while (cursor);
      expect(new Set(vistos).size).toBe(vistos.length);
      expect(vistos).toEqual(expect.arrayContaining(ids));
    });

    it('arquivada e na lixeira saem do quadro e voltam ao restaurar', async () => {
      const leadId = await novoLead({ status: 'em_contato' });
      const [{ id }] = await oportunidades(leadId);
      const noQuadro = async () =>
        (await cards(vendas.id, 'em_contato')).itens.some((item) => item.entidadeId === id);

      expect(await noQuadro()).toBe(true);
      await ok(chamar('POST', `/crm/oportunidades/${id}/arquivar`));
      expect(await noQuadro()).toBe(false);
      await ok(chamar('POST', `/crm/oportunidades/${id}/desarquivar`));
      expect(await noQuadro()).toBe(true);

      await ok(chamar('POST', `/crm/oportunidades/${id}/excluir`));
      expect(await noQuadro()).toBe(false);
      const lixeira = await ok(
        chamar('GET', `/crm/leads/${leadId}/oportunidades?situacao=lixeira`),
      );
      expect(lixeira.map((deal) => deal.id)).toEqual([id]);
      await ok(chamar('POST', `/crm/oportunidades/${id}/restaurar`));
      expect(await noQuadro()).toBe(true);
    });

    it('card de pessoa arquivada sai do quadro', async () => {
      const leadId = await novoLead({ status: 'em_contato' });
      const [{ id }] = await oportunidades(leadId);
      await ok(chamar('POST', `/crm/leads/${leadId}/arquivar`));
      const { itens } = await cards(vendas.id, 'em_contato');
      expect(itens.map((item) => item.entidadeId)).not.toContain(id);
    });

    it('status desativado com cards continua como coluna', async () => {
      await novoLead({ status: 'qualificado' });
      const opcao = vendas.status.find((item) => item.key === 'qualificado');
      await ok(
        chamar('PUT', `/crm/configuracoes/pipelines/${vendas.id}/status/${opcao.id}`, {
          ativo: false,
        }),
      );
      const colunas = await ok(chamar('GET', `${quadro(vendas.id)}/colunas`));
      expect(colunas.find((coluna) => coluna.ref === 'qualificado')).toMatchObject({
        ativa: false,
      });
      await ok(
        chamar('PUT', `/crm/configuracoes/pipelines/${vendas.id}/status/${opcao.id}`, {
          ativo: true,
        }),
      );
    });
  });

  describe('mover e criar', () => {
    it('só move dentro do mesmo pipeline, mesmo com a mesma coluna nos dois', async () => {
      const outro = await ok(
        chamar('POST', '/crm/configuracoes/pipelines', { nome: 'Outro', tipo: 'sales' }),
        HTTP_STATUS.CREATED,
      );
      const leadId = await novoLead();
      const [deal] = await oportunidades(leadId);

      const resposta = await mover(outro.id, deal.id, 'ganho');

      expect(resposta.status).toBe(HTTP_STATUS.BAD_REQUEST);
      expect((await oportunidades(leadId))[0].status).toBe('novo');
      await ok(chamar('DELETE', `/crm/configuracoes/pipelines/${outro.id}`));
    });

    it('regra sobre campo comercial lê o dado da própria oportunidade', async () => {
      const campos = await ok(chamar('GET', '/crm/configuracoes/campos'));
      const exigir = async (chave, status) => {
        const campo = campos.find((item) => item.chave === chave);
        await ok(
          chamar('PUT', `/crm/configuracoes/campos/${campo.id}`, {
            visibilidade: { create_form: true, detail: true, table: true, filter: true },
          }),
        );
        return ok(
          chamar('POST', '/crm/configuracoes/regras', {
            kind: 'required_from_status',
            campoId: campo.id,
            condicao: { status: [status] },
          }),
          HTTP_STATUS.CREATED,
        );
      };
      const regras = [
        await exigir('dataPrevistaFechamento', 'proposta'),
        await exigir('dataConversao', 'ganho'),
      ];
      const leadId = await novoLead();
      const [deal] = await oportunidades(leadId);

      const semData = await mover(vendas.id, deal.id, 'proposta');
      expect(semData.status).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(semData.corpo.error.fields).toHaveProperty('dataPrevistaFechamento');

      await ok(
        chamar('PUT', `/crm/oportunidades/${deal.id}`, {
          dataPrevistaFechamento: '2027-01-15T00:00:00.000Z',
          expectedUpdatedAt: deal.atualizadaEm,
        }),
      );
      const comData = await mover(vendas.id, deal.id, 'proposta');
      expect(comData.status, JSON.stringify(comData.corpo)).toBe(HTTP_STATUS.OK);

      const criada = await chamar('POST', `${quadro(vendas.id)}/cards`, {
        colunaRef: 'proposta',
        dados: { leadId, dataPrevistaFechamento: '2027-01-15T00:00:00.000Z' },
      });
      expect(criada.status, JSON.stringify(criada.corpo)).toBe(HTTP_STATUS.CREATED);

      // Ganhar carimba a data: a regra sobre ela não pede nada a quem arrasta.
      const ganhou = await mover(vendas.id, deal.id, 'ganho');
      expect(ganhou.status, JSON.stringify(ganhou.corpo)).toBe(HTTP_STATUS.OK);
      const criadaGanha = await chamar('POST', `${quadro(vendas.id)}/cards`, {
        colunaRef: 'ganho',
        dados: { leadId },
      });
      expect(criadaGanha.status, JSON.stringify(criadaGanha.corpo)).toBe(HTTP_STATUS.CREATED);

      for (const regra of regras) {
        await ok(chamar('DELETE', `/crm/configuracoes/regras/${regra.id}`));
      }
    });

    it('quem tem Status em "só ver" não arrasta', async () => {
      const [deal] = await oportunidades(await novoLead());
      await ligarPermissao({ status: 'view' });

      const acoes = await ok(
        chamar('GET', `${quadro(vendas.id)}/cards/${deal.id}/acoes`, undefined, operador),
      );
      expect(acoes).toEqual([]);
      expect((await mover(vendas.id, deal.id, 'proposta', operador)).status).toBe(
        HTTP_STATUS.FORBIDDEN,
      );
      await ok(chamar('PUT', '/crm/configuracoes/permissoes', { OPERADOR: {} }));
    });

    it('criar com pessoa existente: uma oportunidade nova, naquela coluna', async () => {
      const leadId = await novoLead();
      const criado = await ok(
        chamar('POST', `${quadro(atendimento.id)}/cards`, {
          colunaRef: 'em_atendimento',
          dados: { leadId, titulo: 'Ajuste' },
        }),
        HTTP_STATUS.CREATED,
      );
      const lista = await oportunidades(leadId);
      expect(lista).toHaveLength(DUAS);
      expect(lista.find((deal) => deal.id === criado.entidadeId)).toMatchObject({
        pipelineId: atendimento.id,
        status: 'em_atendimento',
        titulo: 'Ajuste',
      });
    });

    it('criar com pessoa nova: nasce só naquele pipeline', async () => {
      const criado = await ok(
        chamar('POST', `${quadro(atendimento.id)}/cards`, {
          colunaRef: 'em_atendimento',
          dados: { nome: 'Direto no Atendimento', email: `${randomUUID()}@smoke.test` },
        }),
        HTTP_STATUS.CREATED,
      );
      const lista = await oportunidades(criado.leadId);
      expect(lista).toHaveLength(1);
      expect(lista[0]).toMatchObject({ pipelineId: atendimento.id, status: 'em_atendimento' });
      const [lead] = await prisma.$queryRaw`
        SELECT lifecycle_stage FROM modulo_crm.leads WHERE id = ${criado.leadId}::uuid
      `;
      expect(lead.lifecycle_stage).toBe('oportunidade');
    });

    it('criar em Perdido sem motivo vale a regra da coluna, e nada é criado', async () => {
      const email = `${randomUUID()}@smoke.test`;
      const resposta = await chamar('POST', `${quadro(vendas.id)}/cards`, {
        colunaRef: 'perdido',
        dados: { nome: 'Sem motivo', email },
      });
      expect(resposta.status).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(resposta.corpo.error.code).toBe(ERROR_CODES.CAMPOS_OBRIGATORIOS);
      const [{ total }] = await prisma.$queryRaw`
        SELECT count(*)::int AS total FROM modulo_crm.leads WHERE email = ${email}
      `;
      expect(total).toBe(0);
    });
  });

  describe('edição com versão no lead (P8)', () => {
    it('versão certa grava; antiga é 409 com o estado atual; sem versão, grava', async () => {
      const leadId = await novoLead();
      const lido = await ok(chamar('GET', `/crm/leads/${leadId}`));
      const versao = new Date(lido.updated_at).toISOString();

      await ok(chamar('PUT', `/crm/leads/${leadId}`, { nome: 'Um', expectedUpdatedAt: versao }));
      const velha = await chamar('PUT', `/crm/leads/${leadId}`, {
        nome: 'Dois',
        expectedUpdatedAt: versao,
      });
      expect(velha.status).toBe(HTTP_STATUS.CONFLICT);
      expect(velha.corpo.error.details.atual).toMatchObject({ nome: 'Um' });
      await ok(chamar('PUT', `/crm/leads/${leadId}`, { nome: 'Três' }));
    });
  });

  describe('visibilidade por pipeline (D4)', () => {
    it('pipeline oculto some do quadro e das configurações', async () => {
      await ocultar(atendimento.id, true);
      const boards = await ok(chamar('GET', '/kanban/boards', undefined, operador));
      expect(boards.map((item) => item.quadroRef)).not.toContain(atendimento.id);
      const pipelines = await ok(
        chamar('GET', '/crm/configuracoes/pipelines', undefined, operador),
      );
      expect(pipelines.map((item) => item.id)).not.toContain(atendimento.id);
      expect(
        (await chamar('GET', `${quadro(atendimento.id)}/colunas`, undefined, operador)).status,
      ).toBe(HTTP_STATUS.NOT_FOUND);
      await ocultar(atendimento.id, false);
    });

    it('pessoa só com oportunidade oculta dá 404 em toda rota por id', async () => {
      const marca = randomUUID();
      const leadId = await novoLead({ nome: `Oculta ${marca}`, valor: VALOR });
      const [deal] = await oportunidades(leadId);
      await ocultar(vendas.id, true);

      for (const url of [
        `/crm/leads/${leadId}`,
        `/crm/leads/${leadId}/oportunidades`,
        `/crm/leads/${leadId}/historico`,
      ]) {
        expect((await chamar('GET', url, undefined, operador)).status, url).toBe(
          HTTP_STATUS.NOT_FOUND,
        );
      }
      const mudar = await chamar(
        'PATCH',
        `/crm/oportunidades/${deal.id}/status`,
        { status: 'proposta' },
        operador,
      );
      expect(mudar.status).toBe(HTTP_STATUS.NOT_FOUND);

      const busca = await ok(
        chamar(
          'POST',
          '/crm/leads/search',
          { busca: marca, paginacao: { pagina: 1, tamanho: LIMITE } },
          operador,
        ),
      );
      expect(busca).toMatchObject({ itens: [], total: 0 });
      const massa = await ok(
        chamar(
          'PATCH',
          '/crm/leads/bulk',
          { ids: [leadId], alteracoes: { fonteLead: 'indicacao' } },
          operador,
        ),
      );
      expect(massa.falhas).toBe(1);

      const doDono = await ok(chamar('GET', `/crm/leads/${leadId}`));
      expect(Number(doDono.valor)).toBe(VALOR);
      await ocultar(vendas.id, false);
    });

    it('com outra visível: a pessoa aparece, sem o comercial da principal oculta', async () => {
      const marca = randomUUID();
      const leadId = await novoLead({ nome: `Mista ${marca}`, valor: VALOR, status: 'proposta' });
      await ok(
        chamar('POST', `/crm/leads/${leadId}/oportunidades`, { pipelineId: atendimento.id }),
        HTTP_STATUS.CREATED,
      );
      // Um evento de cada caminho, para o filtro do histórico ter o que esconder.
      const venda = (await oportunidades(leadId)).find((deal) => deal.pipelineId === vendas.id);
      await ok(
        chamar('PUT', `/crm/oportunidades/${venda.id}`, {
          valor: TERCEIRO_VALOR,
          expectedUpdatedAt: venda.atualizadaEm,
        }),
      );
      await ok(chamar('PUT', `/crm/leads/${leadId}`, { valor: OUTRO_VALOR }));
      await ocultar(vendas.id, true);

      const lead = await ok(chamar('GET', `/crm/leads/${leadId}`, undefined, operador));
      expect(lead).toMatchObject({ status: null, valor: null });
      const lista = await oportunidades(leadId, operador);
      expect(lista.map((deal) => deal.pipelineId)).toEqual([atendimento.id]);

      const porStatus = await ok(
        chamar(
          'POST',
          '/crm/leads/search',
          {
            busca: marca,
            filtros: [{ chave: 'status', operador: 'igual', valor: 'proposta' }],
            paginacao: { pagina: 1, tamanho: LIMITE },
          },
          operador,
        ),
      );
      expect(porStatus.total).toBe(0);

      const historico = await ok(
        chamar('GET', `/crm/leads/${leadId}/historico`, undefined, operador),
      );
      const doDono = await ok(chamar('GET', `/crm/leads/${leadId}/historico`));
      expect(
        doDono.itens.filter((evento) => evento.detalhes?.pipelineId === vendas.id),
      ).toHaveLength(DUAS);
      expect(historico.itens.map((evento) => evento.detalhes?.pipelineId)).not.toContain(vendas.id);
      expect(
        historico.itens.flatMap((evento) => evento.diff ?? []).map((d) => d.chave),
      ).not.toContain('valor');

      const editarComercial = await chamar('PUT', `/crm/leads/${leadId}`, { valor: 1 }, operador);
      expect(editarComercial.status).toBe(HTTP_STATUS.CONFLICT);
      const editarContato = await chamar(
        'PUT',
        `/crm/leads/${leadId}`,
        { nome: `Editada ${marca}` },
        operador,
      );
      expect(editarContato.status, JSON.stringify(editarContato.corpo)).toBe(HTTP_STATUS.OK);
      expect(editarContato.dados).toMatchObject({ status: null, valor: null });

      await ocultar(vendas.id, false);
    });

    it('pipeline oculto não recebe oportunidade do OPERADOR', async () => {
      const leadId = await novoLead();
      await ocultar(atendimento.id, true);
      const resposta = await chamar(
        'POST',
        `/crm/leads/${leadId}/oportunidades`,
        { pipelineId: atendimento.id },
        operador,
      );
      expect(resposta.status).toBe(HTTP_STATUS.BAD_REQUEST);
      await ocultar(atendimento.id, false);
    });

    it('card de pessoa existente respeita o quadro, e referência fica restrita', async () => {
      const leadId = await novoLead();
      const [deal] = await oportunidades(leadId);
      await ocultar(vendas.id, true);
      const acoes = await chamar(
        'GET',
        `${quadro(vendas.id)}/cards/${deal.id}/acoes`,
        undefined,
        operador,
      );
      expect(acoes.dados ?? []).toEqual([]);
      await ocultar(vendas.id, false);
    });
  });

  it('sem a flag crm.quadro_comercial, o quadro não existe', async () => {
    await prisma.tenantModuleFeature.deleteMany({
      where: { tenantId, featureKey: CRM_FEATURES.QUADRO_COMERCIAL },
    });
    await invalidarFeatures(tenantId);

    const boards = await ok(chamar('GET', '/kanban/boards'));
    expect(boards.filter((item) => item.modo === 'entidade')).toEqual([]);
    expect((await chamar('GET', `${quadro(vendas.id)}/colunas`)).status).toBe(
      HTTP_STATUS.NOT_FOUND,
    );
  });
});
