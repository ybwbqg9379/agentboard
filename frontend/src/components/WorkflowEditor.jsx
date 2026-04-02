import { useState, useRef, useCallback, useEffect, useId } from 'react';
import styles from './WorkflowEditor.module.css';
import Dropdown from './Dropdown';
import ConfirmDialog from './ConfirmDialog.jsx';
import { buildWsUrl, withClientAuth } from '../lib/clientAuth.js';
import {
  EDGE_CONDITION_OPTIONS,
  createEdge,
  edgeMatches,
  getEdgeKey,
  isConditionEdgeSource,
  removeEdge,
  updateEdge,
  ensureEdgeIds,
  syncEdgeIdCounter,
  resetEdgeIdCounter,
  getDefaultEdgeCondition,
} from './workflowEdgeUtils.js';

const API_BASE = '';

const NODE_W = 160;
const NODE_H = 56;
const PORT_R = 5;

const NODE_COLORS = {
  input: { fill: 'var(--bg-tertiary)', stroke: 'var(--status-tool)' },
  output: { fill: 'var(--bg-tertiary)', stroke: 'var(--status-done)' },
  agent: { fill: 'var(--bg-tertiary)', stroke: 'var(--status-running)' },
  condition: { fill: 'var(--bg-tertiary)', stroke: 'var(--status-thinking)' },
  transform: { fill: 'var(--bg-tertiary)', stroke: 'var(--status-tool)' },
  experiment: { fill: 'var(--bg-tertiary)', stroke: 'var(--bg-accent, #007aff)' },
};

const DEFAULT_CONFIGS = {
  input: { variables: {} },
  output: { summary: '{{result}}' },
  agent: { prompt: '', permissionMode: 'bypassPermissions', maxTurns: 30 },
  condition: { expression: '' },
  transform: { mapping: {} },
  experiment: { experimentId: '' },
};

let nextId = 1;
function genId() {
  return `node_${nextId++}`;
}

// --- SVG helpers ---

function edgePath(x1, y1, x2, y2) {
  const dx = Math.abs(x2 - x1) * 0.5;
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

// --- Node Config Panel ---

const PERMISSION_MODES = [
  { value: 'bypassPermissions', label: 'Bypass' },
  { value: 'acceptEdits', label: 'Accept Edits' },
  { value: 'default', label: 'Default' },
  { value: 'plan', label: 'Plan' },
];

function JsonTextarea({ value, onChange, placeholder }) {
  const [text, setText] = useState(() => JSON.stringify(value || {}, null, 2));
  const prevValueRef = useRef(value);

  useEffect(() => {
    if (prevValueRef.current !== value) {
      prevValueRef.current = value;
      try {
        const current = JSON.parse(text);
        if (JSON.stringify(current) !== JSON.stringify(value)) {
          setText(JSON.stringify(value || {}, null, 2));
        }
      } catch {
        setText(JSON.stringify(value || {}, null, 2));
      }
    }
  }, [value, text]);

  return (
    <textarea
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        try {
          onChange(JSON.parse(text));
        } catch {
          setText(JSON.stringify(value || {}, null, 2));
        }
      }}
      placeholder={placeholder}
    />
  );
}

