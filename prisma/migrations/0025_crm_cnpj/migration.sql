-- Enriquecimento por CNPJ (docs/crm/plano-configuracoes.md, M11b).
--
-- `crm_cnpj_cache`: resposta do provedor por CNPJ, GLOBAL — sem
-- `tenant_id` nem RLS, de propósito: é dado público da Receita, e o mesmo
-- CNPJ consultado por dois tenants deve custar uma chamada só. Não guarda
-- nada do tenant (nem qual lead pediu). É a exceção documentada à regra
-- "toda tabela de modulo_* tem tenant_id + RLS"
-- (src/core/db/__tests__/rls-coverage.test.js). O `app_tenant` já recebe
-- acesso pelos default privileges do schema (migration 0004).
-- `status`: `ok` ou `nao_encontrado` (o "não existe" também é cacheado).
-- `dados`: o formato do CRM, não o do provedor. Validade (30 dias) é
-- conferida na leitura.
CREATE TABLE modulo_crm.crm_cnpj_cache (
  cnpj VARCHAR(14) PRIMARY KEY,
  status VARCHAR NOT NULL CHECK (status IN ('ok', 'nao_encontrado')),
  dados JSONB NOT NULL DEFAULT '{}',
  provedor VARCHAR NOT NULL,
  consultado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Configuração por tenant. Sem linha = padrão do código (ligado, modo
-- manual, sem sobrescrever, mapeamento pros campos do sistema).
-- `mapeamento`: chave do dado da Receita → `id` do campo em `crm_field`
-- (sem FK, como as referências do layout: campo excluído some na leitura).
CREATE TABLE modulo_crm.crm_cnpj_config (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  ativo BOOLEAN NOT NULL DEFAULT true,
  modo VARCHAR NOT NULL DEFAULT 'manual' CHECK (modo IN ('manual', 'automatico')),
  sobrescrever BOOLEAN NOT NULL DEFAULT false,
  mapeamento JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE modulo_crm.crm_cnpj_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modulo_crm.crm_cnpj_config
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
