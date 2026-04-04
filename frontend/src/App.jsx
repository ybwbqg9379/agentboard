import { useState, useEffect } from 'react';
import { useWebSocket } from './hooks/useWebSocket.js';
import Header from './components/Header.jsx';
import ChatInput from './components/ChatInput.jsx';
import AgentTimeline from './components/AgentTimeline.jsx';
import RightPanel from './components/RightPanel.jsx';
import StatusBar from './components/StatusBar.jsx';
import SessionDrawer from './components/SessionDrawer.jsx';
import WorkflowEditor from './components/WorkflowEditor.jsx';
import ExperimentView from './components/ExperimentView.jsx';

export default function App() {
  const {
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
  } = useWebSocket();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mode, setMode] = useState('agent'); // 'agent' | 'workflow'

  const [theme, setTheme] = useState(() => {
    return (
      window.localStorage.getItem('agentboard-theme') ||
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    );
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    window.localStorage.setItem('agentboard-theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));

  return (
    <div className="app-layout">
      <Header
        connected={connected}
        sessionId={sessionId}
        onClear={clearSession}
        onOpenHistory={() => setDrawerOpen(true)}
        mcpHealth={mcpHealth}
        mode={mode}
        onModeChange={setMode}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      {mode === 'agent' ? (
        <>
          <div className="main-content">
            <div className="left-panel">
              <AgentTimeline events={events} status={status} sessionId={sessionId} />
              <ChatInput
                onSend={startAgent}
                onFollowUp={followUp}
                onStop={stopAgent}
                status={status}
                sessionId={sessionId}
                connected={connected}
              />
            </div>
            <RightPanel events={events} sessionStats={sessionStats} />
          </div>

          <StatusBar
            status={status}
            sessionId={sessionId}
            eventCount={events.length}
            sessionStats={sessionStats}
            subtasks={subtasks}
          />
        </>
      ) : mode === 'workflow' ? (
        <div className="main-content workflow-mode">
          <WorkflowEditor />
        </div>
      ) : (
        <div className="main-content experiment-mode">
          <ExperimentView
            experimentRunId={experimentRunId}
            experimentStatus={experimentStatus}
            experimentEvents={experimentEvents}
            subscribeExperiment={subscribeExperiment}
            unsubscribeExperiment={unsubscribeExperiment}
            loadExperimentRunsEvents={loadExperimentRunsEvents}
            swarmBranches={swarmBranches}
            swarmHypotheses={swarmHypotheses}
            swarmStatus={swarmStatus}
            swarmReasoning={swarmReasoning}
            runSwarm={runSwarm}
            abortSwarmRun={abortSwarmRun}
            loadSwarmBranches={loadSwarmBranches}
          />
        </div>
      )}

      <SessionDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onLoadSession={loadSession}
        currentSessionId={sessionId}
      />
    </div>
  );
}
