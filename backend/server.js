import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import config from './config.js';
import { createApp } from './http/createApp.js';
import { registerAgentBoardWebSocket } from './websocket/registerAgentBoardWs.js';
import { recoverStaleSessions, close as closeDb } from './sessionStore.js';
import { recoverStaleRuns, closeExperimentDb } from './experimentStore.js';
import { getActiveAgents, stopAgent } from './agentManager.js';
import { closeWorkflowDb } from './workflowStore.js';
import { closeMemoryDb } from './memoryStore.js';

const app = createApp();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

registerAgentBoardWebSocket(wss);

await recoverStaleSessions();
await recoverStaleRuns();

server.listen(config.port, () => {
  console.log(`AgentBoard backend listening on http://localhost:${config.port}`);
  console.log(`WebSocket ready on ws://localhost:${config.port}`);
  console.log(`Workspace: ${config.workspaceDir}`);
  if (!process.env.AGENTBOARD_API_KEY) {
    console.warn(
      '[SECURITY] AGENTBOARD_API_KEY is not set. API remains unauthenticated for allowed localhost origins, and raw WebSocket clients without a browser Origin header are rejected. Set AGENTBOARD_API_KEY for production use.',
    );
  }
});

async function shutdown(signal) {
  console.log(`\n[${signal}] Shutting down...`);

  for (const sessionId of getActiveAgents()) {
    stopAgent(sessionId);
  }

  for (const ws of wss.clients) {
    ws.close();
  }

  server.close(async () => {
    await closeDb();
    await closeWorkflowDb();
    await closeMemoryDb();
    await closeExperimentDb();
    console.log('Shutdown complete.');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app, server };
