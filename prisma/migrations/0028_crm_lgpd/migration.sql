-- Base legal LGPD (docs/crm/plano-configuracoes.md, M15).
--
-- Quatro campos do sistema (Camada 2) no lead, mais o carimbo da
-- anonimização. As datas e a origem são gravadas pelo back (só leitura na
-- API); a base legal é escolhida (ou vem do padrão do tenant / do lote do
-- import). Valores fixos em CHECK: são categorias da lei, não lista do tenant.
ALTER TABLE modulo_crm.leads
  ADD COLUMN legal_basis VARCHAR
    CONSTRAINT chk_leads_legal_basis
    CHECK (legal_basis IN ('consentimento', 'legitimo_interesse', 'execucao_contrato', 'obrigacao_legal', 'outra')),
  ADD COLUMN legal_basis_at TIMESTAMP,
  ADD COLUMN origem_registro VARCHAR
    CONSTRAINT chk_leads_origem_registro
    CHECK (origem_registro IN ('formulario', 'importacao', 'whatsapp', 'manual', 'api')),
  ADD COLUMN marketing_opt_out_at TIMESTAMP,
  -- Pedido do titular atendido: PII apagada, lead travado pra edição.
  ADD COLUMN anonimizado_em TIMESTAMP;

-- Lead anonimizado fica sem e-mail e sem telefone (de propósito).
ALTER TABLE modulo_crm.leads DROP CONSTRAINT IF EXISTS chk_leads_email_ou_telefone;
ALTER TABLE modulo_crm.leads
  ADD CONSTRAINT chk_leads_email_ou_telefone
  CHECK (email IS NOT NULL OR telefone IS NOT NULL OR anonimizado_em IS NOT NULL);

-- Configuração por tenant (sem linha = sem padrão, não obrigatória). A
-- obrigatoriedade em si é a do campo "Base legal" (`crm_field.is_required`),
-- que formulário e import já validam — aqui fica só a base padrão.
CREATE TABLE modulo_crm.crm_lgpd_config (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  base_legal_padrao VARCHAR
    CONSTRAINT chk_crm_lgpd_config_base
    CHECK (base_legal_padrao IN ('consentimento', 'legitimo_interesse', 'execucao_contrato', 'obrigacao_legal', 'outra')),
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE modulo_crm.crm_lgpd_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modulo_crm.crm_lgpd_config
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- O histórico continua append-only, com UMA exceção: a anonimização (M15)
-- apaga os valores pessoais do diff/detalhes, na mesma transação que liga
-- `app.lgpd_anonimizando` (SET LOCAL). id, tenant, tipo e data nunca mudam.
CREATE OR REPLACE FUNCTION modulo_crm.bloquear_edicao_evento()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.lgpd_anonimizando', true) = 'on' THEN
    IF (NEW.id, NEW.tenant_id, NEW.tipo, NEW.created_at)
       IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.tipo, OLD.created_at) THEN
      RAISE EXCEPTION 'crm_lead_event: a anonimização só pode mudar diff e detalhes';
    END IF;
    RETURN NEW;
  END IF;
  -- `autor_id` pode virar NULL: é o ON DELETE SET NULL de quando o usuário sai.
  IF (NEW.id, NEW.tenant_id, NEW.tipo, NEW.diff, NEW.detalhes, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.tipo, OLD.diff, OLD.detalhes, OLD.created_at)
     OR (NEW.autor_id IS NOT NULL AND NEW.autor_id IS DISTINCT FROM OLD.autor_id) THEN
    RAISE EXCEPTION 'crm_lead_event é append-only: só lead_id pode mudar (mesclagem)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
