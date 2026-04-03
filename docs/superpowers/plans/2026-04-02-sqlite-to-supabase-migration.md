# SQLite to Supabase Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all `better-sqlite3` (native N-API) usage with `@supabase/supabase-js` (pure JS) to eliminate cross-platform compilation issues and gain cloud-hosted PostgreSQL with built-in auth potential.

**Architecture:** Create a single `supabaseClient.js` module exporting an initialized Supabase client. Rewrite each of 5 store modules from synchronous `better-sqlite3` to async `@supabase/supabase-js` calls. Update all ~104 consumer call sites to use `await`. Migrate by domain (memory -> session -> experiment/swarm -> workflow) so each domain can be tested independently.

**Tech Stack:** `@supabase/supabase-js` v2, Supabase PostgreSQL 17, `jsonb` columns for JSON data, Supabase Dashboard for migrations.

---

## File Structure

| Action      | File                                | Responsibility                                                     |
| ----------- | ----------------------------------- | ------------------------------------------------------------------ |
| **Create**  | `backend/supabaseClient.js`         | Supabase client singleton, env-based config                        |
| **Modify**  | `backend/config.js`                 | Add `supabaseUrl` + `supabaseServiceKey` env vars, remove `dbPath` |
| **Rewrite** | `backend/memoryStore.js`            | Async Supabase CRUD for memory_entities/memory_relations           |
| **Rewrite** | `backend/sessionStore.js`           | Async Supabase CRUD for sessions/events                            |
| **Rewrite** | `backend/experimentStore.js`        | Async Supabase CRUD for experiments/experiment_runs/trials         |
| **Rewrite** | `backend/swarmStore.js`             | Async Supabase CRUD for swarm_branches/swarm_coordinator_decisions |
| **Rewrite** | `backend/workflowStore.js`          | Async Supabase CRUD for workflows/workflow_runs                    |
| **Modify**  | `backend/agentManager.js`           | Add `await` to 11 sessionStore call sites                          |
| **Modify**  | `backend/server.js`                 | Add `await` to ~68 store call sites across 31 routes + shutdown    |
| **Modify**  | `backend/researchSwarm.js`          | Add `await` to 14 store call sites                                 |
| **Modify**  | `backend/workflowEngine.js`         | Add `await` to 8 store call sites                                  |
| **Modify**  | `backend/tools/RememberTool.js`     | Add `await` to 3 memoryStore call sites                            |
| **Modify**  | `backend/sessionStore.test.js`      | Rewrite to mock Supabase client                                    |
| **Modify**  | `backend/experimentStore.test.js`   | Rewrite to mock Supabase client                                    |
| **Modify**  | `backend/workflowStore.test.js`     | Rewrite to mock Supabase client                                    |
| **Modify**  | `backend/memoryStore.test.js`       | Rewrite to mock Supabase client                                    |
| **Modify**  | `backend/swarmStore.test.js`        | Rewrite to mock Supabase client                                    |
| **Modify**  | `backend/server.test.js`            | Update mocked store functions to return Promises                   |
| **Modify**  | `backend/server.experiment.test.js` | Update mocked store functions to return Promises                   |
| **Modify**  | `backend/researchSwarm.test.js`     | Update mocked store functions to return Promises                   |
| **Modify**  | `backend/experimentEngine.test.js`  | Update mocked store functions to return Promises                   |
| **Create**  | `.env.example`                      | Document required Supabase env vars                                |
| **Modify**  | `backend/package.json`              | Remove `better-sqlite3`, add `@supabase/supabase-js`               |

---

## Task 1: Supabase Project Setup + Schema Migration

**Files:**

- Supabase Dashboard (remote)

- [ ] **Step 1: Create Supabase project**

Create project "AgentBoard" in "Bowen's Org" (org: `snkzvhypmwyllzioqrzb`), region `us-west-1`. Need to pause or delete an existing project first (free tier limit = 2).

- [ ] **Step 2: Apply DDL migration for all 11 tables**

Apply via `mcp__plugin_supabase_supabase__apply_migration`:

