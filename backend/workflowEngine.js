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
import { startAgent, agentEvents } from './agentManager.js';
import { createWorkflowRun, updateWorkflowRun, completeWorkflowRun } from './workflowStore.js';

export const workflowEvents = new EventEmitter();

// Active workflow runs: Map<runId, { aborted }>
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
async function executeNode(node, context, runId) {
  const nodeId = node.id;

  workflowEvents.emit('node_start', { runId, nodeId, type: node.type });

  switch (node.type) {
    case 'input': {
      // Input nodes inject their configured variables into context
      const result = { ...context, ...(node.config?.variables || {}) };
      workflowEvents.emit('node_complete', { runId, nodeId, result });
      return result;
    }

    case 'output': {
      // Output nodes just pass through and mark workflow end
      const summary = node.config?.summary
        ? applyTemplate(node.config.summary, context)
        : JSON.stringify(context);
      const result = { summary, context };
      workflowEvents.emit('node_complete', { runId, nodeId, result });
      return result;
    }

    case 'transform': {
      // Apply mapping to context
      const mapping = node.config?.mapping || {};
      const result = { ...context };
      for (const [key, template] of Object.entries(mapping)) {
        result[key] = applyTemplate(template, context);
      }
      workflowEvents.emit('node_complete', { runId, nodeId, result });
      return result;
    }

    case 'agent': {
      // Run a prompt through agentManager and capture result
      const prompt = applyTemplate(node.config.prompt, context);
      const result = await runAgentNode(prompt, node.config, runId, nodeId);
      workflowEvents.emit('node_complete', { runId, nodeId, result });
      return result;
    }

    case 'condition': {
      // Evaluate condition -- result is { branch: true/false }
      const condResult = evaluateCondition(node.config?.expression, context);
      const result = { ...context, _branch: condResult };
      workflowEvents.emit('node_complete', { runId, nodeId, result: { branch: condResult } });
      return result;
    }

    default:
      throw new Error(`Unknown node type: ${node.type}`);
  }
}

/**
 * Run an agent node: start a session and wait for completion.
 */
function runAgentNode(prompt, nodeConfig, runId, nodeId) {
  return new Promise((resolve, reject) => {
    const sessionId = startAgent(prompt, {
      permissionMode: nodeConfig.permissionMode || 'bypassPermissions',
      maxTurns: nodeConfig.maxTurns || 30,
    });

    workflowEvents.emit('agent_started', { runId, nodeId, sessionId });

    let resultText = '';

    function onEvent(event) {
      if (event.sessionId !== sessionId) return;

      // Capture the final assistant text from result
      if (event.type === 'result') {
        resultText = event.content?.result || event.content?.last_assistant_message || '';
      }

      if (event.type === 'done') {
        agentEvents.off('event', onEvent);
        const status = event.content?.status || 'completed';
        if (status === 'completed') {
          resolve({ sessionId, status, output: resultText });
        } else {
          reject(new Error(`Agent node "${nodeId}" ended with status: ${status}`));
        }
      }
    }

    agentEvents.on('event', onEvent);
  });
}

/**
 * Execute a workflow run.
 * @param {string} workflowId
 * @param {object} definition - { nodes, edges }
 * @param {object} [inputContext={}] - Initial context values
 * @returns {Promise<{ runId, status, nodeResults, context }>}
 */
export async function executeWorkflow(workflowId, definition, inputContext = {}) {
  const runId = createWorkflowRun(workflowId, inputContext);
  const { nodes, edges } = definition;

  activeRuns.set(runId, { aborted: false });
  workflowEvents.emit('run_start', { runId, workflowId });

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const sorted = topologicalSort(nodes, edges);
  if (!sorted) {
    completeWorkflowRun(runId, { status: 'failed', nodeResults: {}, error: 'Cycle detected' });
    workflowEvents.emit('run_complete', { runId, status: 'failed', error: 'Cycle detected' });
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

      // Check if all incoming edges are satisfied
      const incomingEdges = edges.filter((e) => e.to === nodeId);
      const allIncomingSatisfied = incomingEdges.every((e) => executed.has(e.from));
      if (incomingEdges.length > 0 && !allIncomingSatisfied) {
        skipped.add(nodeId);
        continue;
      }

      // Execute the node
      const result = await executeNode(node, context, runId);
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
            markDescendantsSkipped(edge.to, outEdges, skipped);
          } else if (edge.condition === 'false' && branch) {
            markDescendantsSkipped(edge.to, outEdges, skipped);
          }
        }
      }

      // Persist progress
      updateWorkflowRun(runId, { status: 'running', context, nodeResults });
    }

    completeWorkflowRun(runId, { status: 'completed', nodeResults });
    workflowEvents.emit('run_complete', { runId, status: 'completed', nodeResults, context });
    activeRuns.delete(runId);
    return { runId, status: 'completed', nodeResults, context };
  } catch (err) {
    const errorMsg = err.message || String(err);
    completeWorkflowRun(runId, { status: 'failed', nodeResults, error: errorMsg });
    workflowEvents.emit('run_complete', { runId, status: 'failed', error: errorMsg });
    activeRuns.delete(runId);
    return { runId, status: 'failed', nodeResults, context, error: errorMsg };
  }
}

/**
 * Mark a node and all its descendants as skipped (for condition branches).
 */
function markDescendantsSkipped(nodeId, outEdges, skipped) {
  if (skipped.has(nodeId)) return;
  skipped.add(nodeId);
  for (const edge of outEdges.get(nodeId) || []) {
    markDescendantsSkipped(edge.to, outEdges, skipped);
  }
}

/**
 * Abort a running workflow.
 */
export function abortWorkflow(runId) {
  const entry = activeRuns.get(runId);
  if (!entry) return false;
  entry.aborted = true;
  return true;
}

/**
 * Get IDs of currently running workflows.
 */
export function getActiveWorkflowRuns() {
  return [...activeRuns.keys()];
}
