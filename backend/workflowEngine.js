/**
 * DAG-based workflow execution engine.
 *
 * Workflow definition format:
 * {
 *   nodes: [
 *     { id, type, label, config }
 *   ],
 *   edges: [
 *     { from, to, condition? }
 *   ]
 * }
 *
 * Node types:
 *   - agent:     Run a prompt via agentManager. config: { prompt, agentType?, permissionMode?, maxTurns? }
 *   - condition:  Branch based on expression.   config: { expression }  (evaluates against context)
 *   - transform:  Transform context data.       config: { mapping }     (key -> template string)
 *   - input:      Workflow entry point.          config: { variables? }
 *   - output:     Workflow terminal.             config: { summary? }
 */

import { EventEmitter } from 'node:events';
import { startAgent, stopAgent, agentEvents } from './agentManager.js';
import { createWorkflowRun, updateWorkflowRun, completeWorkflowRun } from './workflowStore.js';

export const workflowEvents = new EventEmitter();

// Active workflow runs: Map<runId, { aborted, currentAgentSessionId, currentAgentListener }>
const activeRuns = new Map();

/**
 * Validate a workflow definition. Returns { valid, errors }.
 */
export function validateWorkflow(definition) {
  const errors = [];
  const { nodes, edges } = definition || {};

  if (!Array.isArray(nodes) || nodes.length === 0) {
    errors.push('Workflow must have at least one node');
    return { valid: false, errors };
  }
  if (!Array.isArray(edges)) {
    errors.push('Workflow must have an edges array');
    return { valid: false, errors };
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const inputNodes = nodes.filter((n) => n.type === 'input');
  const outputNodes = nodes.filter((n) => n.type === 'output');

  if (inputNodes.length === 0) {
    errors.push('Workflow must have at least one input node');
  }
  if (outputNodes.length === 0) {
    errors.push('Workflow must have at least one output node');
  }

  for (const node of nodes) {
    if (!node.id || !node.type) {
      errors.push(`Node missing id or type: ${JSON.stringify(node)}`);
    }
    if (!['agent', 'condition', 'transform', 'input', 'output'].includes(node.type)) {
      errors.push(`Unknown node type: ${node.type}`);
    }
    if (node.type === 'agent' && !node.config?.prompt) {
      errors.push(`Agent node "${node.id}" missing prompt in config`);
    }
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.from)) {
      errors.push(`Edge references unknown source node: ${edge.from}`);
    }
    if (!nodeIds.has(edge.to)) {
      errors.push(`Edge references unknown target node: ${edge.to}`);
    }
  }

  // Check for cycles via topological sort
  if (errors.length === 0) {
    const sorted = topologicalSort(nodes, edges);
    if (!sorted) {
      errors.push('Workflow contains a cycle');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Topological sort of nodes. Returns sorted array or null if cycle detected.
 */
export function topologicalSort(nodes, edges) {
  const inDegree = new Map();
  const adjacency = new Map();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  for (const edge of edges) {
    adjacency.get(edge.from)?.push(edge.to);
    inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
  }

  const queue = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted = [];
  while (queue.length > 0) {
    const current = queue.shift();
    sorted.push(current);
    for (const neighbor of adjacency.get(current) || []) {
      const newDeg = inDegree.get(neighbor) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  return sorted.length === nodes.length ? sorted : null;
}

/**
 * Evaluate a simple expression against context.
 * Supports: context.key == "value", context.key != "value",
 *           context.key > N, context.key contains "str"
 */
export function evaluateCondition(expression, context) {
  if (!expression) return true;

  // Simple pattern: "key operator value"
  const match = expression.match(/^(\S+)\s+(==|!=|>|<|>=|<=|contains)\s+(.+)$/);
  if (!match) return !!context[expression];

  const [, key, op, rawVal] = match;
  const ctxVal = key.split('.').reduce((obj, k) => obj?.[k], context);
  const val = rawVal.replace(/^["']|["']$/g, '');

  switch (op) {
    case '==':
      return String(ctxVal) === val;
    case '!=':
      return String(ctxVal) !== val;
    case '>':
      return Number(ctxVal) > Number(val);
    case '<':
      return Number(ctxVal) < Number(val);
    case '>=':
      return Number(ctxVal) >= Number(val);
    case '<=':
      return Number(ctxVal) <= Number(val);
    case 'contains':
      return String(ctxVal).includes(val);
    default:
      return false;
  }
}

/**
 * Apply template substitution: replace {{key}} with context values.
 */
function applyTemplate(template, context) {
  if (typeof template !== 'string') return template;
  return template.replace(/\{\{(\S+?)\}\}/g, (_, key) => {
    const val = key.split('.').reduce((obj, k) => obj?.[k], context);
    return val !== undefined ? String(val) : `{{${key}}}`;
  });
}

/**
 * Execute a single node and return its result.
 */
async function executeNode(node, context, runId, workflowId, userId) {
  const nodeId = node.id;

  workflowEvents.emit('node_start', { runId, workflowId, nodeId, type: node.type });

  switch (node.type) {
    case 'input': {
      const result = { ...context, ...(node.config?.variables || {}) };
      workflowEvents.emit('node_complete', { runId, workflowId, nodeId, result });
      return result;
    }

    case 'output': {
      const summary = node.config?.summary
        ? applyTemplate(node.config.summary, context)
        : JSON.stringify(context);
      const result = { summary, context };
      workflowEvents.emit('node_complete', { runId, workflowId, nodeId, result });
      return result;
    }

    case 'transform': {
      const mapping = node.config?.mapping || {};
      const result = { ...context };
      for (const [key, template] of Object.entries(mapping)) {
        result[key] = applyTemplate(template, context);
      }
      workflowEvents.emit('node_complete', { runId, workflowId, nodeId, result });
      return result;
    }

    case 'agent': {
      const prompt = applyTemplate(node.config.prompt, context);
      const result = await runAgentNode(prompt, node.config, runId, workflowId, nodeId, userId);
      workflowEvents.emit('node_complete', { runId, workflowId, nodeId, result });
      return result;
    }

    case 'condition': {
      const condResult = evaluateCondition(node.config?.expression, context);
      const result = { ...context, _branch: condResult };
      workflowEvents.emit('node_complete', {
        runId,
        workflowId,
        nodeId,
        result: { branch: condResult },
      });
      return result;
    }

    default:
      throw new Error(`Unknown node type: ${node.type}`);
  }
}

/**
 * Run an agent node: start a session and wait for completion.
 * Registers the running agent with activeRuns so abort can cancel it.
 */
// Safety timeout for agent nodes: if done event never arrives (e.g. abort race), force-reject.
const AGENT_NODE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

function runAgentNode(prompt, nodeConfig, runId, workflowId, nodeId, userId) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const sessionId = startAgent(prompt, {
      userId,
      permissionMode: nodeConfig.permissionMode || 'bypassPermissions',
      maxTurns: nodeConfig.maxTurns || 30,
    });

    workflowEvents.emit('agent_started', { runId, workflowId, nodeId, sessionId });

    let resultText = '';

    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(
          new Error(`Agent node "${nodeId}" timed out after ${AGENT_NODE_TIMEOUT_MS / 1000}s`),
        );
      }
    }, AGENT_NODE_TIMEOUT_MS);

    function onEvent(event) {
      if (event.sessionId !== sessionId) return;

      if (event.type === 'result') {
        resultText = event.content?.result || event.content?.last_assistant_message || '';
      }

      if (event.type === 'done') {
        if (settled) return;
        settled = true;
        cleanup();
        const status = event.content?.status || 'completed';
        if (status === 'completed') {
          resolve({ sessionId, status, output: resultText });
        } else {
          reject(new Error(`Agent node "${nodeId}" ended with status: ${status}`));
        }
      }
    }

    function cleanup() {
      clearTimeout(timeoutId);
      agentEvents.off('event', onEvent);
      const entry = activeRuns.get(runId);
      if (entry) {
        entry.currentAgentSessionId = null;
        entry.currentAgentListener = null;
      }
    }

    // Register with activeRuns so abort can stop this agent
    const entry = activeRuns.get(runId);
    if (entry) {
      entry.currentAgentSessionId = sessionId;
      entry.currentAgentListener = onEvent;
    }

    agentEvents.on('event', onEvent);
  });
}

