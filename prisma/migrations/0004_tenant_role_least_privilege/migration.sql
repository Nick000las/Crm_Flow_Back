-- Role de aplicação sem privilégio de dono — RLS passa a ser inevitável
-- pra ele (dono das tabelas ignora RLS por padrão, mesmo com policy
-- criada; só um role não-dono garante enforcement pelo Postgres).
--
-- Em produção (Neon), este role é criado ANTES desta migration — via SQL
-- puro rodado no SQL Editor do console (ou psql/pgAdmin), NUNCA pela aba
-- "Roles" do console nem por API/CLI: essas duas últimas formas dão
-- membership automático em `neon_superuser`, que inclui BYPASSRLS, e
-- ninguém do projeto tem ADMIN OPTION pra tirar isso depois (só o Neon
-- administra esse grupo) — ver 0005_app_tenant_nobypassrls e
-- https://neon.com/docs/manage/roles. O bloco abaixo só roda de fato em
-- CI e dev local, onde o role ainda não existe. A senha placeholder nunca
-- é usada em produção: lá o role já existe com a senha real escolhida na
-- criação manual, e o bloco vira no-op.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_tenant') THEN
    CREATE ROLE app_tenant LOGIN PASSWORD 'ci_local_dev_only_change_me'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
  END IF;
END
$$;

-- ── Tabelas do schema public com tenant_id + RLS (lista explícita, não
-- ALL TABLES — public também tem `tenants` e `payment_webhook_events`,
-- que NÃO são tenant-scoped e não devem ser alcançáveis por este role) ──
GRANT USAGE ON SCHEMA public TO app_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  usuarios, codigos_ativacao_senha, tenant_modules, tenant_module_features,
  assinaturas, cobrancas, wallets, wallet_ledger, quality_rating_history, audit_log
  TO app_tenant;

-- ── Schemas modulo_* — 100% tenant-scoped por contrato (MODULE_CONTRACT.md),
-- então ALL TABLES + default privileges é seguro aqui: cobre também
-- tabelas de módulo criadas DEPOIS desta migration, sem precisar de GRANT
-- manual por módulo novo. ──
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
