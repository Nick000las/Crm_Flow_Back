import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '#api/app.js';
import { encerrarCache } from '#core/cache/cache.js';
import { getAdminClient } from '#core/db/tenantClient.js';
import { invalidarFeatures } from '#core/tenant/feature-flags.js';
import { HTTP_STATUS } from '#shared/constants/index.js';

import { CRM_FEATURES, LIMITES_OPORTUNIDADE, MODULO_CRM, PIPELINES } from '../constants.js';
import {
  atualizarConfiguracaoCampo,
  listarConfiguracaoCampos,
} from '../services/configuracoes-campos.service.js';
import { reconciliarTenant } from '../services/reconcile.service.js';

/**
 * M2.5, F6: as rotas de pipelines e oportunidades, como o front as usa, e os
 * aceites do marco. GRAVA no banco de `DATABASE_URL` (tenant SMOKE, apagado no
 * fim): só roda com `CRM_DB_TESTS=1`, num banco de dev.
 */
const rodar =
  process.env.CRM_DB_TESTS === '1' && process.env.DATABASE_URL ? describe : describe.skip;

const TIMEOUT_MS = 120_000;
const TAMANHO_SUFIXO = 8;
const VALOR = 1500;
const VALOR_NEGATIVO = -1;
const PROBABILIDADE = 40;
const TITULO_LONGO = 'x'.repeat(LIMITES_OPORTUNIDADE.TITULO + 1);
const ACIMA_DO_LIMITE = LIMITES_OPORTUNIDADE.PROBABILIDADE_MAXIMA + 1;
const DUAS = 2;

