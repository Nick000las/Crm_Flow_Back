import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '#api/app.js';
import { encerrarCache } from '#core/cache/cache.js';
import { getAdminClient } from '#core/db/tenantClient.js';
import { invalidarFeatures } from '#core/tenant/feature-flags.js';
import { HTTP_STATUS } from '#shared/constants/index.js';

import { CRM_FEATURES, MODULO_CRM } from '../constants.js';
import { atualizarConfiguracaoCampo } from '../services/configuracoes-campos.service.js';
import { criarNovaDefinicao } from '../services/field-definitions.service.js';
import { invalidarSchemaCampos } from '../services/field-schema.service.js';
import { reconciliarTenant } from '../services/reconcile.service.js';

/**
 * FM4: envio da resposta pela página pública e "Ver respostas" na ficha.
 * Tenant padrão com `crm.formularios` (e `crm.regras` no caso da regra).
 * GRAVA no banco de `DATABASE_URL` (tenant SMOKE, apagado no fim): só roda
 * com `CRM_DB_TESTS=1`.
 */
const rodar =
  process.env.CRM_DB_TESTS === '1' && process.env.DATABASE_URL ? describe : describe.skip;

const TIMEOUT_MS = 120_000;
const TAMANHO_SUFIXO = 8;
const BYTES_DA_CHAVE = 32;
const ORDEM = 90;
const TOKEN_NA_URL = /\/f\/([A-Za-z0-9_-]{43})$/;
const CONFIG = '/crm/configuracoes/formularios';
const PUBLICO = '/public/f';
const TERMO = 'Autorizo o uso dos meus dados para o atendimento.';
const TELEFONE = '11987654321';
/** Envio do primeiro teste: telefone e alergias gravam; nome e convênio não mudam; e-mail revisa. */
const GRAVADOS = 2;
const IGNORADOS = 2;
const ESCRITA_ESPERADA = Object.freeze({ gravados: GRAVADOS, ignorados: IGNORADOS, revisao: 1 });
/** A regra recusa a edição: os dois campos respondidos vão para revisão. */
const REVISAO_PELA_REGRA = 2;

