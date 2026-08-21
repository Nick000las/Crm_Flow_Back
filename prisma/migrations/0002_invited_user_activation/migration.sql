-- Usuários convidados existem antes de definirem a primeira senha.
ALTER TABLE usuarios ALTER COLUMN senha_hash DROP NOT NULL;

CREATE TABLE codigos_ativacao_senha (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  usuario_id  UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  codigo_hash VARCHAR NOT NULL,
  expira_em   TIMESTAMP NOT NULL,
  usado_em    TIMESTAMP,
  tentativas  INTEGER NOT NULL DEFAULT 0 CHECK (tentativas BETWEEN 0 AND 5),
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_codigos_ativacao_tenant
  ON codigos_ativacao_senha(tenant_id);
CREATE INDEX idx_codigos_ativacao_usuario_expiracao
  ON codigos_ativacao_senha(usuario_id, expira_em DESC);

ALTER TABLE codigos_ativacao_senha ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON codigos_ativacao_senha
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