rodar('API de pipelines e oportunidades (CRM_DB_TESTS=1)', { timeout: TIMEOUT_MS }, () => {
  const prisma = getAdminClient();
  const tenantId = randomUUID();
  const donoId = randomUUID();
  const operadorId = randomUUID();
  let app;
  let vendas;
  let atendimento;

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

  const operador = { papel: 'OPERADOR', userId: operadorId };
  const ok = async (promessa, status = HTTP_STATUS.OK) => {
    const resposta = await promessa;

    expect(resposta.status, JSON.stringify(resposta.corpo)).toBe(status);

    return resposta.dados;
  };

  const novoLead = async () =>
    (
      await ok(
        chamar('POST', '/crm/leads', { nome: 'Pessoa', email: `${randomUUID()}@smoke.test` }),
        HTTP_STATUS.CREATED,
      )
    ).id;
  const oportunidades = (leadId, opcoes) =>
    ok(chamar('GET', `/crm/leads/${leadId}/oportunidades`, undefined, opcoes));
  const pipelines = () => ok(chamar('GET', '/crm/configuracoes/pipelines'));
  const ligarCampos = async (chaves) => {
    const campos = await listarConfiguracaoCampos(tenantId);

    for (const chave of chaves) {
      await atualizarConfiguracaoCampo(tenantId, campos.find((c) => c.chave === chave).id, {
        visibilidade: { create_form: true, detail: true, table: true, filter: true },
      });
    }
  };

  beforeAll(async () => {
    await prisma.tenant.create({
      data: {
        id: tenantId,
        nome: 'SMOKE api oportunidades',
        subdomain: `smoke-apiop-${tenantId.slice(0, TAMANHO_SUFIXO)}`,
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

    await prisma.tenantModule.create({ data: { tenantId, moduleKey: MODULO_CRM } });

    await prisma.tenantModuleFeature.createMany({
      data: [CRM_FEATURES.PERMISSOES, CRM_FEATURES.LISTAS].map((featureKey) => ({
        tenantId,
        moduleKey: MODULO_CRM,
        featureKey,
      })),
    });

    await invalidarFeatures(tenantId);
    await reconciliarTenant(tenantId);
    await ligarCampos(['motivoPerda', 'probabilidadeFechamento', 'dataPrevistaFechamento']);

    app = await buildApp({
      config: {
        APP_NAME: 'crm-oportunidades',
        NODE_ENV: 'test',
        CORS_ORIGIN: '*',
        JWT_SECRET: 'local-test-secret-access-only',
        JWT_REFRESH_SECRET: 'local-test-secret-refresh-only',
      },
    });

    [vendas, atendimento] = await pipelines();
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM modulo_crm.leads WHERE tenant_id = ${tenantId}::uuid`;
    await prisma.$executeRaw`DELETE FROM modulo_crm.crm_event WHERE tenant_id = ${tenantId}::uuid`;
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await app?.close();
    await encerrarCache();
  });

  describe('aceite do M2.5', () => {
    it('uma pessoa com duas oportunidades em pipelines diferentes, cada uma com seu status', async () => {
      const leadId = await novoLead();

      await ok(
        chamar('POST', `/crm/leads/${leadId}/oportunidades`, {
          pipelineId: atendimento.id,
          status: 'em_atendimento',
        }),
        HTTP_STATUS.CREATED,
      );

      const lista = await oportunidades(leadId);

      expect(lista.map((deal) => [deal.pipelineId, deal.status]).sort()).toEqual(
        [
          [vendas.id, 'novo'],
          [atendimento.id, 'em_atendimento'],
        ].sort(),
      );
    });

    it('venda ganha cria o atendimento com a automação ligada; repetir não duplica', async () => {
      const leadId = await novoLead();
      const [venda] = await oportunidades(leadId);
      const ganhar = () =>
        ok(chamar('PATCH', `/crm/oportunidades/${venda.id}/status`, { status: 'ganho' }));

      await ganhar();
      await ok(chamar('PATCH', `/crm/oportunidades/${venda.id}/status`, { status: 'novo' }));
      await ganhar();

      const lista = await oportunidades(leadId);

      expect(lista.filter((deal) => deal.pipelineId === atendimento.id)).toHaveLength(1);
    });

    it('com a automação desligada, a venda ganha não cria atendimento', async () => {
      await ok(
        chamar('PUT', `/crm/configuracoes/pipelines/${atendimento.id}`, {
          automacao: { ativa: false },
        }),
      );

      const leadId = await novoLead();
      const [venda] = await oportunidades(leadId);

      await ok(chamar('PATCH', `/crm/oportunidades/${venda.id}/status`, { status: 'ganho' }));

      expect(await oportunidades(leadId)).toHaveLength(1);

      await ok(
        chamar('PUT', `/crm/configuracoes/pipelines/${atendimento.id}`, {
          automacao: { ativa: true },
        }),
      );
    });

    it('tenant com 5 pipelines não cria o sexto, e o que sobra pode ser excluído', async () => {
      const criados = [];

      for (let total = DUAS; total < PIPELINES.LIMITE_POR_TENANT; total += 1) {
        const criado = await ok(
          chamar('POST', '/crm/configuracoes/pipelines', { nome: `Extra ${total}`, tipo: 'sales' }),
          HTTP_STATUS.CREATED,
        );

        criados.push(criado);
      }

      const sexto = await chamar('POST', '/crm/configuracoes/pipelines', {
        nome: 'Sexto',
        tipo: 'sales',
      });

      expect(sexto.status).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(sexto.corpo.error.fields).toHaveProperty('pipeline');

      for (const { id } of criados) {
        await ok(chamar('DELETE', `/crm/configuracoes/pipelines/${id}`));
      }

      expect(await pipelines()).toHaveLength(DUAS);
    });
  });

  describe('configuração de pipelines', () => {
    const criar = (tipo, nome = 'Recompra') =>
      ok(chamar('POST', '/crm/configuracoes/pipelines', { nome, tipo }), HTTP_STATUS.CREATED);
    const excluir = (id) => chamar('DELETE', `/crm/configuracoes/pipelines/${id}`);

    it('operador lê, mas não escreve', async () => {
      await ok(chamar('GET', '/crm/configuracoes/pipelines', undefined, operador));

      const escritas = await Promise.all([
        chamar('POST', '/crm/configuracoes/pipelines', { nome: 'X', tipo: 'sales' }, operador),
        chamar('PUT', `/crm/configuracoes/pipelines/${vendas.id}`, { nome: 'X' }, operador),
        chamar('DELETE', `/crm/configuracoes/pipelines/${atendimento.id}`, undefined, operador),
        chamar(
          'POST',
          `/crm/configuracoes/pipelines/${vendas.id}/status`,
          { label: 'X', category: 'aberto' },
          operador,
        ),
      ]);

      for (const { status } of escritas) {
        expect(status).toBe(HTTP_STATUS.FORBIDDEN);
      }
    });

    it('a lista traz status, usos, oportunidades e automação', async () => {
      await novoLead();

      const [padrao, service] = await pipelines();

      expect(padrao).toMatchObject({ padrao: true, tipo: 'sales' });
      expect(padrao.oportunidades).toBeGreaterThan(0);
      expect(padrao.status.find((opcao) => opcao.key === 'novo').usos).toBeGreaterThan(0);

      expect(service.automacao).toMatchObject({
        ativa: true,
        origemId: vendas.id,
        statusInicial: 'aguardando',
        regraDoDono: 'person_owner',
      });
    });

    it('pipeline novo nasce com uma lista que funciona', async () => {
      const novo = await criar('sales');
      const leadId = await novoLead();
      const deal = await ok(
        chamar('POST', `/crm/leads/${leadId}/oportunidades`, { pipelineId: novo.id }),
        HTTP_STATUS.CREATED,
      );

      expect(deal.status).toBe('novo');

      const com = await excluir(novo.id);

      expect(com.status).toBe(HTTP_STATUS.CONFLICT);
    });

    it('não exclui o padrão, nem a origem de uma automação', async () => {
      expect((await excluir(vendas.id)).status).toBe(HTTP_STATUS.CONFLICT);

      const origem = await criar('sales', 'Origem');
      const destino = await criar('service', 'Destino');

      await ok(
        chamar('PUT', `/crm/configuracoes/pipelines/${destino.id}`, {
          automacao: { ativa: true, origemId: origem.id, statusInicial: 'aguardando' },
        }),
      );

      expect((await excluir(origem.id)).status).toBe(HTTP_STATUS.CONFLICT);

      await ok(excluir(destino.id));
      await ok(excluir(origem.id));
    });

    it('padrão não desativa; os outros sim, sem criar oportunidade nova', async () => {
      const desativar = await chamar('PUT', `/crm/configuracoes/pipelines/${vendas.id}`, {
        ativo: false,
      });

      expect(desativar.status).toBe(HTTP_STATUS.CONFLICT);

      const inativo = await criar('sales', 'Inativo');

      await ok(chamar('PUT', `/crm/configuracoes/pipelines/${inativo.id}`, { ativo: false }));

      const leadId = await novoLead();
      const nova = await chamar('POST', `/crm/leads/${leadId}/oportunidades`, {
        pipelineId: inativo.id,
      });

      expect(nova.status).toBe(HTTP_STATUS.BAD_REQUEST);
      await ok(excluir(inativo.id));
    });

    it('automação inválida é 400 no campo; vendas não tem automação', async () => {
      const put = (id, automacao) =>
        chamar('PUT', `/crm/configuracoes/pipelines/${id}`, { automacao });
      const casos = [
        [atendimento.id, { origemId: atendimento.id }, 'automacao.origemId'],
        [atendimento.id, { statusInicial: 'concluido' }, 'automacao.statusInicial'],
        [atendimento.id, { regraDoDono: 'specific_user' }, 'automacao.donoId'],
        [vendas.id, { ativa: true }, 'automacao'],
      ];

      for (const [id, automacao, campo] of casos) {
        const resposta = await put(id, automacao);

        expect(resposta.status, campo).toBe(HTTP_STATUS.BAD_REQUEST);
        expect(resposta.corpo.error.fields).toHaveProperty([campo]);
      }
    });

    it('usuário fixo assume o atendimento', async () => {
      await ok(
        chamar('PUT', `/crm/configuracoes/pipelines/${atendimento.id}`, {
          automacao: { regraDoDono: 'specific_user', donoId: operadorId },
        }),
      );

      const leadId = await novoLead();
      const [venda] = await oportunidades(leadId);

      await ok(chamar('PATCH', `/crm/oportunidades/${venda.id}/status`, { status: 'ganho' }));

      const criado = (await oportunidades(leadId)).find(
        (deal) => deal.pipelineId === atendimento.id,
      );

      expect(criado.responsavelId).toBe(operadorId);

      await ok(
        chamar('PUT', `/crm/configuracoes/pipelines/${atendimento.id}`, {
          automacao: { regraDoDono: 'person_owner' },
        }),
      );
    });

    it('status por pipeline: a mesma key em dois pipelines não se misturam', async () => {
      const outro = await criar('sales', 'Outro');
      const deOutro = (await pipelines()).find((item) => item.id === outro.id);
      const perdidoDoOutro = deOutro.status.find((opcao) => opcao.key === 'perdido');
      const leadId = await novoLead();
      const [venda] = await oportunidades(leadId);

      await ok(
        chamar('PATCH', `/crm/oportunidades/${venda.id}/status`, {
          status: 'perdido',
          motivoPerda: null,
        }),
      );

      // "perdido" está em uso em Vendas, não neste pipeline: aqui ele sai sem bloqueio.
      expect(perdidoDoOutro.usos).toBe(0);

      const extra = await ok(
        chamar('POST', `/crm/configuracoes/pipelines/${outro.id}/status`, {
          label: 'Perda 2',
          category: 'perdido',
        }),
        HTTP_STATUS.CREATED,
      );

      await ok(
        chamar('DELETE', `/crm/configuracoes/pipelines/${outro.id}/status/${perdidoDoOutro.id}`),
      );

      const ordem = (await pipelines())
        .find((item) => item.id === outro.id)
        .status.map((opcao) => opcao.id)
        .reverse();
      const reordenada = await ok(
        chamar('PUT', `/crm/configuracoes/pipelines/${outro.id}/status/ordem`, { ids: ordem }),
      );

      expect(reordenada.map((opcao) => opcao.id)).toEqual(ordem);
      expect(ordem).toContain(extra.id);
      await ok(excluir(outro.id));
    });

    it('não dá para ficar sem status aberto ativo', async () => {
      const novo = await criar('sales', 'Sem aberto');
      const doNovo = (await pipelines()).find((item) => item.id === novo.id);
      const unico = doNovo.status.find((opcao) => opcao.category === 'aberto');
      const resposta = await chamar(
        'PUT',
        `/crm/configuracoes/pipelines/${novo.id}/status/${unico.id}`,
        { ativo: false },
      );

      expect(resposta.status).toBe(HTTP_STATUS.CONFLICT);
      await ok(excluir(novo.id));
    });

    it('status de outro pipeline não é alcançado pelo id errado', async () => {
      const deAtendimento = atendimento.status[0];
      const resposta = await chamar(
        'PUT',
        `/crm/configuracoes/pipelines/${vendas.id}/status/${deAtendimento.id}`,
        { label: 'Invadido' },
      );

      expect(resposta.status).toBe(HTTP_STATUS.NOT_FOUND);
    });
  });

  describe('ficha', () => {
    it('editar: versão certa grava; versão velha é 409 com o estado atual', async () => {
      const leadId = await novoLead();
      const [deal] = await oportunidades(leadId);
      const editado = await ok(
        chamar('PUT', `/crm/oportunidades/${deal.id}`, {
          valor: VALOR,
          titulo: 'Projeto',
          expectedUpdatedAt: deal.atualizadaEm,
        }),
      );

      expect(editado).toMatchObject({ valor: VALOR, titulo: 'Projeto' });

      const velho = await chamar('PUT', `/crm/oportunidades/${deal.id}`, {
        valor: 1,
        expectedUpdatedAt: deal.atualizadaEm,
      });

      expect(velho.status).toBe(HTTP_STATUS.CONFLICT);
      expect(velho.corpo.error.details.atual).toMatchObject({ id: deal.id, valor: VALOR });
    });

    it('editar sem a versão é 400', async () => {
      const [deal] = await oportunidades(await novoLead());
      const resposta = await chamar('PUT', `/crm/oportunidades/${deal.id}`, { valor: VALOR });

      expect(resposta.status).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(resposta.corpo.error.fields).toHaveProperty('expectedUpdatedAt');
    });

    it('mudar status com versão velha grava e avisa', async () => {
      const [deal] = await oportunidades(await novoLead());

      await ok(
        chamar('PUT', `/crm/oportunidades/${deal.id}`, {
          valor: VALOR,
          expectedUpdatedAt: deal.atualizadaEm,
        }),
      );

      const movida = await ok(
        chamar('PATCH', `/crm/oportunidades/${deal.id}/status`, {
          status: 'proposta',
          expectedUpdatedAt: deal.atualizadaEm,
        }),
      );

      expect(movida).toMatchObject({ status: 'proposta', conflito: true });
    });

    it('valores fora do limite são 400, não erro de banco', async () => {
      const leadId = await novoLead();
      const [deal] = await oportunidades(leadId);
      const casos = [
        chamar('POST', `/crm/leads/${leadId}/oportunidades`, { valor: VALOR_NEGATIVO }),
        chamar('POST', `/crm/leads/${leadId}/oportunidades`, { titulo: TITULO_LONGO }),
        chamar('PUT', `/crm/oportunidades/${deal.id}`, {
          probabilidadeFechamento: ACIMA_DO_LIMITE,
          expectedUpdatedAt: deal.atualizadaEm,
        }),
      ];

      for (const { status } of await Promise.all(casos)) {
        expect(status).toBe(HTTP_STATUS.BAD_REQUEST);
      }
    });

    it('lead ou oportunidade que não existem: 404', async () => {
      const id = randomUUID();

      expect((await chamar('GET', `/crm/leads/${id}/oportunidades`)).status).toBe(
        HTTP_STATUS.NOT_FOUND,
      );

      const status = await chamar('PATCH', `/crm/oportunidades/${id}/status`, { status: 'novo' });

      expect(status.status).toBe(HTTP_STATUS.NOT_FOUND);
    });

    it('oportunidade de outro tenant não é alcançada', async () => {
      const [deal] = await oportunidades(await novoLead());
      const outroTenant = randomUUID();
      const token = app.jwt.access.sign({ tenantId: outroTenant, userId: donoId, role: 'DONO' });
      const resposta = await app.inject({
        method: 'PATCH',
        url: `/crm/oportunidades/${deal.id}/status`,
        payload: { status: 'ganho' },
        headers: { authorization: `Bearer ${token}` },
      });

      expect(resposta.statusCode).not.toBe(HTTP_STATUS.OK);
      expect((await oportunidades(deal.leadId))[0].status).toBe('novo');
    });
  });

  describe('permissão por campo', () => {
    it('oculto não sai, e "só ver" no payload é 403', async () => {
      const campos = await ok(chamar('GET', '/crm/configuracoes/permissoes'));
      const id = (chave) => campos.campos.find((campo) => campo.chave === chave).id;

      await ok(
        chamar('PUT', '/crm/configuracoes/permissoes', {
          OPERADOR: {
            [id('motivoPerda')]: 'hidden',
            [id('probabilidadeFechamento')]: 'view',
          },
        }),
      );

      const leadId = await novoLead();
      const [deal] = await oportunidades(leadId);

      await ok(
        chamar('PUT', `/crm/oportunidades/${deal.id}`, {
          probabilidadeFechamento: PROBABILIDADE,
          expectedUpdatedAt: deal.atualizadaEm,
        }),
      );

      const [visto] = await oportunidades(leadId, operador);

      expect(visto).not.toHaveProperty('motivoPerda');
      expect(visto.probabilidadeFechamento).toBe(PROBABILIDADE);

      const escrita = await chamar(
        'PUT',
        `/crm/oportunidades/${deal.id}`,
        { probabilidadeFechamento: 1, expectedUpdatedAt: visto.atualizadaEm },
        operador,
      );

      expect(escrita.status).toBe(HTTP_STATUS.FORBIDDEN);
      expect(escrita.corpo.error.fields).toHaveProperty('probabilidadeFechamento');

      const criar = await chamar(
        'POST',
        `/crm/leads/${leadId}/oportunidades`,
        { probabilidadeFechamento: 1 },
        operador,
      );

      expect(criar.status).toBe(HTTP_STATUS.FORBIDDEN);

      const mover = await chamar(
        'PATCH',
        `/crm/oportunidades/${deal.id}/status`,
        { status: 'proposta' },
        operador,
      );

      expect(mover.status, JSON.stringify(mover.corpo)).toBe(HTTP_STATUS.OK);
      expect(mover.dados).not.toHaveProperty('motivoPerda');

      await ok(chamar('PUT', '/crm/configuracoes/permissoes', { OPERADOR: {} }));
    });
  });
});