/**
 * Execute a workflow run.
 * @param {string} workflowId
 * @param {object} definition - { nodes, edges }
 * @param {object} [inputContext={}] - Initial context values
 * @param {string} [preCreatedRunId] - Optional pre-created run ID (from API layer)
 * @param {string} [userId] - User ID for SaaS tracking and tenancy
 * @returns {Promise<{ runId, status, nodeResults, context }>}
 */
export async function executeWorkflow(
  workflowId,
  definition,
  inputContext = {},
  preCreatedRunId,
  userId = 'default',
) {
  const runId = preCreatedRunId || createWorkflowRun(userId, workflowId, inputContext);
  const { nodes, edges } = definition;

  activeRuns.set(runId, { aborted: false });
  workflowEvents.emit('run_start', { runId, workflowId });

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const sorted = topologicalSort(nodes, edges);
  if (!sorted) {
    completeWorkflowRun(runId, { status: 'failed', nodeResults: {}, error: 'Cycle detected' });
    workflowEvents.emit('run_complete', {
      runId,
      workflowId,
      status: 'failed',
      error: 'Cycle detected',
    });
    activeRuns.delete(runId);
    return { runId, status: 'failed', nodeResults: {}, context: inputContext };
  }

  // Build adjacency with conditions for edge filtering
  const outEdges = new Map();
  for (const edge of edges) {
    if (!outEdges.has(edge.from)) outEdges.set(edge.from, []);
    outEdges.get(edge.from).push(edge);
  }

  // Track which nodes have been "activated" (their dependencies are met)
  const nodeResults = {};
  let context = { ...inputContext };
  const executed = new Set();
  const skipped = new Set();

  try {
    for (const nodeId of sorted) {
      if (activeRuns.get(runId)?.aborted) {
        throw new Error('Workflow aborted');
      }

      if (skipped.has(nodeId)) continue;

      const node = nodeMap.get(nodeId);

      // Check if all incoming edges are satisfied (executed or skipped)
      const incomingEdges = edges.filter((e) => e.to === nodeId);
      const allIncomingResolved = incomingEdges.every(
        (e) => executed.has(e.from) || skipped.has(e.from),
      );
      const anyIncomingExecuted = incomingEdges.some((e) => executed.has(e.from));
      if (incomingEdges.length > 0 && (!allIncomingResolved || !anyIncomingExecuted)) {
        skipped.add(nodeId);
        continue;
      }

      // Execute the node
      const result = await executeNode(node, context, runId, workflowId, userId);
      nodeResults[nodeId] = result;
      executed.add(nodeId);

      // Merge result into context (agent results go under their nodeId key)
      if (node.type === 'agent') {
        context = { ...context, [nodeId]: result };
      } else if (node.type === 'input' || node.type === 'transform') {
        context = { ...context, ...result };
      }

      // For condition nodes, skip branches based on the evaluation
      if (node.type === 'condition') {
        const branch = result._branch;
        const outgoing = outEdges.get(nodeId) || [];
        for (const edge of outgoing) {
          // Edges with condition "true" or "false" (string)
          if (edge.condition === 'true' && !branch) {
            markDescendantsSkipped(edge.to, outEdges, skipped, edges, nodeId);
          } else if (edge.condition === 'false' && branch) {
            markDescendantsSkipped(edge.to, outEdges, skipped, edges, nodeId);
          }
        }
      }

      // Persist progress
      updateWorkflowRun(runId, { status: 'running', context, nodeResults });
    }

    completeWorkflowRun(runId, { status: 'completed', nodeResults });
    workflowEvents.emit('run_complete', {
      runId,
      workflowId,
      status: 'completed',
      nodeResults,
      context,
    });
    activeRuns.delete(runId);
    return { runId, status: 'completed', nodeResults, context };
  } catch (err) {
    const errorMsg = err.message || String(err);
    completeWorkflowRun(runId, { status: 'failed', nodeResults, error: errorMsg });
    workflowEvents.emit('run_complete', { runId, workflowId, status: 'failed', error: errorMsg });
    activeRuns.delete(runId);
    return { runId, status: 'failed', nodeResults, context, error: errorMsg };
  }
}

