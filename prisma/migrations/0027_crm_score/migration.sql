-- Pontuação de leads (docs/crm/plano-configuracoes.md, M14).
--
-- O score é o `leads.lead_score` que já existia (campo nativo "Lead score",
-- Camada 2): com a flag `crm.score` ligada ele passa a ser calculado pelas
-- regras abaixo (soma dos pontos das regras que casam) e fica só leitura;
-- desligada, volta a ser manual. Todas tenant-scoped (RLS); o `app_tenant`
-- recebe acesso pelos default privileges de `modulo_crm` (migration 0004).

-- Regras: `condicoes` = `[{ campoId, operador, valor? }]` combinadas com E
-- (vazio = todo lead), com a semântica do filtro. `campoId` sem FK, como
-- nas regras do M8/M12: campo excluído ou desligado faz a regra ser ignorada.
CREATE TABLE modulo_crm.crm_score_rule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome VARCHAR NOT NULL,
  posicao INT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  condicoes JSONB NOT NULL DEFAULT '[]',
  pontos INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX crm_score_rule_tenant_posicao_idx ON modulo_crm.crm_score_rule (tenant_id, posicao);

-- Faixas (Frio/Morno/Quente…): `minimo`/`maximo` inclusivos, nulo = sem
-- limite daquele lado. Sem linha no tenant = as faixas padrão do código.
-- `chave` é o que o filtro usa (`faixaScore`).
CREATE TABLE modulo_crm.crm_score_band (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  chave VARCHAR NOT NULL,
  rotulo VARCHAR NOT NULL,
  minimo INT,
  maximo INT,
  cor VARCHAR NOT NULL,
  posicao INT NOT NULL,
  UNIQUE (tenant_id, chave),
  CONSTRAINT crm_score_band_intervalo CHECK (minimo IS NULL OR maximo IS NULL OR minimo <= maximo)
);

-- Progresso do recálculo em lote (sem linha = nunca recalculou).
CREATE TABLE modulo_crm.crm_score_config (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  recalculo_total INT NOT NULL DEFAULT 0,
  recalculo_processados INT NOT NULL DEFAULT 0,
  recalculo_iniciado_em TIMESTAMP,
  recalculo_concluido_em TIMESTAMP
);

-- Filtro por faixa e ordenação pelo score.
CREATE INDEX leads_tenant_lead_score_idx ON modulo_crm.leads (tenant_id, lead_score);

ALTER TABLE modulo_crm.crm_score_rule ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modulo_crm.crm_score_rule
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

ALTER TABLE modulo_crm.crm_score_band ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modulo_crm.crm_score_band
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

ALTER TABLE modulo_crm.crm_score_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modulo_crm.crm_score_config
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
