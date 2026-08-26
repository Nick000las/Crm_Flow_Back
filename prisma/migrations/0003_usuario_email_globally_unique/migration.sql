-- E-mail passa a ser único GLOBALMENTE (não mais por tenant) — decisão de
-- arquitetura, ver docs/decisoes-pendentes-auth.md. Login busca usuário só
-- por e-mail (sem tenant), então o schema precisa garantir que isso é seguro.
--
-- Confirmado antes de aplicar (leitura pura, sem duplicado encontrado):
--   SELECT lower(email), count(*) FROM usuarios GROUP BY lower(email) HAVING count(*) > 1;
-- Nome da constraint antiga confirmado via pg_constraint antes de dropar.

ALTER TABLE usuarios DROP CONSTRAINT usuarios_tenant_id_email_key;

-- Redundante com o índice único abaixo (mesma coluna).
DROP INDEX IF EXISTS idx_usuarios_email;

-- Índice único CASE-INSENSITIVE, não uma constraint plana — o login já busca
-- com mode: 'insensitive' (Prisma), então "Dono@x.com" e "dono@x.com" têm
-- que ser tratados como o mesmo e-mail também na hora de bloquear duplicata.
CREATE UNIQUE INDEX usuarios_email_lower_key ON usuarios (lower(email));
