-- Layout do lead (docs/crm/plano-configuracoes.md, M4).
--
-- `layout` (JSONB) tem o formato
--   { identificador, subtitulo[], destaques[], secoes[{ nome, campos[] }], colunas[] }
-- em que cada item é o `id` de um campo de `crm_field` ou uma referência
-- fixa (`lead.valor`, `lead.responsavel`, ...). Sem FK pros ids: são
-- listas dentro do JSON; referência a campo inativo/oculto é descartada na
-- leitura (layout.service.js).

-- Padrão do tenant (DONO). Sem linha = layout inicial do código.
CREATE TABLE modulo_crm.crm_layout_config (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  layout JSONB NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE modulo_crm.crm_layout_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modulo_crm.crm_layout_config
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- Override pessoal, parcial: só as propriedades presentes em `layout`
-- valem; o resto segue o padrão. `padrao_visto` guarda as listas do padrão
-- no momento do override — o que o DONO acrescentar depois entra no fim da
-- lista do usuário.
CREATE TABLE modulo_crm.crm_user_layout_override (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  layout JSONB NOT NULL,
  padrao_visto JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, usuario_id)
);

ALTER TABLE modulo_crm.crm_user_layout_override ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modulo_crm.crm_user_layout_override
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- Busca pelo identificador documento (M4.3): CNPJ/CPF comparados só pelos
-- dígitos, com ou sem pontuação na busca. `text_pattern_ops` atende o
-- LIKE de prefixo (`12345678%`), que é o que a busca gera.
CREATE INDEX idx_leads_cnpj_digitos
  ON modulo_crm.leads (tenant_id, (regexp_replace(cnpj, '[^0-9]', '', 'g')) text_pattern_ops);
CREATE INDEX idx_leads_cpf_digitos
  ON modulo_crm.leads (tenant_id, (regexp_replace(cpf, '[^0-9]', '', 'g')) text_pattern_ops);
