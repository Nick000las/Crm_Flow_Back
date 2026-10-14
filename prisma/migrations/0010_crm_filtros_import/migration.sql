-- Filtros salvos e importação assíncrona do CRM
-- (docs/plano-crm-campos-hibridos.md, passos 6 e 7;
-- docs/plano-crm-campos-filtros-import-export.md, seções 2.5 e 3.2).

-- Views de filtro salvas por usuário. `filtros` guarda o mesmo body de
-- POST /crm/leads/search (sem paginação) — reaplicar a view é só reenviar.
CREATE TABLE modulo_crm.crm_filter_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nome VARCHAR NOT NULL,
  filtros JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, usuario_id, nome)
);

ALTER TABLE modulo_crm.crm_filter_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modulo_crm.crm_filter_views
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE INDEX idx_crm_filter_views_tenant_usuario ON modulo_crm.crm_filter_views(tenant_id, usuario_id);

-- Jobs de importação (só import — export é síncrono, não gera job).
-- `payload` guarda as linhas já validadas e mapeadas pra CriarLeadInput;
-- o worker consome daqui, sem reprocessar a planilha nem precisar de
-- storage de arquivo.
CREATE TABLE modulo_crm.import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  status VARCHAR NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente','processando','concluido','falhou')),
  estrategia_duplicata VARCHAR NOT NULL
    CHECK (estrategia_duplicata IN ('pular','atualizar','criar')),
  payload JSONB NOT NULL,
  total_linhas INTEGER NOT NULL,
  linhas_processadas INTEGER NOT NULL DEFAULT 0,
  linhas_criadas INTEGER NOT NULL DEFAULT 0,
  linhas_atualizadas INTEGER NOT NULL DEFAULT 0,
  linhas_ignoradas INTEGER NOT NULL DEFAULT 0,
  linhas_com_erro INTEGER NOT NULL DEFAULT 0,
  relatorio_erro JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  concluido_em TIMESTAMP
);

ALTER TABLE modulo_crm.import_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modulo_crm.import_jobs
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE INDEX idx_import_jobs_tenant_status ON modulo_crm.import_jobs(tenant_id, status);
