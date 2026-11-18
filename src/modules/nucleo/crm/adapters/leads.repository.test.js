import { describe, expect, it, vi } from 'vitest';

import { montarAtribuicoes } from './leads.repository.js';

vi.mock('#core/db/tenantClient.js', () => ({ getTenantClient: vi.fn() }));

function sqlDe(atribuicoes) {
  return atribuicoes.map((atribuicao) => atribuicao.sql).join(', ');
}

describe('montarAtribuicoes (SET dinâmico do PUT de lead)', () => {
  it('campo comercial não entra: mora na oportunidade', () => {
    const sql = sqlDe(
      montarAtribuicoes({
        status: 'ganho',
        valor: 1,
        funilEstagioId: 'x',
        probabilidadeFechamento: 1,
        dataPrevistaFechamento: new Date(),
        dataConversao: new Date(),
        motivoPerda: 'x',
      }),
    );

    expect(sql).toBe('updated_at = now()');
  });

  it('campo omitido não entra no UPDATE; updated_at sempre entra', () => {
    const sql = sqlDe(montarAtribuicoes({ nome: 'Ana' }));

    expect(sql).toContain('nome = ?');
    expect(sql).not.toContain('email');
    expect(sql).toContain('updated_at = now()');
  });

  it('null limpa a coluna (vai como parâmetro null)', () => {
    const atribuicoes = montarAtribuicoes({ email: null, empresa: 'Acme' });

    expect(sqlDe(atribuicoes)).toContain('email = ?');
    expect(atribuicoes.flatMap((atribuicao) => atribuicao.values)).toEqual([null, 'Acme']);
  });

  it('usa a coluna real (snake_case) e cast de uuid onde precisa', () => {
    const sql = sqlDe(
      montarAtribuicoes({ fonteLead: 'evento', usuarioResponsavelId: null, cpf: '1' }),
    );

    expect(sql).toContain('fonte_lead = ?');
    expect(sql).toContain('usuario_responsavel_id = ?::uuid');
    expect(sql).toContain('cpf = ?');
  });

  it('ignora chave fora do mapa fechado (nunca vira identificador SQL)', () => {
    const sql = sqlDe(montarAtribuicoes({ 'nome = nome; DROP TABLE leads; --': 'x' }));

    expect(sql).not.toContain('DROP');
  });

  it('customFields: merge das chaves com valor e remoção das null', () => {
    const atribuicoes = montarAtribuicoes({ customFields: { segmento: 'varejo', antigo: null } });

    expect(sqlDe(atribuicoes)).toContain('custom_fields = (custom_fields || ?::jsonb) - ?::text[]');

    expect(atribuicoes.flatMap((atribuicao) => atribuicao.values)).toEqual([
      JSON.stringify({ segmento: 'varejo' }),
      ['antigo'],
    ]);
  });
});
