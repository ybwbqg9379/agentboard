import { useState, useEffect, useRef, useCallback } from 'react';
import { buildWsUrl, withClientAuth } from '../lib/clientAuth.js';

const API_BASE = '';
const RECONNECT_INTERVAL = 3000;
const MAX_EVENTS = 5000;
const HEARTBEAT_INTERVAL = 30000; // 30s ping to detect silent disconnects

export function useWebSocket() {
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | running | completed | failed | stopped
  const [sessionStats, setSessionStats] = useState(null);
  const [mcpHealth, setMcpHealth] = useState({});
  const [subtasks, setSubtasks] = useState({});
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);
  const heartbeatTimer = useRef(null);
  const sessionIdRef = useRef(null);
  const statusRef = useRef('idle');
  const unmountedRef = useRef(false);

  const connect = useCallback(() => {
    if (unmountedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(buildWsUrl('/ws'));
    wsRef.current = ws;

    ws.onopen = () => {
      if (unmountedRef.current) {
        ws.close();
        return;
      }
      setConnected(true);
      clearTimeout(reconnectTimer.current);
      // Heartbeat: send ping every 30s to detect silent disconnects
      clearInterval(heartbeatTimer.current);
      heartbeatTimer.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send('ping');
        }
      }, HEARTBEAT_INTERVAL);
      // Re-subscribe to the active session after reconnect
      const sid = sessionIdRef.current;
      if (sid && statusRef.current === 'running') {
        ws.send(JSON.stringify({ action: 'subscribe', sessionId: sid }));
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
            const updated = {
              ...entry,
              toolCalls: entry.toolCalls + 1,
              toolErrors: entry.toolErrors + (success ? 0 : 1),
              state: success ? 'connected' : entry.toolErrors >= 2 ? 'failed' : 'degraded',
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
    }
  }, []);

  const startAgent = useCallback(
    (prompt, opts = {}) => {
      setStatus('running');
      send({ action: 'start', prompt, permissionMode: opts.permissionMode });
    },
    [send],
  );

  const followUp = useCallback(
    (prompt, opts = {}) => {
      setStatus('running');
      send({
        action: 'follow_up',
        prompt,
        sessionId: sessionIdRef.current,
        permissionMode: opts.permissionMode,
      });
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
  };
}