/**
 * Mark a node and its descendants as skipped (for condition branches).
 * Does NOT skip nodes that have other non-skipped incoming edges from
 * sources other than the skip origin (join nodes with live branches).
 * @param {string} nodeId - node to potentially skip
 * @param {Map} outEdges - adjacency map
 * @param {Set} skipped - accumulated skipped set
 * @param {Array} allEdges - full edge list
 * @param {string} skipSourceId - the condition node that triggered the skip chain
 */
function markDescendantsSkipped(nodeId, outEdges, skipped, allEdges, skipSourceId) {
  if (skipped.has(nodeId)) return;
  // Check if this node has incoming edges from live sources OTHER than the skip origin
  const liveIncomingFromOthers = allEdges.filter(
    (e) => e.to === nodeId && e.from !== skipSourceId && !skipped.has(e.from),
  );
  if (liveIncomingFromOthers.length > 0) return; // join node with live branch -- do not skip
  skipped.add(nodeId);
  for (const edge of outEdges.get(nodeId) || []) {
    markDescendantsSkipped(edge.to, outEdges, skipped, allEdges, skipSourceId);
  }
}

/**
 * Abort a running workflow. Stops the currently executing agent if any.
 * The agent's 'done' event will naturally trigger resolve/reject in runAgentNode,
 * which calls cleanup() to unbind the listener. Do NOT manually off() here.
 */
export function abortWorkflow(runId) {
  const entry = activeRuns.get(runId);
  if (!entry) return false;
  entry.aborted = true;
  if (entry.currentAgentSessionId) {
    stopAgent(entry.currentAgentSessionId);
  }
  return true;
}

/**
 * Get IDs of currently running workflows.
 */
export function getActiveWorkflowRuns() {
  return [...activeRuns.keys()];
}
