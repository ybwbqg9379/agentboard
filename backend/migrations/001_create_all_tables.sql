-- AgentBoard: Create all tables
-- Run this in Supabase Dashboard > SQL Editor, or via Supabase CLI
-- This migration is idempotent (uses IF NOT EXISTS)

-- Sessions & Events
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL DEFAULT 'default',
  prompt      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  stats       JSONB,
  pinned_context JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
  id         BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  content    JSONB NOT NULL,
  timestamp  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);

-- Experiments, Runs, Trials
CREATE TABLE IF NOT EXISTS experiments (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL DEFAULT 'default',
  name        TEXT NOT NULL,
  description TEXT,
  plan        JSONB NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS experiment_runs (
  id               TEXT PRIMARY KEY,
  experiment_id    TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  user_id          TEXT NOT NULL DEFAULT 'default',
  status           TEXT NOT NULL DEFAULT 'running',
  best_metric      DOUBLE PRECISION,
  baseline_metric  DOUBLE PRECISION,
  total_trials     INTEGER NOT NULL DEFAULT 0,
  accepted_trials  INTEGER NOT NULL DEFAULT 0,
  error_message    TEXT,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_runs_experiment ON experiment_runs(experiment_id);

CREATE TABLE IF NOT EXISTS trials (
  id              TEXT PRIMARY KEY,
  run_id          TEXT NOT NULL REFERENCES experiment_runs(id) ON DELETE CASCADE,
  trial_number    INTEGER NOT NULL,
  accepted        BOOLEAN NOT NULL DEFAULT FALSE,
  primary_metric  DOUBLE PRECISION,
  all_metrics     JSONB,
  diff            TEXT,
  agent_session_id TEXT,
  reason          TEXT,
  duration_ms     INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trials_run ON trials(run_id);

-- Swarm
CREATE TABLE IF NOT EXISTS swarm_branches (
  id              TEXT PRIMARY KEY,
  run_id          TEXT NOT NULL REFERENCES experiment_runs(id) ON DELETE CASCADE,
  branch_index    INTEGER NOT NULL,
  hypothesis      TEXT NOT NULL,
  workspace_dir   TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'running',
  best_metric     DOUBLE PRECISION,
  total_trials    INTEGER NOT NULL DEFAULT 0,
  accepted_trials INTEGER NOT NULL DEFAULT 0,
  is_selected     BOOLEAN NOT NULL DEFAULT FALSE,
  rejection_reason TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_swarm_branches_run ON swarm_branches(run_id);

CREATE TABLE IF NOT EXISTS swarm_coordinator_decisions (
  id               TEXT PRIMARY KEY,
  run_id           TEXT NOT NULL REFERENCES experiment_runs(id) ON DELETE CASCADE,
  phase            TEXT NOT NULL,
  input_summary    TEXT,
  output_raw       TEXT,
  parsed_result    JSONB,
  agent_session_id TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_swarm_decisions_run ON swarm_coordinator_decisions(run_id);

-- Workflows
CREATE TABLE IF NOT EXISTS workflows (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL DEFAULT 'default',
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  definition  JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL DEFAULT 'default',
  workflow_id  TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending',
  context      JSONB DEFAULT '{}',
  node_results JSONB DEFAULT '{}',
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflow_id);

-- Memory Knowledge Graph
CREATE TABLE IF NOT EXISTS memory_entities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  content TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE(user_id, name, type)
);
CREATE INDEX IF NOT EXISTS idx_mem_entities_user ON memory_entities(user_id);

CREATE TABLE IF NOT EXISTS memory_relations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source_entity_name TEXT NOT NULL,
  target_entity_name TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE(user_id, source_entity_name, target_entity_name, relation_type)
);
CREATE INDEX IF NOT EXISTS idx_mem_relations_user ON memory_relations(user_id);
