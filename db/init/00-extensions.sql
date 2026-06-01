-- Runs once at first DB init (mounted into the pgvector image's init dir).
CREATE EXTENSION IF NOT EXISTS vector;
