-- Achado (documentado em https://neon.com/docs/manage/roles): role criado
-- pelo Console/API/CLI do Neon herda automaticamente membership em
-- `neon_superuser`, que inclui BYPASSRLS — e ninguém do projeto tem
-- ADMIN OPTION sobre esse grupo pra tirar via ALTER ROLE depois (só o
-- Neon mesmo administra). A forma certa de criar um role SEM isso é via
-- SQL puro (SQL Editor do console, psql, pgAdmin), nunca pela aba "Roles"
-- do console nem pela API/CLI. `app_tenant` precisa ter sido criado assim
-- em produção — ver instruções no README/rollout.
--
-- Este bloco fica só como rede de segurança idempotente: em ambientes
-- onde o role foi criado por um superusuário real (CI efêmero, dev local
-- via o bloco DO da migration 0004), a assertiva roda normal. Em Neon,
-- se por engano alguém recriar o role pelo console de novo, isso NÃO
-- bloqueia o deploy (captura o erro de permissão em vez de falhar a
-- migration) — mas também não conserta sozinho; exige recriar via SQL.
DO $$
BEGIN
  ALTER ROLE app_tenant NOBYPASSRLS;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Sem permissão pra alterar app_tenant (normal se foi criado pelo Console/API do Neon — precisa recriar via SQL puro). Confirme manualmente: SELECT rolbypassrls FROM pg_roles WHERE rolname = ''app_tenant'';';
END
$$;
