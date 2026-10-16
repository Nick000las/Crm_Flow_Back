-- Tipos MVP de campo personalizado (docs/plano-crm-configuracoes.md, M2.3):
-- texto_longo, monetario, telefone, email, url. A tabela antiga continua
-- recebendo escrita dupla até a aposentadoria (M1.8), então o CHECK dela
-- precisa aceitar os tipos novos. `crm_field.type` não tem CHECK (0012).
ALTER TABLE modulo_crm.tenant_lead_field_definitions
  DROP CONSTRAINT IF EXISTS tenant_lead_field_definitions_tipo_check;
ALTER TABLE modulo_crm.tenant_lead_field_definitions
  ADD CONSTRAINT tenant_lead_field_definitions_tipo_check CHECK (tipo IN (
    'texto','texto_longo','numero','monetario','data','booleano',
    'selecao','selecao_multipla','telefone','email','url'
  ));
