-- AgentBoard: Enable Row Level Security
-- Run after 001_create_all_tables.sql
-- RLS policies use JWT claims for user isolation (takes effect when using publishable key)
-- The secret key (sb_secret_) bypasses RLS by design

-- Enable RLS on all tables
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiment_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE trials ENABLE ROW LEVEL SECURITY;
ALTER TABLE swarm_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE swarm_coordinator_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_relations ENABLE ROW LEVEL SECURITY;

-- User isolation policies (active when using publishable key + Supabase Auth)
CREATE POLICY IF NOT EXISTS "Users access own sessions" ON sessions
  FOR ALL USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub');

CREATE POLICY IF NOT EXISTS "Users access own events" ON events
  FOR ALL USING (session_id IN (
    SELECT id FROM sessions WHERE user_id = current_setting('request.jwt.claims', true)::json->>'sub'
  ));

CREATE POLICY IF NOT EXISTS "Users access own experiments" ON experiments
  FOR ALL USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub');

CREATE POLICY IF NOT EXISTS "Users access own experiment_runs" ON experiment_runs
  FOR ALL USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub');

CREATE POLICY IF NOT EXISTS "Users access own trials" ON trials
  FOR ALL USING (run_id IN (
    SELECT id FROM experiment_runs WHERE user_id = current_setting('request.jwt.claims', true)::json->>'sub'
  ));

CREATE POLICY IF NOT EXISTS "Users access own swarm_branches" ON swarm_branches
  FOR ALL USING (run_id IN (
    SELECT id FROM experiment_runs WHERE user_id = current_setting('request.jwt.claims', true)::json->>'sub'
  ));

CREATE POLICY IF NOT EXISTS "Users access own coordinator_decisions" ON swarm_coordinator_decisions
  FOR ALL USING (run_id IN (
    SELECT id FROM experiment_runs WHERE user_id = current_setting('request.jwt.claims', true)::json->>'sub'
  ));

CREATE POLICY IF NOT EXISTS "Users access own workflows" ON workflows
  FOR ALL USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub');

CREATE POLICY IF NOT EXISTS "Users access own workflow_runs" ON workflow_runs
  FOR ALL USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub');

CREATE POLICY IF NOT EXISTS "Users access own memory_entities" ON memory_entities
  FOR ALL USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub');

CREATE POLICY IF NOT EXISTS "Users access own memory_relations" ON memory_relations
  FOR ALL USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub');
