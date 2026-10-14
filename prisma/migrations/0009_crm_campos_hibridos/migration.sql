-- Campos híbridos do CRM (docs/plano-crm-campos-hibridos.md).
-- Camada 1: colunas nativas sempre ativas. Camada 2: colunas nativas,
-- visibilidade controlada por tenant via tenant_lead_field_visibility.
-- Camada 3 (JSONB) já existe desde a migration 0008, não é tocada aqui.

-- Drift não rastreado: `email`/`origem` existiam em produção sem passar
-- por nenhuma migration (ausentes de 0001-0008 e do schema.prisma.part),
-- ambas vazias e sem uso em código. Removidas aqui pra reintroduzir
-- `email` e `fonte_lead` do zero, do jeito planejado (decisão do usuário).
ALTER TABLE modulo_crm.leads
  DROP COLUMN email,
  DROP COLUMN origem;

-- Camada 1
ALTER TABLE modulo_crm.leads
  ALTER COLUMN telefone DROP NOT NULL,
  ADD COLUMN email VARCHAR,
  ADD COLUMN fonte_lead VARCHAR CHECK (fonte_lead IN ('whatsapp','formulario_site','indicacao','trafego_pago','evento','importacao_manual','outro')),
  ADD COLUMN status VARCHAR CHECK (status IN ('novo','em_contato','qualificado','proposta','negociacao','ganho','perdido')),
  ADD COLUMN tags VARCHAR[],
  ADD COLUMN ultima_interacao_em TIMESTAMP,
  ADD CONSTRAINT chk_leads_email_ou_telefone CHECK (email IS NOT NULL OR telefone IS NOT NULL),
  ADD CONSTRAINT fk_leads_usuario_responsavel FOREIGN KEY (usuario_responsavel_id) REFERENCES usuarios(id);

-- Camada 2 (todas nullable — visibilidade é controlada pela tabela abaixo)
ALTER TABLE modulo_crm.leads
  ADD COLUMN empresa VARCHAR,
  ADD COLUMN cargo VARCHAR,
  ADD COLUMN cpf VARCHAR,
  ADD COLUMN cnpj VARCHAR,
  ADD COLUMN cidade VARCHAR,
  ADD COLUMN uf VARCHAR,
  ADD COLUMN cep VARCHAR,
  ADD COLUMN endereco VARCHAR,
  ADD COLUMN campanha_utm VARCHAR,
  ADD COLUMN data_conversao TIMESTAMP,
  ADD COLUMN probabilidade_fechamento NUMERIC,
  ADD COLUMN data_prevista_fechamento TIMESTAMP,
  ADD COLUMN motivo_perda VARCHAR CHECK (motivo_perda IN ('preco','concorrente','sem_orcamento','sem_resposta','fora_do_perfil','outro')),
  ADD COLUMN lead_score NUMERIC,
  ADD COLUMN proximo_followup TIMESTAMP;

-- Controle de visibilidade de Camada 2 por tenant.
CREATE TABLE modulo_crm.tenant_lead_field_visibility (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  coluna VARCHAR NOT NULL,
  visivel BOOLEAN NOT NULL DEFAULT false,
  ordem INTEGER NOT NULL DEFAULT 0,
  obrigatorio BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (tenant_id, coluna)
);

ALTER TABLE modulo_crm.tenant_lead_field_visibility ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modulo_crm.tenant_lead_field_visibility
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE INDEX idx_lead_field_visibility_tenant ON modulo_crm.tenant_lead_field_visibility(tenant_id);
