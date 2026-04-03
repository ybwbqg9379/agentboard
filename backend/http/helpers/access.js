import { getSession } from '../../sessionStore.js';
import { getWorkflowRun } from '../../workflowStore.js';

export async function hasOwnedSession(userId, sessionId) {
  return Boolean(sessionId && (await getSession(userId, sessionId)));
}

export async function hasOwnedWorkflowRun(userId, runId) {
  return Boolean(runId && (await getWorkflowRun(userId, runId)));
}
