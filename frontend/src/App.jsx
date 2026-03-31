import { useState } from 'react';
import { useWebSocket } from './hooks/useWebSocket.js';
import Header from './components/Header.jsx';
import ChatInput from './components/ChatInput.jsx';
import AgentTimeline from './components/AgentTimeline.jsx';
import TerminalView from './components/TerminalView.jsx';
import StatusBar from './components/StatusBar.jsx';
import SessionDrawer from './components/SessionDrawer.jsx';

export default function App() {
  const {
    connected,
    events,
    sessionId,
    status,
    startAgent,
    stopAgent,
    clearSession,
    loadSession,
    sessionStats,
    mcpHealth,
    subtasks,
  } = useWebSocket();

  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="app-layout">
      <Header
        connected={connected}
        sessionId={sessionId}
        onClear={clearSession}
        onOpenHistory={() => setDrawerOpen(true)}
        mcpHealth={mcpHealth}
      />

      <div className="main-content">
        <div className="left-panel">
          <AgentTimeline events={events} status={status} />
          <ChatInput onSend={startAgent} onStop={stopAgent} status={status} />
        </div>
        <TerminalView events={events} />
      </div>

      <StatusBar
        status={status}
        sessionId={sessionId}
        eventCount={events.length}
        sessionStats={sessionStats}
        subtasks={subtasks}
      />

      <SessionDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onLoadSession={loadSession}
        currentSessionId={sessionId}
      />
    </div>
  );
}
