import { useState, useEffect, useRef, useCallback } from 'react';
import { buildWsUrl, withClientAuth } from '../lib/clientAuth.js';

const API_BASE = '';
const RECONNECT_INTERVAL = 3000;
const MAX_EVENTS = 5000;
const HEARTBEAT_INTERVAL = 30000; // 30s ping to detect silent disconnects
const PONG_TIMEOUT = 45000; // consider connection dead if no message for 45s

export function useWebSocket() {
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | running | completed | failed | stopped
  const [sessionStats, setSessionStats] = useState(null);
  const [mcpHealth, setMcpHealth] = useState({});
  const [subtasks, setSubtasks] = useState({});
  const [experimentRunId, setExperimentRunId] = useState(null);
  const [experimentStatus, setExperimentStatus] = useState('idle');
  const [experimentEvents, setExperimentEvents] = useState([]);
  // P3: Swarm state
  const [swarmBranches, setSwarmBranches] = useState([]); // branch status cards
  const [swarmHypotheses, setSwarmHypotheses] = useState([]); // Coordinator decompose output
  const [swarmStatus, setSwarmStatus] = useState('idle'); // idle | decomposing | running | synthesizing | completed | failed
  const [swarmReasoning, setSwarmReasoning] = useState(null); // Coordinator selection reasoning

  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);
  const heartbeatTimer = useRef(null);
  const sessionIdRef = useRef(null);
  const experimentRunIdRef = useRef(null);
  const statusRef = useRef('idle');
  const unmountedRef = useRef(false);
  const lastMessageTimeRef = useRef(Date.now());

  const connect = useCallback(() => {
    if (unmountedRef.current) return;
    if (
      wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CONNECTING
    )
      return;

    const ws = new WebSocket(buildWsUrl('/ws'));
    wsRef.current = ws;

    ws.onopen = () => {
      if (unmountedRef.current) {
        ws.close();
        return;
      }
      setConnected(true);
      clearTimeout(reconnectTimer.current);
      // Heartbeat: send ping every 30s; force-close if no message received within PONG_TIMEOUT
      clearInterval(heartbeatTimer.current);
      lastMessageTimeRef.current = Date.now();
      heartbeatTimer.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          if (Date.now() - lastMessageTimeRef.current > PONG_TIMEOUT) {
            console.warn('[ws] pong timeout, forcing reconnect');
            ws.close();
            return;
          }
          ws.send('ping');
        }
      }, HEARTBEAT_INTERVAL);
      // Re-subscribe to the active session after reconnect
      const sid = sessionIdRef.current;
      if (sid && statusRef.current === 'running') {
        ws.send(JSON.stringify({ action: 'subscribe', sessionId: sid }));
      }
      if (experimentRunIdRef.current) {
        ws.send(
          JSON.stringify({ action: 'subscribe_experiment', runId: experimentRunIdRef.current }),
        );
      }
    };

    ws.onclose = () => {
      setConnected(false);
      clearInterval(heartbeatTimer.current);
      if (!unmountedRef.current) {
        reconnectTimer.current = setTimeout(connect, RECONNECT_INTERVAL);
      }
    };

    ws.onerror = () => {
      ws.close();
    };

    ws.onmessage = (e) => {
      lastMessageTimeRef.current = Date.now();
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }

      if (msg.type === 'session_started') {
        sessionIdRef.current = msg.sessionId;
        statusRef.current = 'running';
        setSessionId(msg.sessionId);
        setStatus('running');
        setEvents([]);
        setSessionStats(null);
        return;
      }

      if (msg.type === 'session_resumed') {
        if (msg.sessionId) {
          sessionIdRef.current = msg.sessionId;
          setSessionId(msg.sessionId);
        }
        statusRef.current = 'running';
        setStatus('running');
        return;
      }

      if (msg.type === 'subscribed') {
        sessionIdRef.current = msg.sessionId;
        setSessionId(msg.sessionId);
        return;
      }

      if (msg.type === 'unsubscribed') {
        return;
      }

      if (msg.type === 'experiment_subscribed') {
        experimentRunIdRef.current = msg.runId;
        setExperimentRunId(msg.runId);
        return;
      }

      if (msg.type === 'experiment_unsubscribed') {
        experimentRunIdRef.current = null;
        setExperimentRunId(null);
        setExperimentStatus('idle');
        return;
      }

      if (msg.type === 'experiment') {
        if (msg.subtype === 'experiment_start') {
          setExperimentStatus('running');
        } else if (
          msg.subtype === 'experiment_done' ||
          msg.subtype === 'experiment_error' ||
          msg.subtype === 'budget_exhausted'
        ) {
          setExperimentStatus(msg.subtype === 'experiment_error' ? 'failed' : 'completed');
        }

        setExperimentEvents((prev) => {
          const next = [...prev, msg];
          return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
        });
        return;
      }

      // P3: Swarm events (type === 'swarm') — share the same subscription runId
      if (msg.type === 'swarm') {
        const c = msg.content || {};
        switch (msg.subtype) {
          case 'swarm_decompose_start':
            setSwarmStatus('decomposing');
            setSwarmBranches([]);
            setSwarmHypotheses([]);
            setSwarmReasoning(null);
            break;
          case 'swarm_hypothesis':
            if (c.hypothesis) {
              setSwarmHypotheses((prev) => [
                ...prev,
                { id: c.hypothesis.id, text: c.hypothesis.text },
              ]);
            }
            break;
          case 'swarm_branch_start':
            setSwarmStatus('running');
            setSwarmBranches((prev) => {
              const exists = prev.find((b) => b.branchIndex === c.branchIndex);
              if (exists) return prev;
              return [
                ...prev,
                {
                  branchId: c.branchId,
                  branchIndex: c.branchIndex,
                  hypothesis: c.hypothesis,
                  status: 'running',
                  bestMetric: null,
                  totalTrials: 0,
                  acceptedTrials: 0,
                },
              ];
            });
            break;
          case 'swarm_branch_complete':
            setSwarmBranches((prev) =>
              prev.map((b) =>
                b.branchIndex === c.branchIndex
                  ? {
                      ...b,
                      status: c.error ? 'failed' : 'completed',
                      bestMetric: c.bestMetric ?? null,
                      totalTrials: c.totalTrials ?? b.totalTrials,
                      acceptedTrials: c.acceptedTrials ?? b.acceptedTrials,
                      error: c.error,
                    }
                  : b,
              ),
            );
            break;
          case 'swarm_synthesize_start':
            setSwarmStatus('synthesizing');
            break;
          case 'swarm_branch_selected':
            setSwarmBranches((prev) =>
              prev.map((b) => ({
                ...b,
                isSelected: b.branchIndex === c.selectedBranchIndex,
              })),
            );
            setSwarmReasoning(c.reasoning || null);
            break;
          case 'swarm_complete':
            setSwarmStatus('completed');
            break;
          case 'swarm_error':
            setSwarmStatus('failed');
            break;
          default:
            break;
        }
        // Also append swarm events to the experiment event log for the timeline
        setExperimentEvents((prev) => {
          const next = [...prev, msg];
          return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
        });
        return;
      }

      if (msg.type === 'pong') {
        return;
      }

      if (msg.type === 'done') {
        const finalStatus = msg.content?.status || 'completed';
        statusRef.current = finalStatus;
        setStatus(finalStatus);
        return;
      }

      if (msg.error) {
        return;
      }

      // Extract session stats and MCP health from init and result messages
      if (msg.type === 'system' && (msg.subtype === 'init' || msg.content?.subtype === 'init')) {
        const c = msg.content;
        setSessionStats((prev) => ({
          ...prev,
          model: c?.model || null,
          tools: c?.tools?.length || 0,
          mcpServers: c?.mcp_servers?.length || 0,
        }));
        // Initialize MCP health from init message
        if (Array.isArray(c?.mcp_servers)) {
          const health = {};
          for (const s of c.mcp_servers) {
            const name = typeof s === 'string' ? s : s.name || String(s);
            health[name] = { state: 'connected', toolCalls: 0, toolErrors: 0 };
          }
          setMcpHealth(health);
        }
      }
      // Track MCP tool outcomes from hook events
      if (
        msg.type === 'system' &&
        (msg.subtype === 'tool_complete' || msg.subtype === 'tool_failed')
      ) {
        const toolName = msg.content?.tool;
        if (toolName?.startsWith('mcp__')) {
          const serverName = toolName.split('__')[1];
          const success = msg.subtype === 'tool_complete';
          setMcpHealth((prev) => {
            const entry = prev[serverName];
            if (!entry) return prev;
            const newErrorCount = entry.toolErrors + (success ? 0 : 1);
            const updated = {
              ...entry,
              toolCalls: entry.toolCalls + 1,
              toolErrors: newErrorCount,
              state: success ? 'connected' : newErrorCount >= 3 ? 'failed' : 'degraded',
            };
            return { ...prev, [serverName]: updated };
          });
        }
      }
      if (msg.type === 'result') {
        const c = msg.content;
        setSessionStats((prev) => ({
          ...prev,
          cost_usd: c?.total_cost_usd || 0,
          input_tokens: c?.usage?.input_tokens || 0,
          output_tokens: c?.usage?.output_tokens || 0,
          cache_read_tokens: c?.usage?.cache_read_input_tokens || c?.usage?.cache_read_tokens || 0,
          duration_ms: c?.duration_ms || 0,
          num_turns: c?.num_turns || 0,
        }));
      }

      // Track subtasks from task lifecycle messages
      const sub = msg.subtype || msg.content?.subtype;
      if (msg.type === 'system' && sub === 'task_started' && msg.content?.task_id) {
        setSubtasks((prev) => ({
          ...prev,
          [msg.content.task_id]: {
            description: msg.content.description || '',
            status: 'running',
            startedAt: msg.timestamp || Date.now(),
          },
        }));
      }
      if (msg.type === 'system' && sub === 'task_notification' && msg.content?.task_id) {
        setSubtasks((prev) => ({
          ...prev,
          [msg.content.task_id]: {
            ...(prev[msg.content.task_id] || {}),
            status: msg.content.status || 'completed',
            summary: msg.content.summary || '',
          },
        }));
      }

      setEvents((prev) => {
        const next = [...prev, msg];
        return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
      });
    };
  }, []);

  useEffect(() => {
    unmountedRef.current = false;
    connect();
    return () => {
      unmountedRef.current = true;
      clearTimeout(reconnectTimer.current);
      clearInterval(heartbeatTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((data) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
      return true;
    }
    return false;
  }, []);

  const startAgent = useCallback(
    (prompt, opts = {}) => {
      if (send({ action: 'start', prompt, permissionMode: opts.permissionMode })) {
        setStatus('running');
      }
    },
    [send],
  );

  const followUp = useCallback(
    (prompt, opts = {}) => {
      if (
        send({
          action: 'follow_up',
          prompt,
          sessionId: sessionIdRef.current,
          permissionMode: opts.permissionMode,
        })
      ) {
        setStatus('running');
      }
    },
    [send],
  );

  // Load a past session from REST API into the current view
  const loadSession = useCallback(async (sid) => {
    try {
      const res = await fetch(`${API_BASE}/api/sessions/${sid}`, withClientAuth());
      if (!res.ok) return;
      const data = await res.json();
      sessionIdRef.current = sid;
      setSessionId(sid);
      // Convert stored events to the format useWebSocket expects
      const restored = (data.events || []).map((e) => ({
        sessionId: sid,
        type: e.type,
        subtype: e.content?.subtype || null,
        content: e.content,
        timestamp: e.timestamp,
      }));
      setEvents(restored);
      const finalStatus = data.status || 'completed';
      statusRef.current = finalStatus;
      setStatus(finalStatus);
      // Subscribe to live events if the session is still running
      if (finalStatus === 'running') {
        send({ action: 'subscribe', sessionId: sid });
      }
      // Restore stats
      if (data.stats) {
        try {
          const st = typeof data.stats === 'string' ? JSON.parse(data.stats) : data.stats;
          setSessionStats(st);
        } catch {
          /* ignore */
        }
      }
      setSubtasks({});
    } catch {
      /* ignore */
    }
  }, []);

  const stopAgent = useCallback(() => {
    send({ action: 'stop', sessionId: sessionIdRef.current });
  }, [send]);

  const clearSession = useCallback(() => {
    send({ action: 'unsubscribe' });
    sessionIdRef.current = null;
    statusRef.current = 'idle';
    setEvents([]);
    setSessionId(null);
    setStatus('idle');
    setSessionStats(null);
    setMcpHealth({});
    setSubtasks({});
  }, [send]);

  const subscribeExperiment = useCallback(
    (runId, expId) => {
      send({ action: 'subscribe_experiment', runId, experimentId: expId });
      experimentRunIdRef.current = runId;
      setExperimentRunId(runId);
      setExperimentEvents([]);
      setExperimentStatus('running');
      // Reset swarm state for new subscription
      setSwarmBranches([]);
      setSwarmHypotheses([]);
      setSwarmStatus('idle');
      setSwarmReasoning(null);
    },
    [send],
  );

  const unsubscribeExperiment = useCallback(() => {
    send({ action: 'unsubscribe_experiment' });
    experimentRunIdRef.current = null;
    setExperimentRunId(null);
    setExperimentStatus('idle');
    setExperimentEvents([]);
    setSwarmBranches([]);
    setSwarmHypotheses([]);
    setSwarmStatus('idle');
    setSwarmReasoning(null);
  }, [send]);

  const loadExperimentRunsEvents = useCallback(
    async (runId, expId) => {
      try {
        const res = await fetch(
          `${API_BASE}/api/experiment-runs/${runId}/trials`,
          withClientAuth(),
        );
        if (!res.ok) return;
        const data = await res.json();

        const trials = data.trials || [];
        const restoredEvents = trials.map((t) => ({
          type: 'experiment',
          subtype: 'trial_complete',
          content: {
            trialNumber: t.trial_number,
            accepted: t.accepted,
            metric: t.primary_metric,
            diff: t.diff,
            reason: t.reason,
          },
          timestamp: new Date(t.created_at).getTime(),
        }));

        // Fetch actual run status so failed/aborted runs display correctly
        let runStatus = 'completed';
        try {
          const statusRes = await fetch(
            `${API_BASE}/api/experiment-runs/${runId}`,
            withClientAuth(),
          );
          if (statusRes.ok) {
            const runData = await statusRes.json();
            runStatus = runData.status || 'completed';
          }
        } catch {
          /* use default */
        }

        // Set history events and runId directly WITHOUT calling subscribeExperiment
        // (which would clear experimentEvents and incorrectly set status to 'running')
        experimentRunIdRef.current = runId;
        setExperimentRunId(runId);
        setExperimentEvents(restoredEvents);
        setExperimentStatus(runStatus);

        // Subscribe for live updates only if the run is still active
        if (runStatus === 'running') {
          send({ action: 'subscribe_experiment', runId, experimentId: expId });
        }
      } catch {
        /* ignore */
      }
    },
    [send],
  );

  // P3: Run a swarm for an experiment
  const runSwarm = useCallback(
    async (experimentId, swarmOverride = {}) => {
      try {
        const res = await fetch(
          `${API_BASE}/api/experiments/${experimentId}/swarm`,
          withClientAuth({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ swarm: swarmOverride }),
          }),
        );
        if (!res.ok) return null;
        const data = await res.json();
        if (data.runId) {
          send({ action: 'subscribe_experiment', runId: data.runId, experimentId });
          experimentRunIdRef.current = data.runId;
          setExperimentRunId(data.runId);
          setExperimentEvents([]);
          setExperimentStatus('running');
          setSwarmBranches([]);
          setSwarmHypotheses([]);
          setSwarmStatus('decomposing');
          setSwarmReasoning(null);
        }
        return data;
      } catch {
        return null;
      }
    },
    [send],
  );

  // P3: Abort a running swarm
  const abortSwarmRun = useCallback(async (runId) => {
    try {
      await fetch(
        `${API_BASE}/api/experiment-runs/${runId}/abort-swarm`,
        withClientAuth({ method: 'POST' }),
      );
    } catch {
      // Best-effort
    }
  }, []);

  // P3: Load swarm branches for a completed run (restore from DB)
  const loadSwarmBranches = useCallback(async (runId) => {
    try {
      const res = await fetch(
        `${API_BASE}/api/experiment-runs/${runId}/branches`,
        withClientAuth(),
      );
      if (!res.ok) return;
      const data = await res.json();
      const branches = (data.branches || []).map((b) => ({
        branchId: b.id,
        branchIndex: b.branch_index,
        hypothesis: b.hypothesis,
        status: b.status,
        bestMetric: b.best_metric,
        totalTrials: b.total_trials,
        acceptedTrials: b.accepted_trials,
        isSelected: Boolean(b.is_selected),
      }));
      setSwarmBranches(branches);
      if (branches.length > 0) {
        const selected = branches.find((b) => b.isSelected);
        setSwarmStatus(
          selected
            ? 'completed'
            : branches.some((b) => b.status === 'running')
              ? 'running'
              : 'completed',
        );
      }
    } catch {
      // Silent
    }
  }, []);

  return {
    connected,
    events,
    sessionId,
    status,
    startAgent,
    followUp,
    stopAgent,
    clearSession,
    loadSession,
    sessionStats,
    mcpHealth,
    subtasks,
    experimentRunId,
    experimentStatus,
    experimentEvents,
    subscribeExperiment,
    unsubscribeExperiment,
    loadExperimentRunsEvents,
    // P3 swarm
    swarmBranches,
    swarmHypotheses,
    swarmStatus,
    swarmReasoning,
    runSwarm,
    abortSwarmRun,
    loadSwarmBranches,
    sendRaw: send,
  };
}
