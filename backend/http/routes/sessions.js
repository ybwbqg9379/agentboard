import { Router } from 'express';
import path from 'path';
import fs from 'fs/promises';
import {
  listSessionsPaged,
  countSessions,
  getSession,
  getEvents,
  countEvents,
  deleteSession,
  deleteSessionsBatch,
  filterSessionIdsOwned,
  updateSessionStatus,
} from '../../sessionStore.js';
import { stopAgent, getAgentStream } from '../../agentManager.js';
import { getMcpHealth } from '../../mcpHealth.js';
import {
  validateQuery,
  sessionsQuerySchema,
  controlActionSchema,
  validate,
} from '../../middleware.js';
import { hasOwnedSession } from '../helpers/access.js';
import { isPathInside } from '../../hooks.js';
import config from '../../config.js';
import { SESSION_FILE_DOWNLOAD_EXTENSIONS } from '../../../shared/sessionDownloadExtensions.js';
import { logHttpError } from '../../serverLog.js';

const router = Router();

function resolveSessionWorkspaceDir(userId, sessionId) {
  const userRoot =
    !userId || userId === 'default'
      ? path.resolve(config.workspaceDir)
      : path.resolve(config.workspaceDir, userId);
  return path.resolve(path.join(userRoot, 'sessions', sessionId));
}

router.get('/sessions', validateQuery(sessionsQuerySchema), async (req, res) => {
  const { limit, offset } = req.query;
  const sessions = await listSessionsPaged(req.user.id, limit, offset);
  const total = await countSessions(req.user.id);
  res.json({ sessions, total, limit, offset });
});

router.get('/sessions/:id', async (req, res) => {
  const session = await getSession(req.user.id, req.params.id);
  if (!session) return res.status(404).json({ error: 'session not found' });
  const events = await getEvents(req.params.id);
  const eventCount = await countEvents(req.params.id);
  res.json({ ...session, events, eventCount });
});

router.delete('/sessions/:id', async (req, res) => {
  if (!(await hasOwnedSession(req.user.id, req.params.id))) {
    return res.status(404).json({ error: 'session not found' });
  }
  stopAgent(req.params.id);
  const deleted = await deleteSession(req.user.id, req.params.id);
  if (!deleted) {
    await updateSessionStatus(req.params.id, 'interrupted', req.user.id);
    logHttpError(
      'sessions',
      req,
      `deleteSession failed after stopAgent for ${req.params.id} (user ${req.user.id}); marked interrupted`,
    );
    return res.status(500).json({
      error: 'delete failed',
      hint: 'Agent was stopped; session marked interrupted. Retry DELETE or remove from history after DB recovers.',
    });
  }
  res.json({ deleted: true });
});

router.post('/sessions/batch-delete', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array required' });
  }
  if (ids.length > 100) {
    return res.status(400).json({ error: 'max 100 ids per batch' });
  }
  const ownedIds = await filterSessionIdsOwned(req.user.id, ids);
  for (const id of ownedIds) {
    stopAgent(id);
  }
  const deleted = await deleteSessionsBatch(req.user.id, ownedIds);
  if (deleted < ownedIds.length) {
    const stillOwned = await filterSessionIdsOwned(req.user.id, ownedIds);
    if (stillOwned.length > 0) {
      logHttpError(
        'sessions',
        req,
        `batch-delete incomplete: stopped ${ownedIds.length} agent(s), deleted ${deleted}, marking ${stillOwned.length} session(s) interrupted`,
      );
      await Promise.all(
        stillOwned.map((id) => updateSessionStatus(id, 'interrupted', req.user.id)),
      );
    }
  }
  res.json({ deleted });
});

router.post('/sessions/:id/stop', async (req, res) => {
  if (!(await hasOwnedSession(req.user.id, req.params.id))) {
    return res.status(404).json({ error: 'session not found' });
  }
  const stopped = stopAgent(req.params.id);
  if (!stopped) {
    res.status(404).json({ error: 'session not found or not active', stopped });
    return;
  }
  res.json({ stopped });
});

