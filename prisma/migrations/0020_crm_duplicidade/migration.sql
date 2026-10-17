-- Duplicidade e mesclagem (docs/crm/plano-configuracoes.md, M7).

-- Chaves de comparação, em funções IMMUTABLE pra caber em coluna gerada.
-- `services/duplicidade.service.js` tem o espelho em JS (chaveTelefone...)
-- pra montar o valor da consulta — as duas precisam dar o mesmo resultado.

-- Telefone: só dígitos, sem o DDI 55 e sem o 9 depois do DDD. Assim
-- "11 98765-4321", "+55 11 98765-4321" e o antigo "11 8765-4321" viram a
-- mesma chave. Fixo (8 dígitos começando de 2 a 5) nunca colide com celular.
CREATE FUNCTION modulo_crm.chave_telefone(telefone TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  WITH d AS (SELECT regexp_replace(telefone, '[^0-9]', '', 'g') AS v),
       sem_ddi AS (
         SELECT CASE WHEN length(v) IN (12, 13) AND left(v, 2) = '55' THEN substr(v, 3) ELSE v END AS v FROM d
       )
  SELECT NULLIF(
    CASE WHEN length(v) = 11 AND substr(v, 3, 1) = '9' THEN left(v, 2) || substr(v, 4) ELSE v END,
    ''
  ) FROM sem_ddi
$$;

-- Documento: maiúsculas e só [0-9A-Z] — cobre o CNPJ alfanumérico.
CREATE FUNCTION modulo_crm.chave_documento(documento TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT NULLIF(upper(regexp_replace(documento, '[^0-9A-Za-z]', '', 'g')), '')
$$;

ALTER TABLE modulo_crm.leads
  ADD COLUMN dedup_email TEXT GENERATED ALWAYS AS (NULLIF(lower(btrim(email)), '')) STORED,
  ADD COLUMN dedup_telefone TEXT GENERATED ALWAYS AS (modulo_crm.chave_telefone(telefone)) STORED,
  ADD COLUMN dedup_cnpj TEXT GENERATED ALWAYS AS (modulo_crm.chave_documento(cnpj)) STORED,
  ADD COLUMN dedup_cpf TEXT GENERATED ALWAYS AS (modulo_crm.chave_documento(cpf)) STORED,
  -- Lead descartado numa mesclagem: vai pra lixeira e não pode ser restaurado.
  ADD COLUMN mesclado_em_id UUID REFERENCES modulo_crm.leads(id) ON DELETE SET NULL;

-- Lixeira não conta como duplicado. CNPJ/CPF com text_pattern_ops também
-- servem à busca por prefixo do identificador (M4), no lugar dos índices
-- de dígitos da 0017 (que não cobriam o CNPJ alfanumérico).
CREATE INDEX idx_leads_dedup_email ON modulo_crm.leads (tenant_id, dedup_email) WHERE deleted_at IS NULL;
CREATE INDEX idx_leads_dedup_telefone ON modulo_crm.leads (tenant_id, dedup_telefone) WHERE deleted_at IS NULL;
CREATE INDEX idx_leads_dedup_cnpj ON modulo_crm.leads (tenant_id, dedup_cnpj text_pattern_ops) WHERE deleted_at IS NULL;
CREATE INDEX idx_leads_dedup_cpf ON modulo_crm.leads (tenant_id, dedup_cpf text_pattern_ops) WHERE deleted_at IS NULL;
DROP INDEX modulo_crm.idx_leads_cnpj_digitos;
DROP INDEX modulo_crm.idx_leads_cpf_digitos;

-- Regras de duplicidade: uma por campo. Sem linha = regras padrão do
-- código (e-mail e telefone avisam; CNPJ e CPF desligados).
CREATE TABLE modulo_crm.crm_duplicate_rule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  campo VARCHAR NOT NULL CHECK (campo IN ('email', 'telefone', 'cnpj', 'cpf')),
  acao VARCHAR NOT NULL CHECK (acao IN ('warn', 'block')),
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, campo)
);

ALTER TABLE modulo_crm.crm_duplicate_rule ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modulo_crm.crm_duplicate_rule
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- Evento com contexto além do diff (mesclagem: o id do lead descartado).
ALTER TABLE modulo_crm.crm_lead_event ADD COLUMN detalhes JSONB NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION modulo_crm.bloquear_edicao_evento()
RETURNS TRIGGER AS $$
BEGIN
  -- `autor_id` pode virar NULL: é o ON DELETE SET NULL de quando o usuário sai.
  IF (NEW.id, NEW.tenant_id, NEW.tipo, NEW.diff, NEW.detalhes, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.tipo, OLD.diff, OLD.detalhes, OLD.created_at)
     OR (NEW.autor_id IS NOT NULL AND NEW.autor_id IS DISTINCT FROM OLD.autor_id) THEN
    RAISE EXCEPTION 'crm_lead_event é append-only: só lead_id pode mudar (mesclagem)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Import (Revisar): ação escolhida por linha duplicada — { "<linha>": "pular" | "atualizar" | "criar" }.
ALTER TABLE modulo_crm.import_jobs ADD COLUMN acoes JSONB NOT NULL DEFAULT '{}';
