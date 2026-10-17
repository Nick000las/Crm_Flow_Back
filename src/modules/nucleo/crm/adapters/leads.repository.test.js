import { describe, it, expect, vi } from 'vitest';
import { montarAtribuicoes } from './leads.repository.js';

vi.mock('#core/db/tenantClient.js', () => ({ getTenantClient: vi.fn() }));

const VALOR = 1200;

function sqlDe(atribuicoes) {
  return atribuicoes.map((atribuicao) => atribuicao.sql).join(', ');
}

describe('montarAtribuicoes (SET dinâmico do PUT de lead)', () => {
  it('mudar o status atualiza a última interação (D1, M6); outro campo não', () => {
    expect(sqlDe(montarAtribuicoes({ status: 'ganho' }))).toContain(
      'ultima_interacao_em = CASE WHEN status IS DISTINCT FROM ? THEN now() ELSE ultima_interacao_em END',
    );
    expect(sqlDe(montarAtribuicoes({ nome: 'Ana' }))).not.toContain('ultima_interacao_em');
    // Valor explícito manda: sem o CASE.
    expect(sqlDe(montarAtribuicoes({ status: 'ganho', ultimaInteracaoEm: null }))).not.toContain('CASE');
  });

  it('campo omitido não entra no UPDATE; updated_at sempre entra', () => {
    const sql = sqlDe(montarAtribuicoes({ nome: 'Ana' }));
    expect(sql).toContain('nome = ?');
    expect(sql).not.toContain('email');
    expect(sql).toContain('updated_at = now()');
  });

  it('null limpa a coluna (vai como parâmetro null)', () => {
    const atribuicoes = montarAtribuicoes({ email: null, valor: VALOR });
    expect(sqlDe(atribuicoes)).toContain('email = ?');
    expect(atribuicoes.flatMap((atribuicao) => atribuicao.values)).toEqual([null, VALOR]);
  });

  it('usa a coluna real (snake_case) e cast de uuid onde precisa', () => {
    const sql = sqlDe(montarAtribuicoes({ fonteLead: 'evento', usuarioResponsavelId: null, cpf: '1' }));
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
