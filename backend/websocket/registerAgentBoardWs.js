import { wsAuth, wsMessageSchema } from '../middleware.js';
import { startAgent, continueAgent, stopAgent, agentEvents } from '../agentManager.js';
import { getRunOwned as getExperimentRunOwned } from '../experimentStore.js';
import { workflowEvents } from '../workflowEngine.js';
import { experimentEvents } from '../experimentEngine.js';
import { swarmEvents, initSwarmBus } from '../researchSwarm.js';
import { hasOwnedSession, hasOwnedWorkflowRun } from '../http/helpers/access.js';

const subscriptions = new Map();
const workflowSubs = new Map();
const experimentSubs = new Map();

/**
 * Register AgentBoard WebSocket protocol and event bridges (call once at process startup).
 */
export function registerAgentBoardWebSocket(wss) {
  wss.on('connection', (ws, req) => {
    if (!wsAuth(req)) {
      ws.close(4001, 'unauthorized');
      return;
    }

    ws.userId = req.userId;

    ws.on('message', async (raw) => {
      if (raw.toString() === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }

      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ error: 'invalid JSON' }));
        return;
      }

      const parsed = wsMessageSchema.safeParse(msg);
      if (!parsed.success) {
        ws.send(JSON.stringify({ error: 'validation failed', details: parsed.error.issues }));
        return;
      }
      msg = parsed.data;

      switch (msg.action) {
        case 'start': {
          if (!msg.prompt) {
            ws.send(JSON.stringify({ error: 'prompt is required' }));
            return;
          }
          try {
            const sessionId = await startAgent(msg.prompt, {
              userId: ws.userId,
              permissionMode: msg.permissionMode,
              maxTurns: msg.maxTurns,
            });
            subscriptions.set(ws, sessionId);
            ws.send(JSON.stringify({ type: 'session_started', sessionId }));
          } catch (err) {
            ws.send(JSON.stringify({ error: `agent failed to start: ${err.message}` }));
          }
          break;
        }

        case 'subscribe': {
          if (!msg.sessionId) {
            ws.send(JSON.stringify({ error: 'sessionId is required' }));
            return;
          }
          if (!(await hasOwnedSession(ws.userId, msg.sessionId))) {
            ws.send(JSON.stringify({ error: 'session not found' }));
            return;
          }
          subscriptions.set(ws, msg.sessionId);
          ws.send(JSON.stringify({ type: 'subscribed', sessionId: msg.sessionId }));
          break;
        }

        case 'follow_up': {
          if (!msg.prompt) {
            ws.send(JSON.stringify({ error: 'prompt is required' }));
            return;
          }
          const targetSid = msg.sessionId || subscriptions.get(ws);
          if (!targetSid) {
            ws.send(JSON.stringify({ error: 'no active session to continue' }));
            return;
          }
          if (!(await hasOwnedSession(ws.userId, targetSid))) {
            ws.send(JSON.stringify({ error: 'session not found' }));
            return;
          }
          const resumed = await continueAgent(targetSid, msg.prompt, {
            userId: ws.userId,
            permissionMode: msg.permissionMode,
            maxTurns: msg.maxTurns,
          });
          if (!resumed) {
            ws.send(JSON.stringify({ error: 'session is still running or not found' }));
            return;
          }
          subscriptions.set(ws, targetSid);
          ws.send(JSON.stringify({ type: 'session_resumed', sessionId: targetSid }));
          break;
        }

        case 'stop': {
          const sid = msg.sessionId || subscriptions.get(ws);
          if (sid) {
            if (!(await hasOwnedSession(ws.userId, sid))) {
              ws.send(JSON.stringify({ error: 'session not found' }));
              return;
            }
            const stopped = stopAgent(sid);
            ws.send(
              JSON.stringify({ type: 'done', content: { status: 'stopped' }, sessionId: sid }),
            );
            if (!stopped) {
              ws.send(JSON.stringify({ error: 'session not active' }));
            }
          }
          break;
        }

        case 'unsubscribe': {
          subscriptions.delete(ws);
          ws.send(JSON.stringify({ type: 'unsubscribed' }));
          break;
        }

        case 'subscribe_workflow': {
          const hasExistingRun = await hasOwnedWorkflowRun(ws.userId, msg.runId);
          if (!hasExistingRun) {
            ws.send(JSON.stringify({ error: 'run not found' }));
            return;
          }
          if (!workflowSubs.has(ws)) workflowSubs.set(ws, new Set());
          workflowSubs.get(ws).add(msg.runId);
          ws.send(JSON.stringify({ type: 'workflow_subscribed', runId: msg.runId }));
          break;
        }

        case 'unsubscribe_workflow': {
          if (msg.runId) {
            workflowSubs.get(ws)?.delete(msg.runId);
          } else {
            workflowSubs.delete(ws);
          }
          ws.send(JSON.stringify({ type: 'workflow_unsubscribed' }));
          break;
        }

        case 'subscribe_experiment': {
          if (!msg.runId || !(await getExperimentRunOwned(ws.userId, msg.runId))) {
            ws.send(JSON.stringify({ error: 'experiment run not found' }));
            return;
          }
          if (!experimentSubs.has(ws)) experimentSubs.set(ws, new Set());
          experimentSubs.get(ws).add(msg.runId);
          ws.send(JSON.stringify({ type: 'experiment_subscribed', runId: msg.runId }));
          break;
        }

        case 'unsubscribe_experiment': {
          if (msg.runId) {
            experimentSubs.get(ws)?.delete(msg.runId);
          } else {
            experimentSubs.delete(ws);
          }
          ws.send(JSON.stringify({ type: 'experiment_unsubscribed' }));
          break;
        }

        default:
          ws.send(JSON.stringify({ error: `unknown action: ${msg.action}` }));
      }
    });

    ws.on('close', () => {
      subscriptions.delete(ws);
      workflowSubs.delete(ws);
      experimentSubs.delete(ws);
    });
  });

  agentEvents.on('event', (event) => {
    for (const [ws, sessionId] of subscriptions) {
      if (sessionId === event.sessionId && ws.readyState === 1) {
        ws.send(JSON.stringify(event));
      }
    }
  });

  for (const eventName of [
    'run_start',
    'run_complete',
    'node_start',
    'node_complete',
    'agent_started',
  ]) {
    workflowEvents.on(eventName, (data) => {
      const runId = data.runId;
      if (!runId) return;
      const payload = JSON.stringify({
        type: 'workflow',
        subtype: eventName,
        content: data,
        timestamp: Date.now(),
      });
      for (const [ws, runIds] of workflowSubs) {
        if (ws.readyState === 1 && runIds.has(runId)) {
          ws.send(payload);
        }
      }
    });
  }

  for (const eventName of [
    'experiment_start',
    'experiment_done',
    'experiment_error',
    'baseline',
    'trial_start',
    'trial_accepted',
    'trial_rejected',
    'trial_error',
    'trial_complete',
    'budget_exhausted',
  ]) {
    experimentEvents.on(eventName, (data) => {
      const runId = data.runId;
      if (!runId) return;
      const payload = JSON.stringify({
        type: 'experiment',
        subtype: eventName,
        content: data,
        timestamp: Date.now(),
      });
      for (const [ws, runIds] of experimentSubs) {
        if (ws.readyState === 1 && runIds.has(runId)) {
          ws.send(payload);
        }
      }
    });
  }

  for (const eventName of [
    'swarm_decompose_start',
    'swarm_hypothesis',
    'swarm_branch_start',
    'swarm_branch_complete',
    'swarm_synthesize_start',
    'swarm_branch_selected',
    'swarm_complete',
    'swarm_error',
  ]) {
    swarmEvents.on(eventName, (data) => {
      const runId = data.runId;
      if (!runId) return;
      const payload = JSON.stringify({
        type: 'swarm',
        subtype: eventName,
        content: data,
        timestamp: Date.now(),
      });
      for (const [ws, runIds] of experimentSubs) {
        if (ws.readyState === 1 && runIds.has(runId)) {
          ws.send(payload);
        }
      }
    });
  }

  initSwarmBus(agentEvents);
}
