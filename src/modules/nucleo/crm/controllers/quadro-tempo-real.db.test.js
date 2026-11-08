import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { io } from 'socket.io-client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '#api/app.js';
import { encerrarCache } from '#core/cache/cache.js';
import { getAdminClient } from '#core/db/tenantClient.js';
import { invalidarFeatures } from '#core/tenant/feature-flags.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { DESPACHO_DE_EVENTOS, CRM_FEATURES, MODULO_CRM } from '../constants.js';
import { reconciliarTenant } from '../services/reconcile.service.js';

/**
 * M5: o tempo real pelo caminho inteiro, com socket de verdade: gravação,
 * outbox, despacho e aviso em outra conexão. GRAVA no banco de `DATABASE_URL`
 * (tenant SMOKE, apagado no fim): só roda com `CRM_DB_TESTS=1`.
 */
const rodar =
  process.env.CRM_DB_TESTS === '1' && process.env.DATABASE_URL ? describe : describe.skip;

const TIMEOUT_MS = 120_000;
const ESPERA_DO_EVENTO_MS = 15_000;
const SILENCIO_MS = 3_000;
const INTERVALO_DE_ESPERA_MS = 50;
const VALOR = 1500;
const SEGUNDOS_POR_MINUTO = 60;
const TAMANHO_SUFIXO = 8;
const BOARD = 'crm_oportunidades';
const FLAG_KANBAN = 'kanban_universal.quadros_entidade';
const CHAVES_DO_EVENTO = ['boardType', 'entidadeIds', 'id', 'quadroRef'];

