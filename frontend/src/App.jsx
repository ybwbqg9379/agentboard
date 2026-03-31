import { useWebSocket } from './hooks/useWebSocket.js';
import Header from './components/Header.jsx';
import ChatInput from './components/ChatInput.jsx';
import AgentTimeline from './components/AgentTimeline.jsx';
import TerminalView from './components/TerminalView.jsx';
import StatusBar from './components/StatusBar.jsx';

export default function App() {
  const { connected, events, sessionId, status, startAgent, stopAgent, clearSession } =
    useWebSocket();

  return (
    <div className="app-layout">
      <Header connected={connected} sessionId={sessionId} onClear={clearSession} />

      <div className="main-content">
        <div className="left-panel">
          <AgentTimeline events={events} status={status} />
          <ChatInput onSend={startAgent} onStop={stopAgent} status={status} />
        </div>
        <TerminalView events={events} />
      </div>

      <StatusBar status={status} sessionId={sessionId} eventCount={events.length} />
    </div>
  );
}
