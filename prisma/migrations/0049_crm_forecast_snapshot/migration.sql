-- FC3 (docs/crm/plano-execucao-formularios-forecast.md): foto semanal do
-- forecast, base da assertividade (previsto x realizado).
--
-- Toda segunda-feira, a partir das 6h no fuso do tenant, o job
-- `snapshot-forecast` grava uma linha por mês (o atual e os três seguintes),
-- com o escopo do forecast sem restrição de papel: todos os pipelines de
-- vendas ativos, sem filtro de responsável. Um conjunto por tenant e semana
-- (UNIQUE): rodar o job de novo não grava outra vez.
--
-- `week_start`: a segunda-feira local da semana do snapshot. `month`: o
-- primeiro dia do mês previsto. `by_owner` guarda, por responsável (ou
-- "sem_responsavel"), { realized, weighted, best_case, won_count, open_count },
-- com os valores em texto decimal ("1234.50").
--
-- Imutável por trigger: mudar a probabilidade padrão ou reabrir uma
-- oportunidade não muda o que foi previsto. Só a exclusão em cascata do
-- tenant remove linhas.
CREATE TABLE modulo_crm.crm_forecast_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  month DATE NOT NULL,
  realized NUMERIC(14,2) NOT NULL,
  weighted NUMERIC(14,2) NOT NULL,
  best_case NUMERIC(14,2) NOT NULL,
  won_count INTEGER NOT NULL,
  open_count INTEGER NOT NULL,
  by_owner JSONB NOT NULL DEFAULT '{}',
  taken_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (tenant_id, id),
  CONSTRAINT uq_crm_forecast_snapshot_semana UNIQUE (tenant_id, week_start, month),
  CONSTRAINT chk_crm_forecast_snapshot_segunda CHECK (extract(isodow FROM week_start) = 1),
  CONSTRAINT chk_crm_forecast_snapshot_mes CHECK (extract(day FROM month) = 1),
  CONSTRAINT chk_crm_forecast_snapshot_contagens CHECK (won_count >= 0 AND open_count >= 0)
);
CREATE INDEX idx_crm_forecast_snapshot_mes
  ON modulo_crm.crm_forecast_snapshot (tenant_id, month, taken_at);

CREATE FUNCTION modulo_crm.crm_forecast_snapshot_imutavel() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'crm_forecast_snapshot é imutável';
END;
$$;
CREATE TRIGGER trg_crm_forecast_snapshot_imutavel BEFORE UPDATE ON modulo_crm.crm_forecast_snapshot
  FOR EACH ROW EXECUTE FUNCTION modulo_crm.crm_forecast_snapshot_imutavel();

ALTER TABLE modulo_crm.crm_forecast_snapshot ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modulo_crm.crm_forecast_snapshot
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
GRANT SELECT, INSERT ON modulo_crm.crm_forecast_snapshot TO app_tenant;