```sql
-- Sessions & Events (from sessionStore)
CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL DEFAULT 'default',
  prompt      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  stats       JSONB,
  pinned_context JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE events (
  id         BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  content    JSONB NOT NULL,
  timestamp  BIGINT NOT NULL
);
CREATE INDEX idx_events_session ON events(session_id);

-- Experiments, Runs, Trials (from experimentStore)
CREATE TABLE experiments (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL DEFAULT 'default',
  name        TEXT NOT NULL,
  description TEXT,
  plan        JSONB NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE experiment_runs (
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
CREATE INDEX idx_runs_experiment ON experiment_runs(experiment_id);

CREATE TABLE trials (
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
CREATE INDEX idx_trials_run ON trials(run_id);

-- Swarm (from swarmStore)
CREATE TABLE swarm_branches (
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
CREATE INDEX idx_swarm_branches_run ON swarm_branches(run_id);

CREATE TABLE swarm_coordinator_decisions (
  id               TEXT PRIMARY KEY,
  run_id           TEXT NOT NULL REFERENCES experiment_runs(id) ON DELETE CASCADE,
  phase            TEXT NOT NULL,
  input_summary    TEXT,
  output_raw       TEXT,
  parsed_result    JSONB,
  agent_session_id TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_swarm_decisions_run ON swarm_coordinator_decisions(run_id);

-- Workflows (from workflowStore)
CREATE TABLE workflows (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL DEFAULT 'default',
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  definition  JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workflow_runs (
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
CREATE INDEX idx_workflow_runs_workflow ON workflow_runs(workflow_id);

-- Memory Knowledge Graph (from memoryStore)
CREATE TABLE memory_entities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  content TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE(user_id, name, type)
);
CREATE INDEX idx_mem_entities_user ON memory_entities(user_id);

CREATE TABLE memory_relations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source_entity_name TEXT NOT NULL,
  target_entity_name TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE(user_id, source_entity_name, target_entity_name, relation_type)
);
CREATE INDEX idx_mem_relations_user ON memory_relations(user_id);
```

- [ ] **Step 3: Verify tables created**

Run `mcp__plugin_supabase_supabase__list_tables` with `verbose: true` to confirm all 11 tables and indexes.

---

## Task 2: Install Dependencies + Create Supabase Client + Update Config

**Files:**

- Create: `backend/supabaseClient.js`
- Modify: `backend/config.js`
- Modify: `backend/package.json`
- Create: `.env.example`

- [ ] **Step 1: Install @supabase/supabase-js**

```bash
cd /Users/bdoctory/Development/agentboard/backend && npm install @supabase/supabase-js
```

- [ ] **Step 2: Remove better-sqlite3**

```bash
cd /Users/bdoctory/Development/agentboard/backend && npm uninstall better-sqlite3
```

- [ ] **Step 3: Create backend/supabaseClient.js**

```javascript
import { createClient } from '@supabase/supabase-js';
import config from './config.js';

const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  auth: { persistSession: false },
});

export default supabase;
```

- [ ] **Step 4: Update backend/config.js**

Remove `dbPath`. Add:

```javascript
supabaseUrl: process.env.SUPABASE_URL || '',
supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
```

- [ ] **Step 5: Create .env.example**

```env
# Supabase
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# LLM
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
LLM_API_KEY=

# Server
PORT=3001
PROXY_PORT=4000
WORKSPACE_DIR=./workspace
```

- [ ] **Step 6: Commit**

```bash
git add backend/supabaseClient.js backend/config.js backend/package.json backend/package-lock.json .env.example
git commit -m "feat(db): add Supabase client, remove better-sqlite3 dependency"
```

---

## Task 3: Migrate memoryStore + RememberTool

**Files:**

- Rewrite: `backend/memoryStore.js`
- Modify: `backend/tools/RememberTool.js` (lines 56, 60, 104 -- add `await`)
- Modify: `backend/memoryStore.test.js`

- [ ] **Step 1: Rewrite memoryStore.js to async Supabase**

