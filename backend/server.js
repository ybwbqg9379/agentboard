import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import config from './config.js';
import { listSessions, getSession, getEvents } from './sessionStore.js';
import { startAgent, stopAgent, getActiveAgents, agentEvents } from './agentManager.js';

const app = express();
app.use(cors());
app.use(express.json());

// --- REST API ---

app.get('/api/sessions', (_req, res) => {
  const sessions = listSessions();
  res.json(sessions);
});

app.get('/api/sessions/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'session not found' });
  const events = getEvents(req.params.id);
  res.json({ ...session, events });
});

app.post('/api/sessions/:id/stop', (req, res) => {
  const stopped = stopAgent(req.params.id);
  res.json({ stopped });
});

app.get('/api/status', (_req, res) => {
  res.json({
    activeAgents: getActiveAgents(),
    uptime: process.uptime(),
  });
});

// --- WebSocket ---

const server = createServer(app);
const wss = new WebSocketServer({ server });

// 跟踪每个 ws 连接订阅的 sessionId
const subscriptions = new Map();

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({ error: 'invalid JSON' }));
      return;
    }

    switch (msg.action) {
      case 'start': {
        if (!msg.prompt) {
          ws.send(JSON.stringify({ error: 'prompt is required' }));
          return;
        }
        const sessionId = startAgent(msg.prompt);
        subscriptions.set(ws, sessionId);
        ws.send(JSON.stringify({ type: 'session_started', sessionId }));
        break;
      }

      case 'subscribe': {
        if (!msg.sessionId) {
          ws.send(JSON.stringify({ error: 'sessionId is required' }));
          return;
        }
        subscriptions.set(ws, msg.sessionId);
        ws.send(JSON.stringify({ type: 'subscribed', sessionId: msg.sessionId }));
        break;
      }

      case 'stop': {
        const sid = msg.sessionId || subscriptions.get(ws);
        if (sid) stopAgent(sid);
        break;
      }

      default:
        ws.send(JSON.stringify({ error: `unknown action: ${msg.action}` }));
    }
  });

  ws.on('close', () => {
    subscriptions.delete(ws);
  });
});

// 将 Agent 事件广播到订阅了对应 session 的 WebSocket 客户端
agentEvents.on('event', (event) => {
  for (const [ws, sessionId] of subscriptions) {
    if (sessionId === event.sessionId && ws.readyState === 1) {
      ws.send(JSON.stringify(event));
    }
  }
});

// --- Start ---

server.listen(config.port, () => {
  console.log(`AgentBoard backend listening on http://localhost:${config.port}`);
  console.log(`WebSocket ready on ws://localhost:${config.port}`);
  console.log(`Workspace: ${config.workspaceDir}`);
});