function NodeConfigPanel({ node, onUpdate, onDelete, onClose }) {
  if (!node) return null;

  const updateConfig = (key, value) => {
    onUpdate(node.id, { config: { ...node.config, [key]: value } });
  };

  return (
    <div className={styles.configPanel}>
      <div className={styles.configHeader}>
        <span className={styles.configTitle}>
          {node.type.toUpperCase()}: {node.label}
        </span>
        <button className={styles.configClose} onClick={onClose}>
          x
        </button>
      </div>
      <div className={styles.configBody}>
        <div className={styles.configField}>
          <label>Label</label>
          <input
            value={node.label || ''}
            onChange={(e) => onUpdate(node.id, { label: e.target.value })}
          />
        </div>

        {node.type === 'agent' && (
          <>
            <div className={styles.configField}>
              <label>Prompt</label>
              <textarea
                value={node.config?.prompt || ''}
                onChange={(e) => updateConfig('prompt', e.target.value)}
                placeholder="Agent prompt. Use {{key}} for context variables."
              />
            </div>
            <div className={styles.configField}>
              <label>Max Turns</label>
              <input
                type="number"
                value={node.config?.maxTurns || 30}
                onChange={(e) => updateConfig('maxTurns', parseInt(e.target.value) || 30)}
                min={1}
                max={200}
              />
            </div>
            <div className={styles.configField}>
              <label>Permission Mode</label>
              <Dropdown
                options={PERMISSION_MODES}
                value={node.config?.permissionMode || 'bypassPermissions'}
                onChange={(val) => updateConfig('permissionMode', val)}
                direction="down"
              />
            </div>
          </>
        )}

        {node.type === 'condition' && (
          <div className={styles.configField}>
            <label>Expression</label>
            <input
              value={node.config?.expression || ''}
              onChange={(e) => updateConfig('expression', e.target.value)}
              placeholder='e.g. status == "success"'
            />
          </div>
        )}

        {node.type === 'transform' && (
          <div className={styles.configField}>
            <label>Mapping (JSON)</label>
            <JsonTextarea
              value={node.config?.mapping}
              onChange={(parsed) => updateConfig('mapping', parsed)}
              placeholder='{"key": "{{source}}"}'
            />
          </div>
        )}

        {node.type === 'output' && (
          <div className={styles.configField}>
            <label>Summary Template</label>
            <input
              value={node.config?.summary || ''}
              onChange={(e) => updateConfig('summary', e.target.value)}
              placeholder="{{result}}"
            />
          </div>
        )}

        {node.type === 'experiment' && (
          <div className={styles.configField}>
            <label>Experiment ID (UUID)</label>
            <input
              value={node.config?.experimentId || ''}
              onChange={(e) => updateConfig('experimentId', e.target.value)}
              placeholder="paste UUID from Experiment tab"
            />
          </div>
        )}

        <button className={`${styles.deleteBtn}`} onClick={() => onDelete(node.id)}>
          Delete Node
        </button>
      </div>
    </div>
  );
}

function EdgeConfigPanel({ edge, sourceNode, targetNode, onUpdate, onDelete, onClose }) {
  if (!edge) return null;

  const sourceLabel = sourceNode?.label || edge.from;
  const targetLabel = targetNode?.label || edge.to;
  const canConfigureBranch = isConditionEdgeSource(sourceNode);

  return (
    <div className={styles.configPanel}>
      <div className={styles.configHeader}>
        <span className={styles.configTitle}>
          EDGE: {sourceLabel} {'->'} {targetLabel}
        </span>
        <button className={styles.configClose} onClick={onClose}>
          x
        </button>
      </div>
      <div className={styles.configBody}>
        <div className={styles.configField}>
          <label>From</label>
          <input value={sourceLabel} readOnly />
        </div>
        <div className={styles.configField}>
          <label>To</label>
          <input value={targetLabel} readOnly />
        </div>
        {canConfigureBranch ? (
          <div className={styles.configField}>
            <label>Branch</label>
            <Dropdown
              options={EDGE_CONDITION_OPTIONS}
              value={edge.condition || ''}
              onChange={(value) => onUpdate({ condition: value })}
              direction="down"
            />
          </div>
        ) : (
          <div className={styles.edgeHint}>
            Only edges leaving a condition node can be tagged as `true` or `false`.
          </div>
        )}
        <button className={styles.deleteBtn} onClick={onDelete}>
          Delete Edge
        </button>
      </div>
    </div>
  );
}

// --- Main Editor ---

