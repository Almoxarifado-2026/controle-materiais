-- ============================================================
-- CONTROLE DE MATERIAIS — RECICLAGEM E SEPARAÇÃO
-- Schema inicial (Sprint 1)
-- ============================================================
-- Decisões:
-- - "materiais" NÃO é lista fixa: é tabela editável via API (cadastrar/editar/ativar/desativar).
-- - "registros_peso" é histórico permanente: NÃO há rotina de exclusão automática por idade.
-- - "categoria" existe desde já em materiais para permitir filtro por categoria no futuro,
--   sem precisar alterar o schema depois (evita retrabalho estrutural).
-- - Todas as tabelas têm criado_em/atualizado_em para auditoria e para futura estratégia
--   de integridade/backup incremental.
-- ============================================================

CREATE TABLE IF NOT EXISTS materiais (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    nome            TEXT NOT NULL UNIQUE,
    categoria       TEXT,
    ativo           INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
    criado_em       TEXT NOT NULL,
    atualizado_em   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_materiais_ativo ON materiais(ativo);
CREATE INDEX IF NOT EXISTS idx_materiais_categoria ON materiais(categoria);

CREATE TABLE IF NOT EXISTS registros_peso (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    material_id         INTEGER NOT NULL,
    peso_kg             REAL NOT NULL CHECK (peso_kg > 0),
    data_recebimento    TEXT NOT NULL,  -- formato ISO: YYYY-MM-DD
    observacao          TEXT,
    criado_em           TEXT NOT NULL,
    atualizado_em       TEXT NOT NULL,
    FOREIGN KEY (material_id) REFERENCES materiais(id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE
);

-- Índices pensados para os filtros combinados exigidos (material + período + categoria,
-- via JOIN em materiais.categoria) usados por histórico, dashboard, gráficos, relatórios e PDF.
CREATE INDEX IF NOT EXISTS idx_registros_material ON registros_peso(material_id);
CREATE INDEX IF NOT EXISTS idx_registros_data ON registros_peso(data_recebimento);
CREATE INDEX IF NOT EXISTS idx_registros_material_data ON registros_peso(material_id, data_recebimento);

-- Tabela de controle de metadados do sistema (versão do schema, útil para migrações futuras
-- e para o relatório de Sprint poder provar em que versão de estrutura o banco está).
CREATE TABLE IF NOT EXISTS schema_meta (
    chave   TEXT PRIMARY KEY,
    valor   TEXT NOT NULL
);
