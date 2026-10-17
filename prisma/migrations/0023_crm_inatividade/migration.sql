-- Lead esfriando (docs/crm/plano-configuracoes.md, M9) e notificações
-- in-app do core (D5).

-- Dias sem interação até o lead esfriar, por status. NULL = desligado
-- (ganho, perdido e status novo criado pelo DONO). Coluna na própria opção
-- em vez da tabela `crm_stale_config` da spec: segue o ciclo de vida da
-- opção e não deixa linha órfã. "Esfriando" é calculado na leitura
-- (`crm-inatividade.repository.js`), nada é gravado no lead.
ALTER TABLE modulo_crm.crm_option
  ADD COLUMN stale_days INTEGER,
  ADD CONSTRAINT chk_crm_option_stale_days CHECK (stale_days BETWEEN 1 AND 365),
  ADD CONSTRAINT chk_crm_option_stale_days_status CHECK (stale_days IS NULL OR kind = 'status');

-- Sugestões da spec (§6) nos tenants que já têm as listas semeadas; os
-- novos recebem pelo reconcile das listas (SUGESTAO_DIAS_ESFRIAR).
UPDATE modulo_crm.crm_option o
SET stale_days = s.dias
FROM (VALUES ('novo', 1), ('em_contato', 3), ('qualificado', 5), ('proposta', 7), ('negociacao', 7)) AS s(key, dias)
WHERE o.kind = 'status' AND o.category = 'aberto' AND o.key = s.key AND o.stale_days IS NULL;

-- Atividade agendada em aberto pausa a contagem até a data dela: a
-- leitura pega a maior `agendada_para` em aberto de cada lead.
CREATE INDEX idx_crm_activity_pausa
  ON modulo_crm.crm_activity (tenant_id, lead_id, agendada_para)
  WHERE concluida_em IS NULL AND agendada_para IS NOT NULL;

-- Notificação in-app (sino do shell), do core: serve qualquer módulo.
-- `chave_dedup` torna a geração idempotente (ex.: o resumo diário do CRM
-- usa a data local do tenant), por isso o job pode rodar de hora em hora.
CREATE TABLE notificacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  modulo VARCHAR NOT NULL,
  tipo VARCHAR NOT NULL,
  titulo VARCHAR NOT NULL,
  corpo TEXT,
  -- Para onde a notificação leva (rota e filtro), no formato do módulo.
  dados JSONB NOT NULL DEFAULT '{}',
  chave_dedup VARCHAR NOT NULL,
  lida_em TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (tenant_id, usuario_id, chave_dedup)
);

CREATE INDEX idx_notificacoes_usuario ON notificacoes (tenant_id, usuario_id, created_at DESC);

ALTER TABLE notificacoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notificacoes
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- `public` não tem default privileges pro app_tenant (migration 0004):
-- toda tabela tenant-scoped nova aqui precisa do GRANT explícito.
GRANT SELECT, INSERT, UPDATE, DELETE ON notificacoes TO app_tenant;
