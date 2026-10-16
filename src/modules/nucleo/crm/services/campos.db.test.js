import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encerrarCache } from '#core/cache/cache.js';
import { getAdminClient } from '#core/db/tenantClient.js';
import { CAMPOS_SISTEMA, LISTA_CONTEXTOS_VISIBILIDADE, LISTAS_SEMEADAS, OPCOES_SUGERIDAS } from '../constants.js';
import {
  atualizarConfiguracaoCampo,
  listarConfiguracaoCampos,
  restaurarOrdemPadrao,
} from './configuracoes-campos.service.js';
import { criarNovaDefinicao, removerDefinicao } from './field-definitions.service.js';
import { camposDoContexto, obterSchemaCampos } from './field-schema.service.js';
import { buscarLeadFormatado, pesquisarLeads, registrarNovoLead } from './leads.service.js';
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
 * Exige as migrations até a 0016 aplicadas.
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
});
