-- Participantes explícitos de cada quadro; todas as referências são tenant-scoped.
CREATE TABLE modulo_kanban_universal.board_members (
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  board_id UUID NOT NULL,
  usuario_id UUID NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, board_id, usuario_id),
  CONSTRAINT board_members_board_fk FOREIGN KEY (tenant_id, board_id)
    REFERENCES modulo_kanban_universal.boards(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT board_members_usuario_fk FOREIGN KEY (tenant_id, usuario_id)
    REFERENCES public.usuarios(tenant_id, id) ON DELETE CASCADE
);

ALTER TABLE modulo_kanban_universal.board_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modulo_kanban_universal.board_members
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
CREATE INDEX idx_board_members_usuario
  ON modulo_kanban_universal.board_members(tenant_id, usuario_id, board_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON modulo_kanban_universal.board_members TO app_tenant;

-- Preserva o acesso dos usuários ativos aos quadros que já existiam.
-- A equipe pode ser reduzida posteriormente na gestão de quadros.
INSERT INTO modulo_kanban_universal.board_members (tenant_id, board_id, usuario_id)
SELECT b.tenant_id, b.id, u.id
FROM modulo_kanban_universal.boards b
JOIN public.usuarios u ON u.tenant_id = b.tenant_id
WHERE u.ativo = true;
