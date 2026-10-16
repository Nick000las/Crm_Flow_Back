-- Corrige drift de schema: a 0001_init cria as tabelas com
-- `CREATE TABLE IF NOT EXISTS ... tenant_id ... REFERENCES tenants(id) ON
-- DELETE CASCADE`, mas num banco onde a tabela já existia antes da 0001
-- (criada à mão, sem FK) o IF NOT EXISTS pulou o CREATE e a FK nunca
-- entrou. Efeito: excluir um tenant deixava linhas órfãs (lead sem tenant)
-- e, no CRM, a exclusão falhava em `fk_leads_usuario_responsavel`.
--
-- Idempotente: só mexe no que falta. Em banco criado do zero pelas
-- migrations, os passos 1 e 2 não encontram nada.
-- Coberto por src/core/db/__tests__/tenant-fk-coverage.test.js.

-- 1) Toda tabela com `tenant_id` ganha a FK pra `tenants` (CASCADE, igual
-- ao DDL das migrations). Com linha órfã, a FK entra NOT VALID: vale pra
-- linha nova e pro cascade, sem apagar dado aqui — limpar órfão é decisão
-- explícita, não efeito colateral de migration.
DO $$
DECLARE
  alvo RECORD;
  orfaos BIGINT;
BEGIN
  FOR alvo IN
    SELECT c.table_schema AS esquema, c.table_name AS tabela
    FROM information_schema.columns c
    JOIN pg_tables t ON t.schemaname = c.table_schema AND t.tablename = c.table_name
    WHERE c.column_name = 'tenant_id'
      AND c.table_schema NOT IN ('pg_catalog', 'information_schema')
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint k
        WHERE k.contype = 'f'
          AND k.conrelid = format('%I.%I', c.table_schema, c.table_name)::regclass
          AND k.confrelid = 'public.tenants'::regclass
      )
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I.%I x WHERE NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = x.tenant_id)',
      alvo.esquema, alvo.tabela
    ) INTO orfaos;

    EXECUTE format(
      'ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE%s',
      alvo.esquema, alvo.tabela, alvo.tabela || '_tenant_id_fkey',
      CASE WHEN orfaos > 0 THEN ' NOT VALID' ELSE '' END
    );

    IF orfaos > 0 THEN
      RAISE NOTICE '%.%: FK criada NOT VALID (% linha(s) sem tenant)', alvo.esquema, alvo.tabela, orfaos;
    END IF;
  END LOOP;
END $$;

-- 2) Responsável do lead: excluir o usuário solta o lead (SET NULL), como
-- a 0001 declarava. A 0009 recriou a FK sem ON DELETE, o que barrava
-- excluir usuário (e tenant) com lead atribuído. Sai também a FK da 0001,
-- se existir, pra não ficarem duas sobre a mesma coluna.
ALTER TABLE modulo_crm.leads DROP CONSTRAINT IF EXISTS fk_leads_usuario_responsavel;
ALTER TABLE modulo_crm.leads DROP CONSTRAINT IF EXISTS leads_usuario_responsavel_id_fkey;
ALTER TABLE modulo_crm.leads
  ADD CONSTRAINT fk_leads_usuario_responsavel
  FOREIGN KEY (usuario_responsavel_id) REFERENCES usuarios(id) ON DELETE SET NULL;
