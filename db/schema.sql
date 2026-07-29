-- Search engine schema
-- Designed for Postgres (Render Postgres free tier or any managed Postgres)

CREATE TABLE IF NOT EXISTS documents (
  id              BIGSERIAL PRIMARY KEY,
  url             TEXT NOT NULL UNIQUE,
  domain          TEXT NOT NULL,
  title           TEXT NOT NULL DEFAULT '',
  snippet         TEXT NOT NULL DEFAULT '',
  body_length     INTEGER NOT NULL DEFAULT 0,   -- token count, used by BM25 for doc-length normalization
  content_hash    TEXT,                          -- sha256 of body text, used to skip reindexing unchanged pages
  crawled_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_domain ON documents (domain);

-- Inverted index: one row per (term, document) pair.
-- Storing tf_title and tf_body separately lets us apply title-weighting in ranking.
CREATE TABLE IF NOT EXISTS postings (
  term            TEXT NOT NULL,
  document_id     BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tf_body         INTEGER NOT NULL DEFAULT 0,
  tf_title        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (term, document_id)
);

CREATE INDEX IF NOT EXISTS idx_postings_term ON postings (term);
CREATE INDEX IF NOT EXISTS idx_postings_document_id ON postings (document_id);

-- A small stats table so BM25 doesn't need to COUNT(*) documents on every query.
CREATE TABLE IF NOT EXISTS index_stats (
  id              SMALLINT PRIMARY KEY DEFAULT 1,
  doc_count       BIGINT NOT NULL DEFAULT 0,
  total_length    BIGINT NOT NULL DEFAULT 0,   -- sum of body_length across all docs, gives avg doc length
  CONSTRAINT single_row CHECK (id = 1)
);
INSERT INTO index_stats (id, doc_count, total_length)
VALUES (1, 0, 0)
ON CONFLICT (id) DO NOTHING;

-- Crawl frontier: the queue of URLs to visit, plus what's already been visited.
CREATE TABLE IF NOT EXISTS crawl_queue (
  id              BIGSERIAL PRIMARY KEY,
  url             TEXT NOT NULL UNIQUE,
  domain          TEXT NOT NULL,
  depth           INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending', -- pending | in_progress | done | failed | disallowed
  discovered_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at    TIMESTAMPTZ,
  error           TEXT
);

CREATE INDEX IF NOT EXISTS idx_crawl_queue_status ON crawl_queue (status);
CREATE INDEX IF NOT EXISTS idx_crawl_queue_domain ON crawl_queue (domain);

-- Per-domain crawl bookkeeping: page counts (to cap how much of one site we take)
-- and politeness timing (to respect crawl-delay / avoid hammering a host).
CREATE TABLE IF NOT EXISTS domain_stats (
  domain          TEXT PRIMARY KEY,
  pages_crawled   INTEGER NOT NULL DEFAULT 0,
  last_fetched_at TIMESTAMPTZ,
  crawl_delay_ms  INTEGER NOT NULL DEFAULT 1000,
  disallowed      BOOLEAN NOT NULL DEFAULT false -- e.g. robots.txt blocked entirely, or domain blacklisted
);

-- Cached robots.txt rules so we don't refetch it for every single page on a domain.
CREATE TABLE IF NOT EXISTS robots_cache (
  domain          TEXT PRIMARY KEY,
  rules_text      TEXT,           -- raw robots.txt body ('' if none/unreachable -> treated as allow-all)
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
