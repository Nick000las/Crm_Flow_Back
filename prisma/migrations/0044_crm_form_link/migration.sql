-- FM2 (docs/crm/plano-execucao-formularios-forecast.md): link pessoal.
--
-- Um link liga uma pessoa a um formulário, na versão publicada quando foi
-- criado. O token nunca é guardado em claro: a busca é pelo SHA-256
-- (`token_hash`), e `token_encrypted` (AES-256-GCM, chave FORMS_TOKEN_KEY)
-- existe só para "copiar de novo" devolver o mesmo link.
--
-- `expired` é gravado quando um link vencido é substituído; até lá, vencer é
-- avaliado na leitura por `expires_at`. Um ativo por pessoa e formulário.
CREATE TABLE modulo_crm.crm_form_link (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  form_id UUID NOT NULL,
  form_version_id UUID NOT NULL,
  lead_id UUID NOT NULL,
  deal_id UUID,
  token_hash BYTEA NOT NULL,
  token_encrypted BYTEA NOT NULL,
  status VARCHAR NOT NULL DEFAULT 'active',
  expires_at TIMESTAMP NOT NULL,
  opened_at TIMESTAMP,
  submitted_at TIMESTAMP,
  revoked_at TIMESTAMP,
  created_by UUID,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (tenant_id, id),
  CONSTRAINT chk_crm_form_link_status
    CHECK (status IN ('active', 'submitted', 'expired', 'revoked')),
  CONSTRAINT chk_crm_form_link_revogado CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
  CONSTRAINT chk_crm_form_link_respondido
    CHECK ((status = 'submitted') = (submitted_at IS NOT NULL)),
  CONSTRAINT fk_crm_form_link_form FOREIGN KEY (tenant_id, form_id)
    REFERENCES modulo_crm.crm_form (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_form_link_versao FOREIGN KEY (tenant_id, form_version_id)
    REFERENCES modulo_crm.crm_form_version (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_form_link_lead FOREIGN KEY (tenant_id, lead_id)
    REFERENCES modulo_crm.leads (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_form_link_deal FOREIGN KEY (tenant_id, deal_id)
    REFERENCES modulo_crm.crm_deal (tenant_id, id) ON DELETE SET NULL (deal_id),
  CONSTRAINT fk_crm_form_link_autor FOREIGN KEY (tenant_id, created_by)
    REFERENCES public.usuarios (tenant_id, id) ON DELETE SET NULL (created_by)
);
-- A rota pública busca só pelo hash, sem saber o tenant.
CREATE UNIQUE INDEX uq_crm_form_link_token ON modulo_crm.crm_form_link (token_hash);
-- Duas recepcionistas clicando ao mesmo tempo geram um link só.
CREATE UNIQUE INDEX uq_crm_form_link_ativo
  ON modulo_crm.crm_form_link (tenant_id, lead_id, form_id) WHERE status = 'active';
CREATE INDEX idx_crm_form_link_lead ON modulo_crm.crm_form_link (tenant_id, lead_id, created_at);

ALTER TABLE modulo_crm.crm_form_link ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modulo_crm.crm_form_link
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON modulo_crm.crm_form_link TO app_tenant;
