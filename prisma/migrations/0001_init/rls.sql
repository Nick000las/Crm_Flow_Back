-- RLS do núcleo — modelo obrigatório para toda tabela nova de qualquer módulo
-- (Bloco 2.1 do MASTER_DOCUMENT)

ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_usuarios ON usuarios
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

ALTER TABLE tenant_modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_tenant_modules ON tenant_modules
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

ALTER TABLE tenant_module_features ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_tenant_module_features ON tenant_module_features
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- =============================================================================
-- MODELO PARA MÓDULOS NOVOS — copie em todo src/modules/<cat>/<nome>/prisma/schema.prisma.part
-- =============================================================================
-- CREATE SCHEMA IF NOT EXISTS modulo_<nome>;
--
-- CREATE TABLE modulo_<nome>.<tabela> (
--   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--   tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
--   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
--   updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
-- );
--
-- ALTER TABLE modulo_<nome>.<tabela> ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY tenant_isolation ON modulo_<nome>.<tabela>
--   USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
--
-- CREATE INDEX idx_<tabela>_tenant_id ON modulo_<nome>.<tabela>(tenant_id);
