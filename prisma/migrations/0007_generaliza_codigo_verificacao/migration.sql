-- Generaliza codigos_ativacao_senha em codigos_verificacao — mesma tabela,
-- diferenciada por `proposito`, em vez de uma tabela nova por finalidade
-- (MFA por e-mail usa o mesmo mecanismo de código descartável hasheado
-- que a ativação de senha já usa). Ver docs/plano-mfa-email.md.
--
-- Sem dado real de produção nesta tabela até agora — custo baixo de
-- generalizar agora, antes de existir dado pra migrar de verdade.
--
-- RLS, policy e GRANTs concedidos ao role app_tenant (migrations 0004/0006)
-- sobrevivem ao RENAME automaticamente — são amarrados ao OID da tabela,
-- não ao nome.

ALTER TABLE codigos_ativacao_senha RENAME TO codigos_verificacao;

ALTER TABLE codigos_verificacao
  ADD COLUMN proposito VARCHAR NOT NULL DEFAULT 'ativacao_senha'
    CHECK (proposito IN ('ativacao_senha', 'login_mfa'));

-- Nenhum INSERT futuro deve confiar no default — só existe pra não quebrar
-- a linha rara que já existisse (ex: smoke test) na hora do ADD COLUMN.
ALTER TABLE codigos_verificacao ALTER COLUMN proposito DROP DEFAULT;

DROP INDEX IF EXISTS idx_codigos_ativacao_usuario_expiracao;
CREATE INDEX idx_codigos_verificacao_usuario_proposito_expiracao
  ON codigos_verificacao(usuario_id, proposito, expira_em);

ALTER INDEX IF EXISTS idx_codigos_ativacao_tenant RENAME TO idx_codigos_verificacao_tenant;

-- mfa_secret nunca foi consumido por código nenhum (MFA é por e-mail, não
-- TOTP — não existe segredo de longo prazo pra guardar aqui).
ALTER TABLE usuarios DROP COLUMN IF EXISTS mfa_secret;
