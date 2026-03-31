import { useState, useRef, useCallback, useEffect } from 'react';
import styles from './WorkflowEditor.module.css';
import Dropdown from './Dropdown';

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
};

const DEFAULT_CONFIGS = {
  input: { variables: {} },
  output: { summary: '{{result}}' },
  agent: { prompt: '', permissionMode: 'bypassPermissions', maxTurns: 30 },
  condition: { expression: '' },
  transform: { mapping: {} },
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
            <textarea
              value={JSON.stringify(node.config?.mapping || {}, null, 2)}
              onChange={(e) => {
                try {
                  updateConfig('mapping', JSON.parse(e.target.value));
                } catch {
                  /* ignore invalid JSON while typing */
                }
              }}
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

        <button className={`${styles.deleteBtn}`} onClick={() => onDelete(node.id)}>
          Delete Node
        </button>
      </div>
    </div>
  );
}

// --- Main Editor ---

export default function WorkflowEditor() {
  const [workflows, setWorkflows] = useState([]);
  const [currentWorkflow, setCurrentWorkflow] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [workflowName, setWorkflowName] = useState('New Workflow');
  const [selectedNode, setSelectedNode] = useState(null);
  const [draggingNode, setDraggingNode] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [drawingEdge, setDrawingEdge] = useState(null); // { fromId, mx, my }
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [runStatus, setRunStatus] = useState(null); // null | 'running' | 'completed' | 'failed'
  const [activeNodes, setActiveNodes] = useState(new Set());
  const svgRef = useRef(null);

  // Fetch workflow list
  const fetchWorkflows = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/workflows`);
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
    setNodes(loadedNodes);
    setEdges(wf.definition.edges || []);
    setSelectedNode(null);
    setRunStatus(null);
    setActiveNodes(new Set());
    // Sync nextId to avoid collisions with existing node ids
    let maxNum = 0;
    for (const n of loadedNodes) {
      const match = n.id.match(/^node_(\d+)$/);
      if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
    }
    nextId = maxNum + 1;
  }, []);

  // Create new workflow
  const newWorkflow = useCallback(() => {
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
    setEdges([{ from: inputNode.id, to: outputNode.id }]);
    setSelectedNode(null);
    setRunStatus(null);
    setActiveNodes(new Set());
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
    },
    [selectedNode],
  );

  // Save workflow -- returns the workflow id
  const saveWorkflow = useCallback(async () => {
    const definition = { nodes, edges };
    try {
      if (currentWorkflow) {
        await fetch(`${API_BASE}/api/workflows/${currentWorkflow}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: workflowName, description: '', definition }),
        });
        fetchWorkflows();
        return currentWorkflow;
      } else {
        const res = await fetch(`${API_BASE}/api/workflows`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: workflowName, description: '', definition }),
        });
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

  const rejectPendingWorkflowSubscriptions = useCallback((message) => {
    for (const [runId, pending] of pendingWorkflowSubscriptionsRef.current) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error(message));
      pendingWorkflowSubscriptionsRef.current.delete(runId);
    }
  }, []);

  const waitForWorkflowSocket = useCallback(() => {
    const ws = wsRef.current;
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
    async (runId) => {
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
        ws.send(JSON.stringify({ action: 'subscribe_workflow', runId }));
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
    const runId = globalThis.crypto?.randomUUID?.();
    if (!runId) {
      setRunStatus('failed');
      return;
    }

    try {
      await subscribeWorkflowRun(runId);
      const res = await fetch(`${API_BASE}/api/workflows/${wfId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: {}, runId }),
      });
      if (!res.ok) {
        throw new Error(`workflow start failed: ${res.status}`);
      }
    } catch {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ action: 'unsubscribe_workflow', runId }));
      }
      setRunStatus('failed');
    }
  }, [currentWorkflow, saveWorkflow, subscribeWorkflowRun]);

  // Listen for workflow events via WebSocket and subscribe to concrete runIds
  // before triggering execution to avoid missing early events.
  useEffect(() => {
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (e) => {
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
          if (content.runId && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ action: 'unsubscribe_workflow', runId: content.runId }));
          }
        }
      } catch {
        /* ignore */
      }
    };

    ws.onclose = () => {
      rejectPendingWorkflowSubscriptions('workflow socket closed');
    };

    ws.onerror = () => {
      rejectPendingWorkflowSubscriptions('workflow socket error');
    };

    return () => {
      rejectPendingWorkflowSubscriptions('workflow socket disposed');
      ws.close();
      wsRef.current = null;
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
      setSelectedNode(nodeId);
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
          const exists = edges.some((e) => e.from === drawingEdge.fromId && e.to === target.id);
          if (!exists) {
            setEdges((prev) => [...prev, { from: drawingEdge.fromId, to: target.id }]);
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
  const handleOutputPortMouseDown = useCallback((e, nodeId) => {
    e.stopPropagation();
    const rect = svgRef.current.getBoundingClientRect();
    setDrawingEdge({
      fromId: nodeId,
      mx: e.clientX - rect.left,
      my: e.clientY - rect.top,
    });
  }, []);

  // Delete edge on double-click
  const handleEdgeDoubleClick = useCallback((fromId, toId) => {
    setEdges((prev) => prev.filter((e) => !(e.from === fromId && e.to === toId)));
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (
          selectedNode &&
          document.activeElement?.tagName !== 'INPUT' &&
          document.activeElement?.tagName !== 'TEXTAREA'
        ) {
          deleteNode(selectedNode);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedNode, deleteNode]);

  const selectedNodeObj = nodes.find((n) => n.id === selectedNode);

  // --- Workflow list view when no workflow is open ---
  if (nodes.length === 0 && !currentWorkflow) {
    return (
      <div className={styles.editor}>
        <div className={styles.toolbar}>
          <button onClick={newWorkflow}>+ New Workflow</button>
          <button onClick={fetchWorkflows}>Refresh</button>
        </div>
        {workflows.length === 0 ? (
          <div className={styles.emptyState}>
            <span>No workflows yet</span>
            <button onClick={newWorkflow}>Create your first workflow</button>
          </div>
        ) : (
          <div className={styles.workflowList}>
            {workflows.map((wf) => (
              <div key={wf.id} className={styles.workflowItem} onClick={() => loadWorkflow(wf)}>
                <div className={styles.workflowItemName}>{wf.name}</div>
                <div className={styles.workflowItemMeta}>
                  {wf.definition?.nodes?.length || 0} nodes / {wf.definition?.edges?.length || 0}{' '}
                  edges
                </div>
              </div>
            ))}
          </div>
        )}
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
              id="arrowhead"
              markerWidth="10"
              markerHeight="7"
              refX="10"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" fill="var(--border-secondary)" />
            </marker>
            <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
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
              fill="url(#grid)"
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
              return (
                <g key={`${edge.from}-${edge.to}`}>
                  <path
                    d={edgePath(x1, y1, x2, y2)}
                    className={`${styles.edge} ${isActive ? styles.edgeActive : ''}`}
                    onDoubleClick={() => handleEdgeDoubleClick(edge.from, edge.to)}
                    style={{ cursor: 'pointer' }}
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
                const x1 = from.position.x + NODE_W;
                const y1 = from.position.y + NODE_H / 2;
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

        {/* Node config panel */}
        <NodeConfigPanel
          node={selectedNodeObj}
          onUpdate={updateNode}
          onDelete={deleteNode}
          onClose={() => setSelectedNode(null)}
        />
      </div>
    </div>
  );
}
