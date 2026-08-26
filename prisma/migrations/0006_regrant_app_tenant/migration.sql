-- Reaplica os GRANTs da migration 0004. Necessário porque em produção o
-- `app_tenant` criado originalmente (pelo console, com BYPASSRLS herdado
-- de neon_superuser — ver 0005) precisou ser apagado e recriado via SQL
-- puro; apagar o role apaga também tudo que foi concedido a ele. GRANT é
-- idempotente — rodar de novo em CI/dev local (onde o role nunca foi
-- apagado) é inofensivo.
GRANT USAGE ON SCHEMA public TO app_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  usuarios, codigos_ativacao_senha, tenant_modules, tenant_module_features,
  assinaturas, cobrancas, wallets, wallet_ledger, quality_rating_history, audit_log
  TO app_tenant;

GRANT USAGE ON SCHEMA modulo_crm, modulo_atendimento, modulo_kanban_universal,
  modulo_ia, modulo_agendamento, modulo_pagamento_inchat,
  modulo_estetica_capilar, modulo_tatuagem TO app_tenant;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA
  modulo_crm, modulo_atendimento, modulo_kanban_universal, modulo_ia,
  modulo_agendamento, modulo_pagamento_inchat, modulo_estetica_capilar,
  modulo_tatuagem
  TO app_tenant;

ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA
  modulo_crm, modulo_atendimento, modulo_kanban_universal, modulo_ia,
  modulo_agendamento, modulo_pagamento_inchat, modulo_estetica_capilar,
  modulo_tatuagem
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_tenant;