export default function WorkflowEditor() {
  const svgIdPrefix = useId();
  const arrowheadId = `${svgIdPrefix}-arrowhead`;
  const gridId = `${svgIdPrefix}-grid`;
  const [workflows, setWorkflows] = useState([]);
  const [currentWorkflow, setCurrentWorkflow] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [workflowName, setWorkflowName] = useState('New Workflow');
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [draggingNode, setDraggingNode] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [drawingEdge, setDrawingEdge] = useState(null); // { fromId, mx, my }
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [runStatus, setRunStatus] = useState(null); // null | 'running' | 'completed' | 'failed'
  const [activeNodes, setActiveNodes] = useState(new Set());
  const [isEditing, setIsEditing] = useState(false);
  const [wfSelected, setWfSelected] = useState(new Set());
  const [wfConfirm, setWfConfirm] = useState(null); // { ids, message }
  const svgRef = useRef(null);

  // Fetch workflow list
  const fetchWorkflows = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/workflows`, withClientAuth());
      if (res.ok) {
        const data = await res.json();
        setWorkflows(data.workflows || []);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchWorkflows();
  }, [fetchWorkflows]);

  // Load a workflow
  const loadWorkflow = useCallback((wf) => {
    setCurrentWorkflow(wf.id);
    setWorkflowName(wf.name);
    const loadedNodes = wf.definition.nodes || [];
    const loadedEdges = ensureEdgeIds(wf.definition.edges || []);
    setNodes(loadedNodes);
    setEdges(loadedEdges);
    setSelectedNode(null);
    setSelectedEdge(null);
    setRunStatus(null);
    setActiveNodes(new Set());
    setIsEditing(true);
    // Sync nextId to avoid collisions with existing node ids
    let maxNum = 0;
    for (const n of loadedNodes) {
      const match = n.id.match(/^node_(\d+)$/);
      if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
    }
    nextId = maxNum + 1;
    syncEdgeIdCounter(loadedEdges);
  }, []);

  // Create new workflow
  const newWorkflow = useCallback(() => {
    nextId = 1;
    resetEdgeIdCounter();
    const inputNode = {
      id: genId(),
      type: 'input',
      label: 'Start',
      config: DEFAULT_CONFIGS.input,
      position: { x: 100, y: 200 },
    };
    const outputNode = {
      id: genId(),
      type: 'output',
      label: 'End',
      config: DEFAULT_CONFIGS.output,
      position: { x: 500, y: 200 },
    };
    setCurrentWorkflow(null);
    setWorkflowName('New Workflow');
    setNodes([inputNode, outputNode]);
    setEdges([createEdge(inputNode.id, outputNode.id, inputNode, [])]);
    setSelectedNode(null);
    setSelectedEdge(null);
    setRunStatus(null);
    setActiveNodes(new Set());
    setIsEditing(true);
  }, []);

  // Add node
  const addNode = useCallback(
    (type) => {
      const id = genId();
      const node = {
        id,
        type,
        label: type.charAt(0).toUpperCase() + type.slice(1),
        config: { ...DEFAULT_CONFIGS[type] },
        position: { x: 300 - pan.x + Math.random() * 60, y: 200 - pan.y + Math.random() * 60 },
      };
      setNodes((prev) => [...prev, node]);
      setSelectedNode(id);
      setSelectedEdge(null);
    },
    [pan],
  );

  // Update node
  const updateNode = useCallback((id, updates) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...updates } : n)));
  }, []);

  // Delete node
  const deleteNode = useCallback(
    (id) => {
      setNodes((prev) => prev.filter((n) => n.id !== id));
      setEdges((prev) => prev.filter((e) => e.from !== id && e.to !== id));
      if (selectedNode === id) setSelectedNode(null);
      if (selectedEdge && (selectedEdge.from === id || selectedEdge.to === id)) {
        setSelectedEdge(null);
      }
    },
    [selectedEdge, selectedNode],
  );

  const updateSelectedEdge = useCallback(
    (updates) => {
      setEdges((prev) => updateEdge(prev, selectedEdge, updates));
    },
    [selectedEdge],
  );

  const deleteSelectedEdge = useCallback(() => {
    if (!selectedEdge) return;
    setEdges((prev) => removeEdge(prev, selectedEdge));
    setSelectedEdge(null);
  }, [selectedEdge]);

  // Save workflow -- returns the workflow id
  const saveWorkflow = useCallback(async () => {
    const definition = { nodes, edges };
    try {
      if (currentWorkflow) {
        const putRes = await fetch(
          `${API_BASE}/api/workflows/${currentWorkflow}`,
          withClientAuth({
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: workflowName, description: '', definition }),
          }),
        );
        if (!putRes.ok) return null;
        fetchWorkflows();
        return currentWorkflow;
      } else {
        const res = await fetch(
          `${API_BASE}/api/workflows`,
          withClientAuth({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: workflowName, description: '', definition }),
          }),
        );
        if (res.ok) {
          const data = await res.json();
          setCurrentWorkflow(data.id);
          fetchWorkflows();
          return data.id;
        }
      }
    } catch {
      /* ignore */
    }
    return null;
  }, [nodes, edges, workflowName, currentWorkflow, fetchWorkflows]);

  // Dedicated workflow event socket for run-scoped subscriptions.
  const wsRef = useRef(null);
  const pendingWorkflowSubscriptionsRef = useRef(new Map());
  const reconnectTimerRef = useRef(null);
  const workflowHeartbeatRef = useRef(null);
  const wfLastMessageRef = useRef(Date.now());
  const workflowSocketDisposedRef = useRef(false);
  const connectWorkflowSocketRef = useRef(() => null);
  const activeRunIdRef = useRef(null);
  const activeWorkflowIdRef = useRef(null);

  const rejectPendingWorkflowSubscriptions = useCallback((message) => {
    for (const [runId, pending] of pendingWorkflowSubscriptionsRef.current) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error(message));
      pendingWorkflowSubscriptionsRef.current.delete(runId);
    }
  }, []);

  const waitForWorkflowSocket = useCallback(() => {
    let ws = wsRef.current;
    if (!ws || ws.readyState === WebSocket.CLOSED) {
      ws = connectWorkflowSocketRef.current();
    }
    if (!ws) {
      return Promise.reject(new Error('workflow socket not initialized'));
    }
    if (ws.readyState === WebSocket.OPEN) {
      return Promise.resolve(ws);
    }
    if (ws.readyState === WebSocket.CLOSED) {
      return Promise.reject(new Error('workflow socket closed'));
    }

    return new Promise((resolve, reject) => {
      const onOpen = () => {
        cleanup();
        resolve(ws);
      };
      const onError = () => {
        cleanup();
        reject(new Error('workflow socket failed to connect'));
      };
      const onClose = () => {
        cleanup();
        reject(new Error('workflow socket closed'));
      };
      const cleanup = () => {
        clearTimeout(timeoutId);
        ws.removeEventListener('open', onOpen);
        ws.removeEventListener('error', onError);
        ws.removeEventListener('close', onClose);
      };
      const timeoutId = window.setTimeout(() => {
        cleanup();
        reject(new Error('workflow socket connection timeout'));
      }, 3000);

      ws.addEventListener('open', onOpen);
      ws.addEventListener('error', onError);
      ws.addEventListener('close', onClose);
    });
  }, []);

  const subscribeWorkflowRun = useCallback(
    async (workflowId, runId) => {
      const ws = await waitForWorkflowSocket();
      await new Promise((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
          pendingWorkflowSubscriptionsRef.current.delete(runId);
          reject(new Error('workflow subscription timeout'));
        }, 3000);

        pendingWorkflowSubscriptionsRef.current.set(runId, {
          resolve,
          reject,
          timeoutId,
        });
        ws.send(JSON.stringify({ action: 'subscribe_workflow', workflowId, runId }));
      });
    },
    [waitForWorkflowSocket],
  );

  // Run workflow
  const runWorkflow = useCallback(async () => {
    const wfId = currentWorkflow || (await saveWorkflow());
    if (!wfId) return;
    setRunStatus('running');
    setActiveNodes(new Set());
    const runId =
      globalThis.crypto?.randomUUID?.() ||
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

    try {
      activeWorkflowIdRef.current = wfId;
      activeRunIdRef.current = runId;
      // Best-effort subscribe -- do not block execution on WS ack
      subscribeWorkflowRun(wfId, runId).catch(() => {
        /* WS subscribe failed; run still executes, just no live events */
      });
      const res = await fetch(
        `${API_BASE}/api/workflows/${wfId}/run`,
        withClientAuth({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ context: {}, runId }),
        }),
      );
      if (!res.ok) {
        throw new Error(`workflow start failed: ${res.status}`);
      }
    } catch {
      activeRunIdRef.current = null;
      activeWorkflowIdRef.current = null;
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ action: 'unsubscribe_workflow', runId }));
      }
      setRunStatus('failed');
    }
  }, [currentWorkflow, saveWorkflow, subscribeWorkflowRun]);

  // Listen for workflow events via WebSocket and subscribe to concrete runIds
  // before triggering execution to avoid missing early events.
  useEffect(() => {
    workflowSocketDisposedRef.current = false;

    function scheduleReconnect() {
      if (workflowSocketDisposedRef.current) return;
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = window.setTimeout(() => {
        connectWorkflowSocketRef.current();
      }, 3000);
    }

    function connectWorkflowSocket() {
      const existing = wsRef.current;
      if (
        existing &&
        (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)
      ) {
        return existing;
      }
      if (workflowSocketDisposedRef.current) {
        return null;
      }

      const ws = new WebSocket(buildWsUrl('/ws'));
      wsRef.current = ws;

      ws.onopen = () => {
        clearTimeout(reconnectTimerRef.current);
        clearInterval(workflowHeartbeatRef.current);
        wfLastMessageRef.current = Date.now();
        workflowHeartbeatRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            if (Date.now() - wfLastMessageRef.current > 45_000) {
              ws.close();
              return;
            }
            ws.send('ping');
          }
        }, 30_000);
        if (activeRunIdRef.current && activeWorkflowIdRef.current) {
          ws.send(
            JSON.stringify({
              action: 'subscribe_workflow',
              workflowId: activeWorkflowIdRef.current,
              runId: activeRunIdRef.current,
            }),
          );
        }
      };

      ws.onmessage = (e) => {
        wfLastMessageRef.current = Date.now();
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'workflow_subscribed' && msg.runId) {
            const pending = pendingWorkflowSubscriptionsRef.current.get(msg.runId);
            if (pending) {
              clearTimeout(pending.timeoutId);
              pendingWorkflowSubscriptionsRef.current.delete(msg.runId);
              pending.resolve();
            }
            return;
          }
          if (msg.type === 'workflow_unsubscribed') {
            return;
          }
          if (msg.type !== 'workflow') return;
          const { subtype, content } = msg;
          if (subtype === 'run_start') {
            setRunStatus('running');
            setActiveNodes(new Set());
          }
          if (subtype === 'agent_started') {
            if (content.nodeId) {
              setActiveNodes((prev) => new Set([...prev, content.nodeId]));
            }
          }
          if (subtype === 'node_start') {
            setActiveNodes((prev) => new Set([...prev, content.nodeId]));
          }
          if (subtype === 'node_complete') {
            setActiveNodes((prev) => {
              const next = new Set(prev);
              next.delete(content.nodeId);
              return next;
            });
          }
          if (subtype === 'run_complete') {
            setRunStatus(content.status || 'completed');
            setActiveNodes(new Set());
            activeRunIdRef.current = null;
            activeWorkflowIdRef.current = null;
            if (content.runId && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ action: 'unsubscribe_workflow', runId: content.runId }));
            }
          }
        } catch {
          /* ignore */
        }
      };

      ws.onclose = () => {
        clearInterval(workflowHeartbeatRef.current);
        rejectPendingWorkflowSubscriptions('workflow socket closed');
        if (wsRef.current === ws) {
          wsRef.current = null;
        }
        scheduleReconnect();
      };

      ws.onerror = () => {
        rejectPendingWorkflowSubscriptions('workflow socket error');
      };

      return ws;
    }

    connectWorkflowSocketRef.current = connectWorkflowSocket;
    connectWorkflowSocket();

    return () => {
      workflowSocketDisposedRef.current = true;
      clearTimeout(reconnectTimerRef.current);
      clearInterval(workflowHeartbeatRef.current);
      rejectPendingWorkflowSubscriptions('workflow socket disposed');
      wsRef.current?.close();
      wsRef.current = null;
      connectWorkflowSocketRef.current = () => null;
    };
  }, [rejectPendingWorkflowSubscriptions]);

  // --- Mouse handlers for node dragging ---

  const handleNodeMouseDown = useCallback(
    (e, nodeId) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;
      setDraggingNode(nodeId);
      setIsPanning(false); // Mutual exclusion: drag takes priority over pan
      setSelectedNode(nodeId);
      setSelectedEdge(null);
      const pos = node.position || { x: 0, y: 0 };
      setDragOffset({
        x: e.clientX - pos.x - pan.x,
        y: e.clientY - pos.y - pan.y,
      });
    },
    [nodes, pan],
  );

  const handleCanvasMouseDown = useCallback(
    (e) => {
      if (e.target === svgRef.current || e.target.closest('[data-grid]')) {
        setIsPanning(true);
        setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
        setSelectedNode(null);
        setSelectedEdge(null);
      }
    },
    [pan],
  );

  const handleMouseMove = useCallback(
    (e) => {
      if (draggingNode) {
        const newX = e.clientX - dragOffset.x - pan.x;
        const newY = e.clientY - dragOffset.y - pan.y;
        setNodes((prev) =>
          prev.map((n) => (n.id === draggingNode ? { ...n, position: { x: newX, y: newY } } : n)),
        );
      } else if (drawingEdge) {
        if (!svgRef.current) return;
        const rect = svgRef.current.getBoundingClientRect();
        setDrawingEdge((prev) => ({
          ...prev,
          mx: e.clientX - rect.left - pan.x,
          my: e.clientY - rect.top - pan.y,
        }));
      } else if (isPanning) {
        setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
      }
    },
    [draggingNode, dragOffset, pan, drawingEdge, isPanning, panStart],
  );

  const handleMouseUp = useCallback(
    (e) => {
      if (drawingEdge) {
        // Check if mouse is over a node input port
        if (!svgRef.current) {
          setDrawingEdge(null);
          setIsPanning(false);
          return;
        }
        const rect = svgRef.current.getBoundingClientRect();
        const mx = e.clientX - rect.left - pan.x;
        const my = e.clientY - rect.top - pan.y;
        const target = nodes.find((n) => {
          const pos = n.position || { x: 0, y: 0 };
          const px = pos.x;
          const py = pos.y + NODE_H / 2;
          return Math.hypot(mx - px, my - py) < 15;
        });
        if (target && target.id !== drawingEdge.fromId) {
          const sourceNode = nodes.find((node) => node.id === drawingEdge.fromId);
          // Allow multiple edges from condition nodes to the same target (true/false branches)
          const isCondition = sourceNode?.type === 'condition';
          const exists = edges.some(
            (e) =>
              e.from === drawingEdge.fromId &&
              e.to === target.id &&
              (!isCondition || e.condition === getDefaultEdgeCondition(sourceNode, edges)),
          );
          if (!exists) {
            const nextEdge = createEdge(drawingEdge.fromId, target.id, sourceNode, edges);
            setEdges((prev) => [...prev, nextEdge]);
            setSelectedEdge({ id: nextEdge.id, from: nextEdge.from, to: nextEdge.to });
            setSelectedNode(null);
          }
        }
        setDrawingEdge(null);
      }
      setDraggingNode(null);
      setIsPanning(false);
    },
    [drawingEdge, nodes, edges, pan],
  );

  // Port click to start drawing edge
  const handleOutputPortMouseDown = useCallback(
    (e, nodeId) => {
      e.stopPropagation();
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      setDrawingEdge({
        fromId: nodeId,
        mx: e.clientX - rect.left - pan.x,
        my: e.clientY - rect.top - pan.y,
      });
    },
    [pan],
  );

  // Delete edge on double-click
  const handleEdgeDoubleClick = useCallback((edge) => {
    setEdges((prev) => removeEdge(prev, edge));
    setSelectedEdge((prev) => (edgeMatches(edge, prev) ? null : prev));
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (
          document.activeElement?.tagName === 'INPUT' ||
          document.activeElement?.tagName === 'TEXTAREA'
        ) {
          return;
        }
        if (selectedNode) {
          deleteNode(selectedNode);
        } else if (selectedEdge) {
          setEdges((prev) => removeEdge(prev, selectedEdge));
          setSelectedEdge(null);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedNode, selectedEdge, deleteNode]);

  const selectedNodeObj = nodes.find((n) => n.id === selectedNode);
  const selectedEdgeObj = edges.find((edge) => edgeMatches(edge, selectedEdge)) || null;
  const selectedEdgeSource = selectedEdgeObj
    ? nodes.find((node) => node.id === selectedEdgeObj.from) || null
    : null;
  const selectedEdgeTarget = selectedEdgeObj
    ? nodes.find((node) => node.id === selectedEdgeObj.to) || null
    : null;

  // --- Workflow list view when no workflow is open ---
  if (!isEditing) {
    const wfIsSelectMode = wfSelected.size > 0;

    function toggleWfSelect(id, e) {
      e.stopPropagation();
      setWfSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }

    function toggleWfSelectAll() {
      if (wfSelected.size === workflows.length) {
        setWfSelected(new Set());
      } else {
        setWfSelected(new Set(workflows.map((w) => w.id)));
      }
    }

    function requestWfDeleteSingle(e, wf) {
      e.stopPropagation();
      setWfConfirm({
        ids: [wf.id],
        message: `Delete workflow "${wf.name}"?`,
      });
    }

    function requestWfDeleteBatch() {
      if (wfSelected.size === 0) return;
      setWfConfirm({
        ids: [...wfSelected],
        message: `Delete ${wfSelected.size} workflow${wfSelected.size > 1 ? 's' : ''}?`,
      });
    }

    async function executeWfDelete() {
      if (!wfConfirm) return;
      const { ids } = wfConfirm;
      setWfConfirm(null);
      try {
        if (ids.length === 1) {
          await fetch(`${API_BASE}/api/workflows/${ids[0]}`, withClientAuth({ method: 'DELETE' }));
        } else {
          await fetch(
            `${API_BASE}/api/workflows/batch-delete`,
            withClientAuth({
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ids }),
            }),
          );
        }
        setWorkflows((prev) => prev.filter((w) => !ids.includes(w.id)));
        setWfSelected((prev) => {
          const next = new Set(prev);
          ids.forEach((id) => next.delete(id));
          return next;
        });
      } catch {
        /* ignore */
      }
    }

    return (
      <div className={styles.editor}>
        <div className={styles.toolbar}>
          <button onClick={newWorkflow}>+ New Workflow</button>
          <button onClick={fetchWorkflows}>Refresh</button>
          {workflows.length > 0 && (
            <button onClick={toggleWfSelectAll}>
              {wfSelected.size === workflows.length ? 'Deselect All' : 'Select All'}
            </button>
          )}
          {wfIsSelectMode && (
            <button className={styles.batchDeleteBtn} onClick={requestWfDeleteBatch}>
              Delete ({wfSelected.size})
            </button>
          )}
        </div>
        {workflows.length === 0 ? (
          <div className={styles.emptyState}>
            <span>No workflows yet</span>
            <button onClick={newWorkflow}>Create your first workflow</button>
          </div>
        ) : (
          <div className={styles.workflowList}>
            {workflows.map((wf) => (
              <div
                key={wf.id}
                className={`${styles.workflowItem} ${wfSelected.has(wf.id) ? styles.workflowItemSelected : ''}`}
              >
                <label className={styles.workflowCheckbox} onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={wfSelected.has(wf.id)}
                    onChange={(e) => toggleWfSelect(wf.id, e)}
                  />
                </label>
                <button className={styles.workflowItemContent} onClick={() => loadWorkflow(wf)}>
                  <div className={styles.workflowItemName}>{wf.name}</div>
                  <div className={styles.workflowItemMeta}>
                    {wf.definition?.nodes?.length || 0} nodes / {wf.definition?.edges?.length || 0}{' '}
                    edges
                  </div>
                </button>
                <button
                  className={styles.workflowDeleteBtn}
                  title="Delete workflow"
                  onClick={(e) => requestWfDeleteSingle(e, wf)}
                >
                  🗑
                </button>
              </div>
            ))}
          </div>
        )}

        <ConfirmDialog
          open={!!wfConfirm}
          title="Delete Workflows"
          message={wfConfirm?.message || ''}
          onConfirm={executeWfDelete}
          onCancel={() => setWfConfirm(null)}
        />
      </div>
    );
  }

  return (
    <div className={styles.editor}>
      <div className={styles.toolbar}>
        <button
          onClick={() => {
            setNodes([]);
            setEdges([]);
            setCurrentWorkflow(null);
            setSelectedNode(null);
            setSelectedEdge(null);
            setIsEditing(false);
          }}
        >
          Back
        </button>
        <input
          className={styles.workflowName}
          value={workflowName}
          onChange={(e) => setWorkflowName(e.target.value)}
          placeholder="Workflow name"
        />
        <button onClick={() => addNode('agent')}>+ Agent</button>
        <button onClick={() => addNode('condition')}>+ Condition</button>
        <button onClick={() => addNode('transform')}>+ Transform</button>
        <button onClick={() => addNode('experiment')}>+ Experiment</button>
        <button onClick={saveWorkflow}>Save</button>
        <button className={styles.runBtn} onClick={runWorkflow} disabled={runStatus === 'running'}>
          {runStatus === 'running' ? 'Running...' : 'Run'}
        </button>
        {runStatus && runStatus !== 'running' && (
          <span
            className={`${styles.statusBadge} ${runStatus === 'completed' ? styles.statusCompleted : styles.statusFailed}`}
          >
            {runStatus}
          </span>
        )}
      </div>

      <div
        className={styles.canvas}
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <svg ref={svgRef} className={styles.canvasSvg}>
          <defs>
            <marker
              id={arrowheadId}
              markerWidth="10"
              markerHeight="7"
              refX="10"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" fill="var(--border-secondary)" />
            </marker>
            <pattern id={gridId} width="20" height="20" patternUnits="userSpaceOnUse">
              <circle cx="10" cy="10" r="0.5" fill="var(--text-tertiary)" />
            </pattern>
          </defs>

          <g transform={`translate(${pan.x}, ${pan.y})`}>
            {/* Grid */}
            <rect
              data-grid
              x={-2000}
              y={-2000}
              width={4000}
              height={4000}
              fill={`url(#${gridId})`}
              className={styles.grid}
            />

            {/* Edges */}
            {edges.map((edge) => {
              const from = nodes.find((n) => n.id === edge.from);
              const to = nodes.find((n) => n.id === edge.to);
              if (!from || !to) return null;
              const fromPos = from.position || { x: 0, y: 0 };
              const toPos = to.position || { x: 0, y: 0 };
              const x1 = fromPos.x + NODE_W;
              const y1 = fromPos.y + NODE_H / 2;
              const x2 = toPos.x;
              const y2 = toPos.y + NODE_H / 2;
              const isActive = activeNodes.has(edge.from) || activeNodes.has(edge.to);
              const isSelected = edgeMatches(edge, selectedEdge);
              return (
                <g key={getEdgeKey(edge)}>
                  <path
                    d={edgePath(x1, y1, x2, y2)}
                    className={`${styles.edge} ${isActive ? styles.edgeActive : ''} ${isSelected ? styles.edgeSelected : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedNode(null);
                      setSelectedEdge({ id: edge.id, from: edge.from, to: edge.to });
                    }}
                    onDoubleClick={() => handleEdgeDoubleClick(edge)}
                    style={{ cursor: 'pointer', markerEnd: `url(#${arrowheadId})` }}
                  />
                  {edge.condition && (
                    <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 8} className={styles.edgeLabel}>
                      {edge.condition}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Temp edge while drawing */}
            {drawingEdge &&
              (() => {
                const from = nodes.find((n) => n.id === drawingEdge.fromId);
                if (!from) return null;
                const fromPos = from.position || { x: 0, y: 0 };
                const x1 = fromPos.x + NODE_W;
                const y1 = fromPos.y + NODE_H / 2;
                return (
                  <path
                    d={edgePath(x1, y1, drawingEdge.mx, drawingEdge.my)}
                    className={styles.tempEdge}
                  />
                );
              })()}

            {/* Nodes */}
            {nodes.map((node) => {
              const color = NODE_COLORS[node.type] || NODE_COLORS.agent;
              const isSelected = selectedNode === node.id;
              const isActive = activeNodes.has(node.id);
              const pos = node.position || { x: 0, y: 0 };
              return (
                <g
                  key={node.id}
                  className={`${styles.node} ${isSelected ? styles.nodeSelected : ''}`}
                  transform={`translate(${pos.x}, ${pos.y})`}
                  onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedNode(node.id);
                    setSelectedEdge(null);
                  }}
                >
                  <rect
                    className={styles.nodeBody}
                    width={NODE_W}
                    height={NODE_H}
                    fill={isActive ? color.stroke + '33' : color.fill}
                    stroke={isSelected ? 'var(--text-accent)' : color.stroke}
                  />
                  <text className={styles.nodeLabel} x={NODE_W / 2} y={NODE_H / 2 - 6}>
                    {node.label || node.id}
                  </text>
                  <text className={styles.nodeType} x={NODE_W / 2} y={NODE_H / 2 + 10}>
                    {node.type}
                  </text>
                  {/* Input port (left) */}
                  {node.type !== 'input' && (
                    <circle
                      className={styles.nodePort}
                      cx={0}
                      cy={NODE_H / 2}
                      r={PORT_R}
                      fill={color.stroke}
                      stroke="var(--bg-primary)"
                      strokeWidth={2}
                    />
                  )}
                  {/* Output port (right) */}
                  {node.type !== 'output' && (
                    <circle
                      className={styles.nodePort}
                      cx={NODE_W}
                      cy={NODE_H / 2}
                      r={PORT_R}
                      fill={color.stroke}
                      stroke="var(--bg-primary)"
                      strokeWidth={2}
                      onMouseDown={(e) => handleOutputPortMouseDown(e, node.id)}
                    />
                  )}
                  {/* Active indicator */}
                  {isActive && (
                    <circle
                      cx={NODE_W - 10}
                      cy={10}
                      r={4}
                      fill="var(--status-running)"
                      className="pulse"
                    />
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {selectedEdgeObj ? (
          <EdgeConfigPanel
            edge={selectedEdgeObj}
            sourceNode={selectedEdgeSource}
            targetNode={selectedEdgeTarget}
            onUpdate={updateSelectedEdge}
            onDelete={deleteSelectedEdge}
            onClose={() => setSelectedEdge(null)}
          />
        ) : (
          <NodeConfigPanel
            node={selectedNodeObj}
            onUpdate={updateNode}
            onDelete={deleteNode}
            onClose={() => setSelectedNode(null)}
          />
        )}
      </div>
    </div>
  );
}