rodar('resposta do formulário (CRM_DB_TESTS=1)', { timeout: TIMEOUT_MS }, () => {
  const prisma = getAdminClient();
  const tenantId = randomUUID();
  const donoId = randomUUID();
  const operadorId = randomUUID();
  const campos = {};
  let app;
  let formulario;
  let perguntas;
  let ipDaVez = 0;
  const novoIp = () => {
    ipDaVez += 1;

    return `10.4.0.${ipDaVez}`;
  };

  async function chamar(method, url, payload, papel = 'DONO') {
    const userId = papel === 'OPERADOR' ? operadorId : donoId;
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

  async function publica(method, caminho, payload) {
    const resposta = await app.inject({
      method,
      url: caminho,
      payload,
      remoteAddress: novoIp(),
      headers: { 'user-agent': 'Navegador de teste' },
    });

    return {
      status: resposta.statusCode,
      corpo: resposta.body ? JSON.parse(resposta.body) : null,
    };
  }

  const enviar = (token, respostas, extra = {}) =>
    publica('POST', `${PUBLICO}/${token}/respostas`, {
      respostas,
      aceite: true,
      preenchidoPor: 'titular',
      ...extra,
    });

  async function novoCampo(label) {
    const campo = await criarNovaDefinicao(tenantId, {
      label,
      tipo: 'texto',
      obrigatorio: false,
      ordem: ORDEM,
    });

    await invalidarSchemaCampos(tenantId);

    return campo;
  }

  async function novaPessoa(dados = {}) {
    const email = `${randomUUID()}@smoke.test`;
    const lead = await ok(
      chamar('POST', '/crm/leads', {
        nome: 'Maria Souza',
        email,
        customFields: { [campos.alergias.chave]: 'Dipirona' },
        ...dados,
      }),
      HTTP_STATUS.CREATED,
    );
    const link = await ok(
      chamar('POST', `/crm/leads/${lead.id}/formularios/${formulario.id}/link`, {}),
      HTTP_STATUS.CREATED,
    );
    const [, token] = link.url.match(TOKEN_NA_URL);

    return { leadId: lead.id, linkId: link.link.id, token, email };
  }

  const lerPessoa = (leadId) => ok(chamar('GET', `/crm/leads/${leadId}`));
  const respostasDa = (leadId) => ok(chamar('GET', `/crm/leads/${leadId}/formularios/respostas`));

  beforeAll(async () => {
    process.env.FORMS_TOKEN_KEY ??= randomBytes(BYTES_DA_CHAVE).toString('base64');

    await prisma.tenant.create({
      data: {
        id: tenantId,
        nome: 'SMOKE respostas',
        subdomain: `smoke-resp-${tenantId.slice(0, TAMANHO_SUFIXO)}`,
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
      data: [CRM_FEATURES.FORMULARIOS, CRM_FEATURES.REGRAS].map((featureKey) => ({
        tenantId,
        moduleKey: MODULO_CRM,
        featureKey,
      })),
    });

    await invalidarFeatures(tenantId);
    await reconciliarTenant(tenantId);
    campos.alergias = await novoCampo('Alergias');
    campos.convenio = await novoCampo('Convênio');
    campos.carteirinha = await novoCampo('Carteirinha');

    app = await buildApp({
      config: {
        APP_NAME: 'crm-formulario-respostas',
        NODE_ENV: 'test',
        CORS_ORIGIN: '*',
        JWT_SECRET: 'local-test-secret-access-only',
        JWT_REFRESH_SECRET: 'local-test-secret-refresh-only',
      },
    });

    // Carteirinha obrigatória quando há convênio: a regra que recusa a edição.
    await ok(
      chamar('POST', '/crm/configuracoes/regras', {
        kind: 'conditional',
        campoId: campos.carteirinha.id,
        condicao: { campoId: campos.convenio.id, operador: 'nao_vazio' },
        efeito: { obrigatorio: true },
      }),
      HTTP_STATUS.CREATED,
    );

    const elegiveis = await ok(chamar('GET', `${CONFIG}/campos-elegiveis`));
    const idDe = (chave) => elegiveis.find((campo) => campo.chave === chave).id;

    campos.nome = idDe('nome');
    campos.email = idDe('email');
    campos.telefone = idDe('telefone');

    const criado = await ok(chamar('POST', CONFIG, { nome: 'Anamnese' }), HTTP_STATUS.CREATED);

    await ok(
      chamar('PUT', `${CONFIG}/${criado.id}`, {
        rascunho: {
          secoes: [
            {
              itens: [
                { campoId: campos.nome, obrigatorio: true, preencher: true },
                { campoId: campos.email },
                { campoId: campos.telefone },
                { campoId: campos.alergias.id, preencher: true },
                { campoId: campos.convenio.id },
                {
                  pergunta: { rotulo: 'Fuma?', tipo: 'booleano', sensivel: true },
                  obrigatorio: true,
                },
                { pergunta: { rotulo: 'Observações', tipo: 'texto_longo' } },
              ],
            },
          ],
          termo: TERMO,
        },
      }),
    );

    const versao = await ok(chamar('POST', `${CONFIG}/${criado.id}/publicar`), HTTP_STATUS.CREATED);

    formulario = criado;

    const itens = versao.secoes[0].itens;

    perguntas = { fuma: itens[5].pergunta.id, observacoes: itens[6].pergunta.id };
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM modulo_crm.leads WHERE tenant_id = ${tenantId}::uuid`;
    await prisma.$executeRaw`DELETE FROM modulo_crm.crm_event WHERE tenant_id = ${tenantId}::uuid`;
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await app?.close();
    await encerrarCache();
  });

  it('grava pela política, guarda a resposta e fecha o link', async () => {
    const { token, leadId, linkId, email } = await novaPessoa();
    const enviado = await enviar(token, {
      [campos.nome]: 'Maria Souza',
      [campos.email]: 'outro@smoke.test',
      [campos.telefone]: TELEFONE,
      [campos.alergias.id]: 'Dipirona e AAS',
      [perguntas.fuma]: true,
      [perguntas.observacoes]: '  Dor no dente  ',
    });

    expect(enviado.status, JSON.stringify(enviado.corpo)).toBe(HTTP_STATUS.CREATED);
    expect(enviado.corpo.data).toEqual({ enviado: true });

    const pessoa = await lerPessoa(leadId);

    expect(pessoa.email).toBe(email);
    expect(pessoa.telefone.replace(/\D/g, '')).toBe(TELEFONE);
    expect(pessoa.custom_fields[campos.alergias.chave]).toBe('Dipirona e AAS');

    const [resumo] = await respostasDa(leadId);

    expect(resumo).toMatchObject({
      formulario: { id: formulario.id, nome: 'Anamnese' },
      linkId,
      preenchidoPor: 'titular',
      escrita: ESCRITA_ESPERADA,
    });

    const detalhe = await ok(
      chamar('GET', `/crm/leads/${leadId}/formularios/respostas/${resumo.id}`),
    );
    const porCampo = Object.fromEntries(
      detalhe.secoes[0].itens.filter((item) => item.campoId).map((item) => [item.campoId, item]),
    );

    expect(porCampo[campos.nome].escrita).toEqual({ resultado: 'ignorado', motivo: 'igual' });

    expect(porCampo[campos.email]).toMatchObject({
      valor: 'outro@smoke.test',
      escrita: { resultado: 'revisao', motivo: 'valor_diferente' },
    });

    expect(porCampo[campos.telefone].escrita).toEqual({ resultado: 'gravado', motivo: null });
    expect(porCampo[campos.alergias.id].escrita.resultado).toBe('gravado');

    expect(porCampo[campos.convenio.id].escrita).toEqual({
      resultado: 'ignorado',
      motivo: 'sem_resposta',
    });

    const [fuma, observacoes] = detalhe.secoes[0].itens.filter((item) => item.pergunta);

    expect(fuma.valor).toBe(true);
    expect(observacoes.valor).toBe('Dor no dente');
    expect(detalhe.termo).toBe(TERMO);
    expect(detalhe.origem.navegador).toBe('Navegador de teste');

    const links = await ok(chamar('GET', `/crm/leads/${leadId}/formularios`));

    expect(links[0]).toMatchObject({ id: linkId, status: 'submitted' });
    expect(links[0].respondidoEm).not.toBeNull();
    expect((await publica('GET', `${PUBLICO}/${token}`)).status).toBe(HTTP_STATUS.NOT_FOUND);

    const eventos = await prisma.$queryRaw`
      SELECT tipo, autor_id, detalhes FROM modulo_crm.crm_lead_event
      WHERE lead_id = ${leadId}::uuid ORDER BY created_at
    `;
    const tipos = eventos.map((evento) => evento.tipo);

    expect(tipos).toContain('formulario_respondido');

    const edicao = eventos.find((evento) => evento.detalhes?.origem === 'formulario');

    expect(edicao).toMatchObject({ tipo: 'atualizado', autor_id: null });
    expect(edicao.detalhes.respostaId).toBe(resumo.id);

    const [outbox] = await prisma.$queryRaw`
      SELECT payload FROM modulo_crm.crm_event
      WHERE tenant_id = ${tenantId}::uuid AND tipo = 'form.submitted' AND entidade_id = ${resumo.id}::uuid
    `;

    expect(outbox.payload).toEqual({ formularioId: formulario.id, leadId });
  });

  it('clique duplo grava uma resposta só', async () => {
    const { token, leadId } = await novaPessoa();
    const respostas = { [campos.nome]: 'Maria Souza', [perguntas.fuma]: false };
    const envios = await Promise.all([
      enviar(token, respostas),
      enviar(token, respostas),
      enviar(token, { ...respostas, [campos.alergias.id]: 'Látex' }),
    ]);
    const codigos = envios.map((envio) => envio.status).sort();

    expect(codigos).toEqual([HTTP_STATUS.CREATED, HTTP_STATUS.NOT_FOUND, HTTP_STATUS.NOT_FOUND]);
    expect(await respostasDa(leadId)).toHaveLength(1);
  });

  it('editar o campo na ficha não muda "Ver respostas"', async () => {
    const { token, leadId } = await novaPessoa();

    await enviar(token, {
      [campos.nome]: 'Maria Souza',
      [campos.alergias.id]: 'Pólen',
      [perguntas.fuma]: false,
    });

    await ok(
      chamar('PUT', `/crm/leads/${leadId}`, {
        customFields: { [campos.alergias.chave]: 'Nenhuma' },
      }),
    );

    const [resumo] = await respostasDa(leadId);
    const detalhe = await ok(
      chamar('GET', `/crm/leads/${leadId}/formularios/respostas/${resumo.id}`),
    );
    const alergias = detalhe.secoes[0].itens.find((item) => item.campoId === campos.alergias.id);

    expect(alergias.valor).toBe('Pólen');
    expect((await lerPessoa(leadId)).custom_fields[campos.alergias.chave]).toBe('Nenhuma');
  });

  it('contato que já é de outra pessoa vai para revisão e não é gravado', async () => {
    const outra = await novaPessoa({ telefone: '11912345678' });
    const { token, leadId } = await novaPessoa();

    await ok(chamar('PUT', `/crm/leads/${leadId}`, { email: null, telefone: '11955554444' }));

    const enviado = await enviar(token, {
      [campos.nome]: 'Maria Souza',
      [campos.email]: outra.email,
      [perguntas.fuma]: false,
    });

    expect(enviado.status).toBe(HTTP_STATUS.CREATED);
    expect((await lerPessoa(leadId)).email).toBeNull();

    const [resumo] = await respostasDa(leadId);
    const detalhe = await ok(
      chamar('GET', `/crm/leads/${leadId}/formularios/respostas/${resumo.id}`),
    );
    const email = detalhe.secoes[0].itens.find((item) => item.campoId === campos.email);

    expect(email.escrita).toEqual({ resultado: 'revisao', motivo: 'contato_de_outra_pessoa' });
  });

  it('regra do CRM que recusa a edição: a resposta vai, os campos ficam para revisão', async () => {
    const { token, leadId } = await novaPessoa();
    const enviado = await enviar(token, {
      [campos.nome]: 'Maria Souza',
      [campos.convenio.id]: 'Unimed',
      [campos.alergias.id]: 'Iodo',
      [perguntas.fuma]: true,
    });

    expect(enviado.status, JSON.stringify(enviado.corpo)).toBe(HTTP_STATUS.CREATED);

    const pessoa = await lerPessoa(leadId);

    expect(pessoa.custom_fields[campos.convenio.chave] ?? null).toBeNull();
    expect(pessoa.custom_fields[campos.alergias.chave]).toBe('Dipirona');

    const [resumo] = await respostasDa(leadId);

    expect(resumo.escrita).toMatchObject({ gravados: 0, revisao: REVISAO_PELA_REGRA });
  });

  describe('validação', () => {
    it('obrigatório, tipo, pergunta de fora, termo e responsável: 400, e o link continua ativo', async () => {
      const { token, linkId } = await novaPessoa();
      const semObrigatorio = await enviar(token, { [campos.telefone]: 'abc' });

      expect(semObrigatorio.status).toBe(HTTP_STATUS.BAD_REQUEST);

      expect(Object.keys(semObrigatorio.corpo.error.fields).sort()).toEqual(
        [
          `respostas.${campos.nome}`,
          `respostas.${campos.telefone}`,
          `respostas.${perguntas.fuma}`,
        ].sort(),
      );

      const deFora = await enviar(token, {
        [campos.nome]: 'Maria',
        [perguntas.fuma]: true,
        [randomUUID()]: 'x',
      });

      expect(deFora.status).toBe(HTTP_STATUS.BAD_REQUEST);

      const semAceite = await enviar(
        token,
        { [campos.nome]: 'Maria', [perguntas.fuma]: true },
        { aceite: false },
      );

      expect(semAceite.corpo.error.fields).toHaveProperty(['aceite']);

      const semNome = await enviar(
        token,
        { [campos.nome]: 'Maria', [perguntas.fuma]: true },
        { preenchidoPor: 'responsavel' },
      );

      expect(semNome.corpo.error.fields).toHaveProperty(['nomeResponsavel']);

      const [linha] = await prisma.$queryRaw`
        SELECT status FROM modulo_crm.crm_form_link WHERE id = ${linkId}::uuid
      `;

      expect(linha.status).toBe('active');

      const peloResponsavel = await enviar(
        token,
        { [campos.nome]: 'Maria Souza', [perguntas.fuma]: true },
        { preenchidoPor: 'responsavel', nomeResponsavel: 'Joana Souza' },
      );

      expect(peloResponsavel.status).toBe(HTTP_STATUS.CREATED);
    });
  });

  describe('prazo', () => {
    it('quem abriu antes de vencer ainda envia dentro da folga; quem não abriu, não', async () => {
      const aberto = await novaPessoa();

      await publica('POST', `${PUBLICO}/${aberto.token}/aberto`);

      const naoAberto = await novaPessoa();

      await prisma.$executeRaw`
        UPDATE modulo_crm.crm_form_link
        SET opened_at = CASE WHEN opened_at IS NULL THEN NULL ELSE CURRENT_TIMESTAMP - interval '2 hours' END,
            expires_at = CURRENT_TIMESTAMP - interval '1 hour'
        WHERE id IN (${aberto.linkId}::uuid, ${naoAberto.linkId}::uuid)
      `;

      const respostas = { [campos.nome]: 'Maria Souza', [perguntas.fuma]: false };

      expect((await publica('GET', `${PUBLICO}/${aberto.token}`)).status).toBe(HTTP_STATUS.OK);
      expect((await enviar(aberto.token, respostas)).status).toBe(HTTP_STATUS.CREATED);
      expect((await enviar(naoAberto.token, respostas)).status).toBe(HTTP_STATUS.NOT_FOUND);
    });

    it('pessoa anonimizada não responde', async () => {
      const { token, leadId } = await novaPessoa();

      await prisma.$executeRaw`
        UPDATE modulo_crm.leads SET anonimizado_em = CURRENT_TIMESTAMP WHERE id = ${leadId}::uuid
      `;

      expect(
        (await enviar(token, { [campos.nome]: 'Maria Souza', [perguntas.fuma]: false })).status,
      ).toBe(HTTP_STATUS.NOT_FOUND);
    });
  });

  it('o banco recusa alterar uma resposta', async () => {
    const { token, leadId } = await novaPessoa();

    await enviar(token, { [campos.nome]: 'Maria Souza', [perguntas.fuma]: false });

    const [resumo] = await respostasDa(leadId);

    await expect(
      prisma.$executeRaw`
        UPDATE modulo_crm.crm_form_submission SET filled_by = 'titular' WHERE id = ${resumo.id}::uuid
      `,
    ).rejects.toThrow(/imutável/);
  });

  it('OPERADOR: campo e pergunta sensíveis saem ocultos, sem IP nem navegador', async () => {
    const { token, leadId } = await novaPessoa();

    await enviar(token, {
      [campos.nome]: 'Maria Souza',
      [campos.alergias.id]: 'Iodo',
      [perguntas.fuma]: true,
    });

    await atualizarConfiguracaoCampo(tenantId, campos.alergias.id, { sensivel: true });
    await invalidarSchemaCampos(tenantId);

    try {
      const [resumo] = await ok(
        chamar('GET', `/crm/leads/${leadId}/formularios/respostas`, undefined, 'OPERADOR'),
      );
      const caminho = `/crm/leads/${leadId}/formularios/respostas/${resumo.id}`;
      const doOperador = await ok(chamar('GET', caminho, undefined, 'OPERADOR'));
      const alergias = doOperador.secoes[0].itens.find(
        (item) => item.campoId === campos.alergias.id,
      );
      const fuma = doOperador.secoes[0].itens.find((item) => item.pergunta?.id === perguntas.fuma);

      expect(alergias).toMatchObject({ oculto: true });
      expect(alergias).not.toHaveProperty('valor');
      expect(fuma).toMatchObject({ oculto: true });
      expect(fuma).not.toHaveProperty('valor');
      expect(doOperador).not.toHaveProperty('origem');
      expect(JSON.stringify(doOperador)).not.toContain('Iodo');

      const doDono = await ok(chamar('GET', caminho));
      const alergiasDono = doDono.secoes[0].itens.find(
        (item) => item.campoId === campos.alergias.id,
      );

      expect(alergiasDono.valor).toBe('Iodo');
    } finally {
      await atualizarConfiguracaoCampo(tenantId, campos.alergias.id, { sensivel: false });
      await invalidarSchemaCampos(tenantId);
    }
  });
});
