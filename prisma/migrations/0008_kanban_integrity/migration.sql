-- A validação das FKs aborta a migration se houver referências antigas inconsistentes.
-- Corrija os registros apontados pelo PostgreSQL antes de reaplicar.
ALTER TABLE public.usuarios ADD CONSTRAINT usuarios_tenant_id_id_key UNIQUE (tenant_id, id);
ALTER TABLE modulo_kanban_universal.boards ADD CONSTRAINT boards_tenant_id_id_key UNIQUE (tenant_id, id);
ALTER TABLE modulo_kanban_universal.colunas ADD CONSTRAINT colunas_tenant_board_id_key UNIQUE (tenant_id, board_id, id);
ALTER TABLE modulo_kanban_universal.cards ADD CONSTRAINT cards_tenant_id_id_key UNIQUE (tenant_id, id);
ALTER TABLE modulo_kanban_universal.colunas ADD CONSTRAINT colunas_board_tenant_fk FOREIGN KEY (tenant_id, board_id) REFERENCES modulo_kanban_universal.boards(tenant_id, id) ON DELETE CASCADE;
ALTER TABLE modulo_kanban_universal.cards ADD CONSTRAINT cards_board_tenant_fk FOREIGN KEY (tenant_id, board_id) REFERENCES modulo_kanban_universal.boards(tenant_id, id) ON DELETE CASCADE;
ALTER TABLE modulo_kanban_universal.cards ADD CONSTRAINT cards_coluna_tenant_board_fk FOREIGN KEY (tenant_id, board_id, coluna_id) REFERENCES modulo_kanban_universal.colunas(tenant_id, board_id, id);
ALTER TABLE modulo_kanban_universal.cards ADD CONSTRAINT cards_responsavel_tenant_fk FOREIGN KEY (tenant_id, responsavel_id) REFERENCES public.usuarios(tenant_id, id);
ALTER TABLE modulo_kanban_universal.card_comments ADD CONSTRAINT comments_card_tenant_fk FOREIGN KEY (tenant_id, card_id) REFERENCES modulo_kanban_universal.cards(tenant_id, id) ON DELETE CASCADE;
ALTER TABLE modulo_kanban_universal.card_comments ADD CONSTRAINT comments_usuario_tenant_fk FOREIGN KEY (tenant_id, usuario_id) REFERENCES public.usuarios(tenant_id, id);
CREATE INDEX idx_kanban_colunas_ordem ON modulo_kanban_universal.colunas(tenant_id, board_id, "order", id);
CREATE INDEX idx_kanban_cards_ordem ON modulo_kanban_universal.cards(tenant_id, board_id, coluna_id, "order", id);