router.post('/sessions/:id/control', validate(controlActionSchema), async (req, res) => {
  const { action } = req.body;
  if (!(await hasOwnedSession(req.user.id, req.params.id))) {
    return res.status(404).json({ error: 'session not found' });
  }
  const stream = getAgentStream(req.params.id);
  if (!stream) {
    return res.status(404).json({ error: 'session not active' });
  }
  try {
    switch (action) {
      case 'get_context_usage': {
        if (typeof stream.getContextUsage === 'function') {
          const usage = await stream.getContextUsage();
          return res.json({ action, result: usage });
        }
        return res.json({ action, result: null, note: 'not supported by SDK version' });
      }
      case 'set_model': {
        const { model } = req.body;
        if (!model) return res.status(400).json({ error: 'model is required' });
        if (typeof stream.setModel === 'function') {
          await stream.setModel(model);
          return res.json({ action, result: { model } });
        }
        return res.json({ action, result: null, note: 'not supported by SDK version' });
      }
      case 'rewind_files': {
        const { messageId } = req.body;
        if (typeof stream.rewindFiles === 'function') {
          const result = await stream.rewindFiles(messageId);
          return res.json({ action, result });
        }
        return res.json({ action, result: null, note: 'not supported by SDK version' });
      }
      case 'mcp_status': {
        return res.json({ action, result: getMcpHealth() });
      }
      default:
        return res.status(400).json({ error: `unknown control action: ${action}` });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Session bootstrap copies CLAUDE.md from user root — not an agent artifact; hide from "workspace files" UI.
function isSessionInfrastructureFile(name) {
  return name.toLowerCase() === 'claude.md';
}

// List non-hidden files in the session workspace root (Bash / subprocess outputs are not in Write/Edit events)
router.get('/sessions/:id/workspace-files', async (req, res) => {
  const { id } = req.params;
  if (!(await hasOwnedSession(req.user.id, id))) {
    return res.status(404).json({ error: 'session not found' });
  }

  const sessionDir = resolveSessionWorkspaceDir(req.user.id, id);
  const maxEntries = 500;

  try {
    const dirents = await fs.readdir(sessionDir, { withFileTypes: true });
    const candidates = [];

    for (const d of dirents) {
      if (!d.isFile()) continue;
      if (d.name.startsWith('.')) continue;
      if (isSessionInfrastructureFile(d.name)) continue;

      const filePath = path.join(sessionDir, d.name);
      if (!isPathInside(sessionDir, path.resolve(filePath))) continue;

      try {
        const st = await fs.stat(filePath);
        if (!st.isFile()) continue;
        candidates.push({
          name: d.name,
          bytes: st.size,
          mtimeMs: st.mtimeMs,
        });
      } catch {
        /* race: file removed */
      }
    }

    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const files = candidates.slice(0, maxEntries);
    res.json({ files });
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? err.code : undefined;
    if (code === 'ENOENT') {
      res.json({ files: [] });
      return;
    }
    logHttpError('sessions', req, 'workspace-files listing failed', err);
    res.status(500).json({ error: 'workspace listing failed' });
  }
});

// Download a file from the session's workspace (e.g., PDF reports)
router.get('/sessions/:id/files/:fileName', async (req, res) => {
  const { id, fileName } = req.params;

  // Reject bad extensions before DB (avoids SQLite contention on parallel tests / junk traffic)
  const ext = path.extname(fileName).toLowerCase();
  if (!SESSION_FILE_DOWNLOAD_EXTENSIONS.includes(ext)) {
    return res.status(403).json({ error: 'file type not allowed for download' });
  }

  if (!(await hasOwnedSession(req.user.id, id))) {
    return res.status(404).json({ error: 'session not found' });
  }

  try {
    const safeFileName = path.basename(fileName);
    const sessionDir = resolveSessionWorkspaceDir(req.user.id, id);
    const filePath = path.resolve(path.join(sessionDir, safeFileName));

    // Security: Ensure the resolved path is strictly inside the session directory
    if (!isPathInside(sessionDir, filePath)) {
      return res.status(403).json({ error: 'access denied' });
    }

    // Verify file exists
    await fs.access(filePath);

    res.download(filePath, safeFileName);
  } catch {
    res.status(404).json({ error: 'file not found' });
  }
});

export default router;
