import { useState, useEffect, useRef, useCallback } from 'react';

const WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
const RECONNECT_INTERVAL = 3000;

export function useWebSocket() {
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | running | completed | failed | stopped
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      clearTimeout(reconnectTimer.current);
    };

    ws.onclose = () => {
      setConnected(false);
      reconnectTimer.current = setTimeout(connect, RECONNECT_INTERVAL);
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
        setSessionId(msg.sessionId);
        setStatus('running');
        setEvents([]);
        return;
      }

      if (msg.type === 'subscribed') {
        setSessionId(msg.sessionId);
        return;
      }

      if (msg.type === 'done') {
        setStatus(msg.content?.status || 'completed');
        return;
      }

      if (msg.error) {
        return;
      }

      setEvents((prev) => [...prev, msg]);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((data) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const startAgent = useCallback(
    (prompt) => {
      setStatus('running');
      send({ action: 'start', prompt });
    },
    [send],
  );

  const stopAgent = useCallback(() => {
    send({ action: 'stop', sessionId });
  }, [send, sessionId]);

  const clearSession = useCallback(() => {
    setEvents([]);
    setSessionId(null);
    setStatus('idle');
  }, []);

  return {
    connected,
    events,
    sessionId,
    status,
    startAgent,
    stopAgent,
    clearSession,
  };
}
