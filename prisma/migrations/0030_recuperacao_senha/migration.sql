-- Reutiliza os códigos descartáveis existentes com uma finalidade independente.
ALTER TABLE codigos_verificacao
  DROP CONSTRAINT codigos_verificacao_proposito_check;

ALTER TABLE codigos_verificacao
  ADD CONSTRAINT codigos_verificacao_proposito_check
  CHECK (proposito IN ('ativacao_senha', 'login_mfa', 'recuperacao_senha'));
