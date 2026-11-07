-- FM1 (docs/crm/plano-execucao-formularios-forecast.md): formulário e versões.
--
-- O formulário é uma seleção de campos da pessoa que já existem no CRM
-- (decisão do dono, 07/11/2026). `draft` é o rascunho em edição; publicar
-- copia o rascunho e o retrato de cada campo (label, tipo, opções) para uma
-- versão nova, que nunca muda: o link enviado responde à versão em que foi
-- criado, e a resposta guardada continua legível mesmo se o campo mudar.
CREATE TABLE modulo_crm.crm_form (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  link_ttl_days SMALLINT NOT NULL DEFAULT 7,
  draft JSONB NOT NULL DEFAULT '{"secoes": [], "introducao": null, "termo": null}'::jsonb,
  current_version_id UUID,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (tenant_id, id),
  CONSTRAINT chk_crm_form_ttl CHECK (link_ttl_days BETWEEN 1 AND 90)
);
CREATE UNIQUE INDEX uq_crm_form_nome ON modulo_crm.crm_form (tenant_id, lower(name));

CREATE TRIGGER trg_crm_form_updated_at BEFORE UPDATE ON modulo_crm.crm_form
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE modulo_crm.crm_form ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modulo_crm.crm_form
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON modulo_crm.crm_form TO app_tenant;

CREATE TABLE modulo_crm.crm_form_version (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  form_id UUID NOT NULL,
  version INTEGER NOT NULL,
  sections JSONB NOT NULL,
  fields_snapshot JSONB NOT NULL,
  intro_text TEXT,
  consent_text TEXT NOT NULL,
  published_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_by UUID,

  UNIQUE (tenant_id, id),
  UNIQUE (form_id, version),
  CONSTRAINT chk_crm_form_version_numero CHECK (version >= 1),
  CONSTRAINT fk_crm_form_version_form FOREIGN KEY (tenant_id, form_id)
    REFERENCES modulo_crm.crm_form (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_form_version_autor FOREIGN KEY (tenant_id, published_by)
    REFERENCES public.usuarios (tenant_id, id) ON DELETE SET NULL (published_by)
);

-- Versão publicada é imutável. Só a exclusão em cascata (tenant ou
-- formulário) a remove.
CREATE FUNCTION modulo_crm.crm_form_version_imutavel() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'crm_form_version é imutável depois de publicada';
END;
$$;
CREATE TRIGGER trg_crm_form_version_imutavel BEFORE UPDATE ON modulo_crm.crm_form_version
  FOR EACH ROW EXECUTE FUNCTION modulo_crm.crm_form_version_imutavel();

ALTER TABLE modulo_crm.crm_form_version ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modulo_crm.crm_form_version
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
GRANT SELECT, INSERT, DELETE ON modulo_crm.crm_form_version TO app_tenant;

ALTER TABLE modulo_crm.crm_form
  ADD CONSTRAINT fk_crm_form_versao_atual FOREIGN KEY (tenant_id, current_version_id)
    REFERENCES modulo_crm.crm_form_version (tenant_id, id) ON DELETE SET NULL (current_version_id);
