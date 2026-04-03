import { Router } from 'express';
import { getActiveAgents, PERMISSION_MODES } from '../../agentManager.js';
import { getMcpHealth } from '../../mcpHealth.js';

const router = Router();

router.get('/status', (_req, res) => {
  res.json({
    activeAgents: getActiveAgents(_req.user.id),
    uptime: process.uptime(),
  });
});

router.get('/mcp/health', (_req, res) => {
  res.json(getMcpHealth());
});

router.get('/config/permissions', (_req, res) => {
  res.json({ modes: PERMISSION_MODES });
});

export default router;