rodar('quadro em tempo real (CRM_DB_TESTS=1)', { timeout: TIMEOUT_MS }, () => {
  const prisma = getAdminClient();
  const tenantId = randomUUID();
  const donoId = randomUUID();
  const operadorId = randomUUID();
  const operador = { papel: 'OPERADOR', userId: operadorId };
  let app;
  let url;
  let vendas;
  let atendimento;
  let socket;
  let recebidos;

  const tokenDe = ({ papel = 'DONO', userId = donoId } = {}) =>
    app.jwt.access.sign({ tenantId, userId, role: papel });

  async function chamar(method, caminho, payload, usuario) {
    const resposta = await app.inject({
      method,
      url: caminho,
      payload,
      headers: { authorization: `Bearer ${tokenDe(usuario)}` },
    });
    const corpo = resposta.body ? JSON.parse(resposta.body) : null;
    return { status: resposta.statusCode, corpo, dados: corpo?.data };
  }
  const ok = async (promessa, status = HTTP_STATUS.OK) => {
    const resposta = await promessa;
    expect(resposta.status, JSON.stringify(resposta.corpo)).toBe(status);
    return resposta.dados;
  };
  const conectar = (usuario) =>
    new Promise((resolve, reject) => {
      const cliente = io(`${url}/kanban`, {
        transports: ['websocket'],
        auth: { accessToken: tokenDe(usuario) },
        reconnection: false,
      });
      cliente.once('connect', () => resolve(cliente));
      cliente.once('connect_error', reject);
    });
  const assistir = (cliente, quadroRef) =>
    cliente.emitWithAck('quadro:watch', { boardType: BOARD, quadroRef });

  const novoLead = async (campos = {}) => {
    const { id } = await ok(
      chamar('POST', '/crm/leads', {
        nome: 'Pessoa',
        email: `${randomUUID()}@smoke.test`,
        ...campos,
      }),
      HTTP_STATUS.CREATED,
    );
    const lista = await ok(chamar('GET', `/crm/leads/${id}/oportunidades`));
    return { leadId: id, deal: lista[0], lista };
  };

  /** Espera um aviso que aponte este card, nesta sala. */
  const esperarCard = async (entidadeId, quadroRef = vendas.id) => {
    const limite = Date.now() + ESPERA_DO_EVENTO_MS;
    while (Date.now() < limite) {
      const achado = recebidos.find(
        (evento) => evento.quadroRef === quadroRef && evento.entidadeIds.includes(entidadeId),
      );
      if (achado) return achado;
      await setTimeout(INTERVALO_DE_ESPERA_MS);
    }
    throw new Error(`Nenhum aviso do card ${entidadeId}`);
  };

  beforeAll(async () => {
    await prisma.tenant.create({
      data: {
        id: tenantId,
        nome: 'SMOKE tempo real',
        subdomain: `smoke-tr-${tenantId.slice(0, TAMANHO_SUFIXO)}`,
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
        { moduleKey: MODULO_CRM, featureKey: CRM_FEATURES.ARQUIVO },
        { moduleKey: MODULO_CRM, featureKey: CRM_FEATURES.MASSA },
        { moduleKey: MODULO_CRM, featureKey: CRM_FEATURES.DUPLICIDADE },
        { moduleKey: MODULO_CRM, featureKey: CRM_FEATURES.LGPD },
        { moduleKey: 'kanban_universal', featureKey: FLAG_KANBAN },
      ].map((linha) => ({ tenantId, ...linha })),
    });
    await invalidarFeatures(tenantId);
    await reconciliarTenant(tenantId);
    app = await buildApp({
      config: {
        APP_NAME: 'crm-tempo-real',
        NODE_ENV: 'test',
        CORS_ORIGIN: '*',
        JWT_SECRET: 'local-test-secret-access-only',
        JWT_REFRESH_SECRET: 'local-test-secret-refresh-only',
      },
    });
    url = await app.listen({ port: 0, host: '127.0.0.1' });
    [vendas, atendimento] = await ok(chamar('GET', '/crm/configuracoes/pipelines'));
    socket = await conectar();
    socket.on('quadro:changed', (evento) => recebidos.push(evento));
    await assistir(socket, vendas.id);
    await assistir(socket, atendimento.id);
  });

  beforeEach(() => {
    recebidos = [];
  });

  afterAll(async () => {
    socket?.disconnect();
    await prisma.$executeRaw`DELETE FROM modulo_crm.leads WHERE tenant_id = ${tenantId}::uuid`;
    await prisma.$executeRaw`DELETE FROM modulo_crm.crm_event WHERE tenant_id = ${tenantId}::uuid`;
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await app?.close();
    await encerrarCache();
  });

  describe('aceite do M5', () => {
    it('editar a oportunidade na ficha avisa outra conexão, e o card relido vem certo', async () => {
      const { deal } = await novoLead();
      await esperarCard(deal.id);
      recebidos = [];

      await ok(
        chamar('PUT', `/crm/oportunidades/${deal.id}`, {
          titulo: 'Reforma',
          expectedUpdatedAt: deal.atualizadaEm,
        }),
      );
      await esperarCard(deal.id);

      const relido = await ok(
        chamar('POST', `/kanban/quadros/${BOARD}/${vendas.id}/cards/por-ids`, { ids: [deal.id] }),
      );
      expect(relido.itens[0]).toMatchObject({
        entidadeId: deal.id,
        colunaRef: 'novo',
        tituloOportunidade: 'Reforma',
      });
      expect(relido.ausentes).toEqual([]);
    });

    it('o evento só leva ids', async () => {
      const nome = `Sigilo ${randomUUID()}`;
      const { deal } = await novoLead({ nome, valor: VALOR });

      const evento = await esperarCard(deal.id);

      expect(Object.keys(evento).sort()).toEqual(CHAVES_DO_EVENTO);
      expect(JSON.stringify(evento)).not.toContain(nome);
      expect(JSON.stringify(evento)).not.toContain('smoke.test');
    });

    it('quem não vê o pipeline não entra na sala, e não relê mesmo se já estava nela', async () => {
      const { deal } = await novoLead();
      const cliente = await conectar(operador);
      const avisos = [];
      cliente.on('quadro:changed', (evento) => avisos.push(evento));
      expect(await assistir(cliente, vendas.id)).toEqual({ ok: true });

      await ok(
        chamar('PUT', `/crm/configuracoes/pipelines/${vendas.id}`, { visivelOperador: false }),
      );

      expect((await assistir(cliente, vendas.id)).ok).toBe(false);
      const relido = await chamar(
        'POST',
        `/kanban/quadros/${BOARD}/${vendas.id}/cards/por-ids`,
        { ids: [deal.id] },
        operador,
      );
      expect(relido.status).toBe(HTTP_STATUS.NOT_FOUND);

      await ok(
        chamar('PUT', `/crm/configuracoes/pipelines/${vendas.id}`, { visivelOperador: true }),
      );
      cliente.disconnect();
    });
  });

  describe('cobertura: toda origem de mudança chega ao quadro', () => {
    it('contato editado pelo lead avisa todos os cards da pessoa', async () => {
      const { leadId, deal } = await novoLead();
      const extra = await ok(
        chamar('POST', `/crm/leads/${leadId}/oportunidades`, { pipelineId: atendimento.id }),
        HTTP_STATUS.CREATED,
      );
      await esperarCard(extra.id, atendimento.id);
      recebidos = [];

      await ok(chamar('PUT', `/crm/leads/${leadId}`, { nome: 'Outro nome' }));

      await esperarCard(deal.id);
      await esperarCard(extra.id, atendimento.id);
    });

    it('edição em massa', async () => {
      const { leadId, deal } = await novoLead();
      await esperarCard(deal.id);
      recebidos = [];

      await ok(
        chamar('PATCH', '/crm/leads/bulk', {
          ids: [leadId],
          alteracoes: { fonteLead: 'indicacao' },
        }),
      );

      await esperarCard(deal.id);
    });

    it('venda ganha: o card novo aparece no quadro de atendimento', async () => {
      await ok(
        chamar('PUT', `/crm/configuracoes/pipelines/${atendimento.id}`, {
          automacao: { ativa: true, origemId: vendas.id },
        }),
      );
      const { leadId, deal } = await novoLead();

      await ok(chamar('PATCH', `/crm/oportunidades/${deal.id}/status`, { status: 'ganho' }));

      const lista = await ok(chamar('GET', `/crm/leads/${leadId}/oportunidades`));
      const criado = lista.find((item) => item.pipelineId === atendimento.id);
      await esperarCard(deal.id);
      await esperarCard(criado.id, atendimento.id);
    });

    it('arquivar a pessoa: avisa, e o card relido vem em ausentes', async () => {
      const { leadId, deal } = await novoLead();
      await esperarCard(deal.id);
      recebidos = [];

      await ok(chamar('POST', `/crm/leads/${leadId}/arquivar`));

      await esperarCard(deal.id);
      const relido = await ok(
        chamar('POST', `/kanban/quadros/${BOARD}/${vendas.id}/cards/por-ids`, { ids: [deal.id] }),
      );
      expect(relido).toEqual({ itens: [], ausentes: [deal.id] });
    });

    it('arquivar e excluir a oportunidade: avisa, e o card relido vem em ausentes', async () => {
      const { deal } = await novoLead();
      const reler = () =>
        ok(
          chamar('POST', `/kanban/quadros/${BOARD}/${vendas.id}/cards/por-ids`, { ids: [deal.id] }),
        );
      await esperarCard(deal.id);
      recebidos = [];
      await ok(chamar('POST', `/crm/oportunidades/${deal.id}/arquivar`));
      await esperarCard(deal.id);
      expect(await reler()).toEqual({ itens: [], ausentes: [deal.id] });

      recebidos = [];
      await ok(chamar('POST', `/crm/oportunidades/${deal.id}/desarquivar`));
      await esperarCard(deal.id);
      expect((await reler()).ausentes).toEqual([]);

      recebidos = [];
      await ok(chamar('POST', `/crm/oportunidades/${deal.id}/excluir`));
      await esperarCard(deal.id);
      expect(await reler()).toEqual({ itens: [], ausentes: [deal.id] });
    });

    it('mesclar pessoas', async () => {
      const principal = await novoLead();
      const secundario = await novoLead();
      await esperarCard(secundario.deal.id);
      recebidos = [];

      await ok(
        chamar('POST', '/crm/leads/merge', {
          principalId: principal.leadId,
          secundarioId: secundario.leadId,
        }),
      );

      await esperarCard(principal.deal.id);
      await esperarCard(secundario.deal.id);
    });

    it('anonimizar a pessoa', async () => {
      const { leadId, deal } = await novoLead();
      await esperarCard(deal.id);
      recebidos = [];

      await ok(chamar('POST', `/crm/leads/${leadId}/anonimizar`, { confirmacao: 'ANONIMIZAR' }));

      await esperarCard(deal.id);
    });

    it('gravação fora deste processo também chega: a fonte é o banco', async () => {
      const { deal } = await novoLead();
      await esperarCard(deal.id);
      recebidos = [];

      await prisma.$executeRaw`
        INSERT INTO modulo_crm.crm_event (tenant_id, tipo, entidade, entidade_id, payload)
        VALUES (
          ${tenantId}::uuid, 'deal.updated', 'deal', ${deal.id}::uuid,
          ${JSON.stringify({ pipelineId: vendas.id })}::jsonb
        )
      `;

      await esperarCard(deal.id);
    });
  });

  const comRedis = process.env.KANBAN_TEST_REDIS_URL ? it : it.skip;

  comRedis('duas instâncias: o aviso chega à conexão da outra, pelo Redis', async () => {
    const config = {
      APP_NAME: 'crm-tempo-real-2',
      NODE_ENV: 'test',
      CORS_ORIGIN: '*',
      JWT_SECRET: 'local-test-secret-access-only',
      JWT_REFRESH_SECRET: 'local-test-secret-refresh-only',
      REDIS_URL: process.env.KANBAN_TEST_REDIS_URL,
      SOCKET_REDIS_PREFIX: `crm-test:${randomUUID()}`,
    };
    // Sem isso, a instância do teste, que não fala com o Redis, drenaria o evento.
    socket.disconnect();
    const primeira = await buildApp({ config });
    const segunda = await buildApp({ config });
    const conectarEm = async (instancia) => {
      const endereco = await instancia.listen({ port: 0, host: '127.0.0.1' });
      const cliente = io(`${endereco}/kanban`, {
        transports: ['websocket'],
        auth: { accessToken: tokenDe() },
        reconnection: false,
      });
      await new Promise((resolve, reject) => {
        cliente.once('connect', resolve);
        cliente.once('connect_error', reject);
      });
      await assistir(cliente, vendas.id);
      return cliente;
    };
    const clientes = [await conectarEm(primeira), await conectarEm(segunda)];
    try {
      const avisos = clientes.map((cliente) => {
        const lista = [];
        cliente.on('quadro:changed', (evento) => lista.push(...evento.entidadeIds));
        return lista;
      });

      const { deal } = await novoLead();

      const limite = Date.now() + ESPERA_DO_EVENTO_MS;
      while (Date.now() < limite && !avisos.every((lista) => lista.includes(deal.id))) {
        await setTimeout(INTERVALO_DE_ESPERA_MS);
      }
      expect(avisos.map((lista) => lista.includes(deal.id))).toEqual([true, true]);
    } finally {
      clientes.forEach((cliente) => cliente.disconnect());
      await primeira.close();
      await segunda.close();
      socket = await conectar();
      socket.on('quadro:changed', (evento) => recebidos.push(evento));
      await assistir(socket, vendas.id);
      await assistir(socket, atendimento.id);
    }
  });

  describe('despacho', () => {
    const gravarEvento = (entidadeId, minutosAtras) => prisma.$queryRaw`
      INSERT INTO modulo_crm.crm_event (tenant_id, tipo, entidade, entidade_id, payload, occurred_at)
      VALUES (
        ${tenantId}::uuid, 'deal.updated', 'deal', ${entidadeId}::uuid,
        ${JSON.stringify({ pipelineId: vendas.id })}::jsonb,
        CURRENT_TIMESTAMP - make_interval(mins => ${minutosAtras}::int)
      )
      RETURNING id::text
    `;
    const situacao = async (id) => {
      const [linha] = await prisma.$queryRaw`
        SELECT processed_at, attempts FROM modulo_crm.crm_event WHERE id = ${id}::uuid
      `;
      return linha;
    };

    it('evento vencido é confirmado sem emitir', async () => {
      const entidadeId = randomUUID();
      const minutos = Math.ceil(DESPACHO_DE_EVENTOS.VALIDADE_SEGUNDOS / SEGUNDOS_POR_MINUTO) + 1;
      const [{ id }] = await gravarEvento(entidadeId, minutos);

      await setTimeout(SILENCIO_MS);

      expect((await situacao(id)).processed_at).not.toBeNull();
      expect(recebidos.flatMap((evento) => evento.entidadeIds)).not.toContain(entidadeId);
    });

    it('evento de outra entidade (formulário) é confirmado sem aviso', async () => {
      const entidadeId = randomUUID();
      const [{ id }] = await prisma.$queryRaw`
        INSERT INTO modulo_crm.crm_event (tenant_id, tipo, entidade, entidade_id, payload)
        VALUES (${tenantId}::uuid, 'form.link_created', 'form_link', ${entidadeId}::uuid, '{}'::jsonb)
        RETURNING id::text
      `;

      await setTimeout(SILENCIO_MS);

      expect((await situacao(id)).processed_at).not.toBeNull();
      expect(recebidos.some((evento) => !evento.quadroRef)).toBe(false);
      expect(recebidos.flatMap((evento) => evento.entidadeIds)).not.toContain(entidadeId);
    });

    it('evento confirmado sai da fila e é emitido uma vez só', async () => {
      const { deal } = await novoLead();
      await esperarCard(deal.id);
      recebidos = [];
      const [{ id }] = await gravarEvento(deal.id, 0);

      await esperarCard(deal.id);
      await setTimeout(SILENCIO_MS);

      expect(await situacao(id)).toMatchObject({ attempts: 1 });
      expect((await situacao(id)).processed_at).not.toBeNull();
      expect(recebidos.filter((evento) => evento.entidadeIds.includes(deal.id))).toHaveLength(1);
    });

    it('evento com as tentativas esgotadas não é emitido nem trava a fila', async () => {
      const [{ id }] = await prisma.$queryRaw`
        INSERT INTO modulo_crm.crm_event (tenant_id, tipo, entidade, entidade_id, payload, attempts)
        VALUES (
          ${tenantId}::uuid, 'deal.updated', 'deal', ${randomUUID()}::uuid, '{}'::jsonb,
          ${DESPACHO_DE_EVENTOS.MAX_TENTATIVAS}
        )
        RETURNING id::text
      `;

      await setTimeout(SILENCIO_MS);

      expect(await situacao(id)).toMatchObject({
        attempts: DESPACHO_DE_EVENTOS.MAX_TENTATIVAS,
        processed_at: null,
      });
    });
  });

  it('sem a flag de quadros, ninguém entra na sala', async () => {
    const cliente = await conectar();
    await prisma.tenantModuleFeature.deleteMany({ where: { tenantId, featureKey: FLAG_KANBAN } });
    await invalidarFeatures(tenantId);

    expect((await assistir(cliente, vendas.id)).ok).toBe(false);

    await prisma.tenantModuleFeature.create({
      data: { tenantId, moduleKey: 'kanban_universal', featureKey: FLAG_KANBAN },
    });
    await invalidarFeatures(tenantId);
    cliente.disconnect();
  });

  it('a releitura respeita o filtro da tela', async () => {
    const marca = randomUUID();
    const { deal } = await novoLead({ nome: `Filtro ${marca}` });
    const base = `/kanban/quadros/${BOARD}/${vendas.id}/cards/por-ids`;

    const dentro = await ok(chamar('POST', base, { ids: [deal.id], filtros: { busca: marca } }));
    expect(dentro.ausentes).toEqual([]);

    const fora = await ok(chamar('POST', base, { ids: [deal.id], filtros: { busca: 'outra' } }));
    expect(fora).toEqual({ itens: [], ausentes: [deal.id] });
  });

  it('card de outro quadro e id inválido', async () => {
    const { deal } = await novoLead();
    const base = `/kanban/quadros/${BOARD}/${atendimento.id}/cards/por-ids`;

    const deOutro = await ok(chamar('POST', base, { ids: [deal.id] }));
    expect(deOutro).toEqual({ itens: [], ausentes: [deal.id] });

    const invalido = await chamar('POST', base, { ids: ['nao-e-uuid'] });
    expect(invalido.status).toBe(HTTP_STATUS.BAD_REQUEST);
  });
});
