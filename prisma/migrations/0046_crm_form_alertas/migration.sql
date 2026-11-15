-- FM5 (docs/crm/plano-execucao-formularios-forecast.md): alertas do formulário.
--
-- O dono configura regras no formulário ("Alergias contém dipirona →
-- crítico"). Elas são publicadas com a versão (`alert_rules`) e avaliadas no
-- envio da resposta: cada regra que casa vira um `crm_form_alert` da pessoa.
-- "Visto" é por usuário (`crm_form_alert_seen`): cada um vê o alerta até
-- marcar o seu.
--
-- `sensitive`: o alvo da regra era sensível na versão. Quem não vê o alvo
-- recebe só um texto genérico.

-- ADD COLUMN com padrão constante não reescreve as linhas nem dispara o
-- trigger de imutabilidade: as versões já publicadas ficam sem regras.
ALTER TABLE modulo_crm.crm_form_version
  ADD COLUMN alert_rules JSONB NOT NULL DEFAULT '[]';

CREATE TABLE modulo_crm.crm_form_alert (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL,
  submission_id UUID NOT NULL,
  form_id UUID NOT NULL,
  rule_id VARCHAR NOT NULL,
  level VARCHAR NOT NULL,
  text VARCHAR NOT NULL,
  sensitive BOOLEAN NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (tenant_id, id),
  CONSTRAINT uq_crm_form_alert_regra UNIQUE (submission_id, rule_id),
  CONSTRAINT chk_crm_form_alert_nivel CHECK (level IN ('info', 'warning', 'critical')),
  CONSTRAINT fk_crm_form_alert_lead FOREIGN KEY (tenant_id, lead_id)
    REFERENCES modulo_crm.leads (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_form_alert_resposta FOREIGN KEY (tenant_id, submission_id)
    REFERENCES modulo_crm.crm_form_submission (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_form_alert_form FOREIGN KEY (tenant_id, form_id)
    REFERENCES modulo_crm.crm_form (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_crm_form_alert_lead ON modulo_crm.crm_form_alert (tenant_id, lead_id, created_at);

ALTER TABLE modulo_crm.crm_form_alert ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modulo_crm.crm_form_alert
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
GRANT SELECT, INSERT, DELETE ON modulo_crm.crm_form_alert TO app_tenant;

CREATE TABLE modulo_crm.crm_form_alert_seen (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  alert_id UUID NOT NULL,
  user_id UUID NOT NULL,
  seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (alert_id, user_id),
  CONSTRAINT fk_crm_form_alert_seen_alerta FOREIGN KEY (tenant_id, alert_id)
    REFERENCES modulo_crm.crm_form_alert (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_form_alert_seen_usuario FOREIGN KEY (tenant_id, user_id)
    REFERENCES public.usuarios (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_crm_form_alert_seen_usuario ON modulo_crm.crm_form_alert_seen (tenant_id, user_id);

ALTER TABLE modulo_crm.crm_form_alert_seen ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modulo_crm.crm_form_alert_seen
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
GRANT SELECT, INSERT, DELETE ON modulo_crm.crm_form_alert_seen TO app_tenant;
