-- audit_log continua append-only (UPDATE e DELETE direto barrados), mas
-- deixa passar o DELETE em cascata da exclusão do tenant (FK ON DELETE
-- CASCADE): é o que `TenantManagement.deleteTenant` documenta ("apaga ...
-- audit log desse tenant"), e sem isso todo tenant com uma linha de
-- auditoria ficava impossível de excluir. Decisão do usuário (M15, 2026-10-27).
--
-- O DELETE da cascata é disparado pela trigger de integridade referencial,
-- então este trigger roda aninhado (`pg_trigger_depth() > 1`); um DELETE
-- feito direto na tabela roda no nível 1.
CREATE OR REPLACE FUNCTION bloquear_modificacao_audit()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_log é append-only: UPDATE/DELETE não permitido';
END;
$$ LANGUAGE plpgsql;
