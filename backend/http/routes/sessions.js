import { Router } from 'express';
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

const router = Router();

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
    console.error(
      `[sessions] deleteSession failed after stopAgent for ${req.params.id} (user ${req.user.id}); marked interrupted`,
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
      console.error(
        `[sessions] batch-delete incomplete: stopped ${ownedIds.length} agent(s), deleted ${deleted}, marking ${stillOwned.length} session(s) interrupted`,
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

export default router;