```javascript
import { randomUUID } from 'node:crypto';
import supabase from './supabaseClient.js';

export async function saveEntity(userId, name, type, content) {
  const now = Date.now();
  const { error } = await supabase
    .from('memory_entities')
    .upsert(
      { id: randomUUID(), user_id: userId, name, type, content, created_at: now, updated_at: now },
      { onConflict: 'user_id,name,type' },
    );
  if (error) {
    console.error(`[memoryStore] saveEntity failed: ${error.message}`);
    throw error;
  }
  return true;
}

export async function saveRelation(userId, sourceName, targetName, relationType) {
  const { error, count } = await supabase.from('memory_relations').upsert(
    {
      id: randomUUID(),
      user_id: userId,
      source_entity_name: sourceName,
      target_entity_name: targetName,
      relation_type: relationType,
      created_at: Date.now(),
    },
    {
      onConflict: 'user_id,source_entity_name,target_entity_name,relation_type',
      ignoreDuplicates: true,
    },
  );
  if (error) {
    console.error(`[memoryStore] saveRelation failed: ${error.message}`);
    return false;
  }
  return true;
}

export async function getUserMemoryGraph(userId) {
  const { data: entities, error: eErr } = await supabase
    .from('memory_entities')
    .select('name, type, content')
    .eq('user_id', userId);
  if (eErr) {
    console.error(`[memoryStore] getUserMemoryGraph entities failed: ${eErr.message}`);
    return { entities: [], relations: [] };
  }

  const { data: relations, error: rErr } = await supabase
    .from('memory_relations')
    .select('source_entity_name, target_entity_name, relation_type')
    .eq('user_id', userId);
  if (rErr) {
    console.error(`[memoryStore] getUserMemoryGraph relations failed: ${rErr.message}`);
    return { entities, relations: [] };
  }

  return {
    entities,
    relations: relations.map((r) => ({
      source: r.source_entity_name,
      target: r.target_entity_name,
      relation: r.relation_type,
    })),
  };
}

export async function closeMemoryDb() {
  // No-op: Supabase client has no explicit close
}
```

- [ ] **Step 2: Update RememberTool.js to await**

In `backend/tools/RememberTool.js`:

- Line 56: `saveEntity(...)` -> `await saveEntity(...)`
- Line 60: `saveRelation(...)` -> `await saveRelation(...)`
- Line 104: `getUserMemoryGraph(...)` -> `await getUserMemoryGraph(...)`
- Ensure the `call()` methods of RememberTool and RecallTool are `async` (they likely already are since they're tool handlers).

- [ ] **Step 3: Update memoryStore.test.js**

Mock `supabaseClient.js` instead of `better-sqlite3`. All test assertions use `await`.

- [ ] **Step 4: Run tests**

```bash
cd /Users/bdoctory/Development/agentboard && npx vitest run backend/memoryStore.test.js
```

- [ ] **Step 5: Commit**

```bash
git add backend/memoryStore.js backend/tools/RememberTool.js backend/memoryStore.test.js
git commit -m "feat(db): migrate memoryStore to Supabase"
```

---

## Task 4: Migrate sessionStore + agentManager

**Files:**

- Rewrite: `backend/sessionStore.js`
- Modify: `backend/agentManager.js` (11 call sites need `await`)
- Modify: `backend/sessionStore.test.js`

- [ ] **Step 1: Rewrite sessionStore.js to async Supabase**

Key changes:

- All functions become `async`
- `db.prepare().run/get/all()` -> `supabase.from().insert/select/update/delete()`
- `db.transaction()` for deleteSession -> two sequential Supabase calls (events have ON DELETE CASCADE now, so just delete the session)
- `recoverStaleSessions`: `.update({ status: 'interrupted' }).eq('status', 'running')`
- `insertEvent`: `.insert()` with `content` as JSONB (no JSON.stringify needed)
- `getEvents`: `.select().eq().order()` (no JSON.parse needed, JSONB auto-parsed)
- `datetime('now')` -> handled by PostgreSQL `DEFAULT NOW()`, no client-side timestamps needed
- `close()` -> no-op

- [ ] **Step 2: Update agentManager.js**

Add `await` to all 11 call sites:

- Line 220: `await getSession(userId, sessionId)`
- Line 281: `await insertEvent(sessionId, msg.type, msg)`
- Line 296: `await getSession(userId, sessionId)`
- Line 311: `await updatePinnedContext(sessionId, pinned)`
- Line 337: `await insertEvent(sessionId, 'stderr', {...})`
- Line 347: `await updateSessionStatus(sessionId, finalStatus)`
- Line 367: `const sessionId = await createSession(opts.userId, prompt)`
- Line 387: `await updateSessionStatus(sessionId, 'failed')`
- Line 432: `await updateSessionStatus(sessionId, 'running')`
- Line 433: `await insertEvent(sessionId, 'user', {...})`
- Line 449: `await updateSessionStatus(sessionId, 'failed')`

Note: `consumeStream` and `startAgent`/`continueAgent` should already be async functions. Verify before editing.

- [ ] **Step 3: Update sessionStore.test.js**

Mock `./supabaseClient.js` instead of `better-sqlite3`. All assertions async.

- [ ] **Step 4: Run tests**

```bash
cd /Users/bdoctory/Development/agentboard && npx vitest run backend/sessionStore.test.js
```

- [ ] **Step 5: Commit**

```bash
git add backend/sessionStore.js backend/agentManager.js backend/sessionStore.test.js
git commit -m "feat(db): migrate sessionStore to Supabase"
```

---

## Task 5: Migrate experimentStore + swarmStore + researchSwarm

**Files:**

- Rewrite: `backend/experimentStore.js`
- Rewrite: `backend/swarmStore.js`
- Modify: `backend/researchSwarm.js` (14 call sites need `await`)
- Modify: `backend/experimentStore.test.js`, `backend/swarmStore.test.js`, `backend/researchSwarm.test.js`, `backend/experimentEngine.test.js`

- [ ] **Step 1: Rewrite experimentStore.js**

Key changes:

- Remove `export { db as experimentDb }` -- swarmStore will import supabase client directly
- All functions become `async`
- `updateRunStatus` CASE WHEN logic -> compute `completed_at` in JS:
  ```javascript
  const updates = { status };
  if (['completed', 'aborted', 'failed'].includes(status)) {
    updates.completed_at = new Date().toISOString();
  }
  await supabase.from('experiment_runs').update(updates).eq('id', runId);
  ```
- `updateExperiment` with `datetime('now')` -> `updated_at: new Date().toISOString()`
- `saveTrial`: `accepted` stored as boolean (not integer) in PostgreSQL
- `listTrials`: no need to `Boolean(r.accepted)` conversion (PostgreSQL returns native bool)
- `getBestTrial`: direction-based ordering via `.order('primary_metric', { ascending: direction === 'minimize' }).limit(1)`
- `plan` column is JSONB -> no JSON.stringify on insert, no JSON.parse on select
- `all_metrics` column is JSONB -> same treatment
- `close()` -> no-op

- [ ] **Step 2: Rewrite swarmStore.js**

Key changes:

- Replace `import { experimentDb as db }` with `import supabase from './supabaseClient.js'`
- All functions become `async`
- `updateBranchStatus` CASE WHEN -> compute in JS (same pattern as experimentStore)
- `is_selected` is now boolean, not integer
- `parsed_result` is JSONB -> no JSON.stringify/parse
- `datetime('now')` -> `DEFAULT NOW()` handles it server-side

- [ ] **Step 3: Update researchSwarm.js**

Add `await` to all 14 store call sites (lines 344, 390, 400, 414, 419, 420, 443, 521, 588, 637, 667, 678, 688-689, 706).

- [ ] **Step 4: Update test files**

- `experimentStore.test.js`: rewrite with Supabase mock
- `swarmStore.test.js`: rewrite with Supabase mock
- `researchSwarm.test.js`: update mocked store functions to return Promises
- `experimentEngine.test.js`: update mocked store functions to return Promises

- [ ] **Step 5: Run tests**

```bash
cd /Users/bdoctory/Development/agentboard && npx vitest run backend/experimentStore.test.js backend/swarmStore.test.js backend/researchSwarm.test.js backend/experimentEngine.test.js
```

- [ ] **Step 6: Commit**

```bash
git add backend/experimentStore.js backend/swarmStore.js backend/researchSwarm.js backend/experimentStore.test.js backend/swarmStore.test.js backend/researchSwarm.test.js backend/experimentEngine.test.js
git commit -m "feat(db): migrate experimentStore + swarmStore to Supabase"
```

---

## Task 6: Migrate workflowStore + workflowEngine

**Files:**

- Rewrite: `backend/workflowStore.js`
- Modify: `backend/workflowEngine.js` (8 call sites need `await`)
- Modify: `backend/workflowStore.test.js`

- [ ] **Step 1: Rewrite workflowStore.js**

Key changes:

- All functions become `async`
- `deleteWorkflow` transaction -> just delete workflow (workflow_runs has ON DELETE CASCADE in PostgreSQL schema)
- `definition`, `context`, `node_results` are JSONB -> no JSON.stringify/parse
- `datetime('now')` -> `updated_at: new Date().toISOString()` for explicit updates
- `close()` -> no-op

- [ ] **Step 2: Update workflowEngine.js**

Add `await` to 8 call sites (lines 342, 348, 441, 445, 458, 530, 533, 545).
Ensure `executeWorkflow` and `runExperimentNode` are async (they likely already are).

- [ ] **Step 3: Update workflowStore.test.js**

Mock `./supabaseClient.js`. All assertions async.

- [ ] **Step 4: Run tests**

```bash
cd /Users/bdoctory/Development/agentboard && npx vitest run backend/workflowStore.test.js
```

- [ ] **Step 5: Commit**

```bash
git add backend/workflowStore.js backend/workflowEngine.js backend/workflowStore.test.js
git commit -m "feat(db): migrate workflowStore to Supabase"
```

---

## Task 7: Update server.js Route Handlers

**Files:**

- Modify: `backend/server.js` (~68 store call sites across 31 routes + shutdown)
- Modify: `backend/server.test.js`, `backend/server.experiment.test.js`

- [ ] **Step 1: Add await to all session routes**

Routes: GET /api/sessions, GET /api/sessions/:id, DELETE /api/sessions/:id, POST /api/sessions/batch-delete, POST /api/sessions/:id/stop

All route handlers should already be `async (req, res) => {}`. Add `await` before every store function call.

- [ ] **Step 2: Add await to all workflow routes**

Routes: GET/POST /api/workflows, GET/PUT/DELETE /api/workflows/:id, POST /api/workflows/batch-delete, POST /api/workflows/:id/run, POST /api/workflow-runs/:id/abort, GET /api/workflows/:id/runs, GET /api/workflow-runs/:id

- [ ] **Step 3: Add await to all experiment routes**

Routes: GET/POST /api/experiments, GET/PUT/DELETE /api/experiments/:id, POST /api/experiments/:id/run, GET /api/experiment-runs/:id, POST /api/experiment-runs/:id/abort, GET /api/experiments/:id/runs, GET /api/experiment-runs/:id/trials

- [ ] **Step 4: Add await to all swarm routes**

Routes: POST /api/experiments/:id/swarm, GET /api/experiment-runs/:id/branches, GET /api/experiment-runs/:id/coordinator-decisions, POST /api/experiment-runs/:id/abort-swarm, GET /api/experiment-runs/:id/swarm-status

- [ ] **Step 5: Update shutdown handlers**

`closeDb()`, `closeWorkflowDb()`, `closeMemoryDb()`, `closeExperimentDb()` are now no-ops but still call them for interface consistency. Make shutdown `async` or just remove close calls.

- [ ] **Step 6: Update server.test.js and server.experiment.test.js**

Ensure all mocked store functions return Promises (wrap return values in `Promise.resolve()`).

- [ ] **Step 7: Run full test suite**

```bash
cd /Users/bdoctory/Development/agentboard && npx vitest run backend/server.test.js backend/server.experiment.test.js
```

- [ ] **Step 8: Commit**

```bash
git add backend/server.js backend/server.test.js backend/server.experiment.test.js
git commit -m "feat(db): update server.js routes for async Supabase stores"
```

---

## Task 8: Cleanup + Full Verification

**Files:**

- Modify: `backend/package.json` (verify better-sqlite3 removed)
- Delete references to `data/` directory in config
- Create: `.env.example` (if not done in Task 2)

- [ ] **Step 1: Verify better-sqlite3 fully removed**

```bash
cd /Users/bdoctory/Development/agentboard && grep -r "better-sqlite3" backend/ --include="*.js"
```

Expected: no matches.

- [ ] **Step 2: Verify no remaining SQLite patterns**

```bash
grep -r "db\.prepare\|db\.exec\|db\.pragma\|db\.transaction\|db\.close" backend/ --include="*.js" | grep -v node_modules | grep -v ".test.js"
```

Expected: no matches.

- [ ] **Step 3: Run full test suite**

```bash
cd /Users/bdoctory/Development/agentboard && npx vitest run
```

Expected: all 591+ tests pass.

- [ ] **Step 4: Manual smoke test**

```bash
cd /Users/bdoctory/Development/agentboard/backend && SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<key> node server.js
```

Verify server starts without errors, no SQLite file creation.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore(db): remove SQLite remnants, add .env.example"
```

---

## Key Migration Patterns Reference

### SQLite -> Supabase Query Translation

| SQLite Pattern                                                                                    | Supabase Equivalent                                                                                                               |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `db.prepare('SELECT * FROM t WHERE id = ?').get(id)`                                              | `const { data } = await supabase.from('t').select('*').eq('id', id).single()`                                                     |
| `db.prepare('SELECT * FROM t WHERE uid = ? ORDER BY x DESC LIMIT ? OFFSET ?').all(uid, lim, off)` | `const { data } = await supabase.from('t').select('*').eq('uid', uid).order('x', { ascending: false }).range(off, off + lim - 1)` |
| `db.prepare('SELECT count(*) as total FROM t WHERE uid = ?').get(uid)`                            | `const { count } = await supabase.from('t').select('*', { count: 'exact', head: true }).eq('uid', uid)`                           |
| `db.prepare('INSERT INTO t (a,b) VALUES (?,?)').run(a,b)`                                         | `await supabase.from('t').insert({ a, b })`                                                                                       |
| `db.prepare('UPDATE t SET a = ? WHERE id = ?').run(a, id)`                                        | `await supabase.from('t').update({ a }).eq('id', id)`                                                                             |
| `db.prepare('DELETE FROM t WHERE id = ?').run(id)`                                                | `await supabase.from('t').delete().eq('id', id)`                                                                                  |
| `db.transaction(() => { ... })`                                                                   | Use ON DELETE CASCADE or sequential awaits                                                                                        |
| `JSON.stringify(obj)` on insert                                                                   | Direct object (JSONB column handles it)                                                                                           |
| `JSON.parse(row.col)` on select                                                                   | Direct access (JSONB auto-parsed)                                                                                                 |
| `datetime('now')`                                                                                 | `DEFAULT NOW()` or `new Date().toISOString()`                                                                                     |
| `INTEGER ... DEFAULT 0` (boolean)                                                                 | `BOOLEAN ... DEFAULT FALSE`                                                                                                       |

### Supabase .range() vs LIMIT/OFFSET

Supabase uses inclusive ranges: `.range(from, to)` where `from` is 0-indexed start and `to` is inclusive end.

- SQLite `LIMIT 20 OFFSET 0` -> Supabase `.range(0, 19)`
- SQLite `LIMIT 20 OFFSET 40` -> Supabase `.range(40, 59)`
- Formula: `.range(offset, offset + limit - 1)`

### Error Handling Pattern

```javascript
export async function someStoreFunction(args) {
  const { data, error } = await supabase.from('table').select('*').eq('col', val);
  if (error) {
    console.error(`[storeName] someStoreFunction failed: ${error.message}`);
    return fallbackValue; // [] for lists, null for singles, 0 for counts, false for booleans
  }
  return data;
}
```
