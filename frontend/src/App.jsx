import { useEffect, useLayoutEffect, useState } from 'react';
import { useWebSocket } from './hooks/useWebSocket.js';
import { ensureThemePackFontsLoaded } from './themeFontLoader.js';
import {
  applyDocumentAppearance,
  persistAppearance,
  readStoredDensity,
  readStoredTheme,
  readStoredThemePack,
  readStoredUiShell,
} from './themePreferences.js';
import Header from './components/Header.jsx';
import ChatInput from './components/ChatInput.jsx';
import AgentTimeline from './components/AgentTimeline.jsx';
import RightPanel from './components/RightPanel.jsx';
import StatusBar from './components/StatusBar.jsx';
import SessionDrawer from './components/SessionDrawer.jsx';
import WorkflowEditor from './components/WorkflowEditor.jsx';
import ExperimentView from './components/ExperimentView.jsx';
import UserAgentTimeline from './components/UserAgentTimeline.jsx';
import UserAgentDetailsDrawer from './components/UserAgentDetailsDrawer.jsx';

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
    swarmBranches,
    swarmHypotheses,
    swarmStatus,
    swarmReasoning,
    runSwarm,
    abortSwarmRun,
    loadSwarmBranches,
  } = useWebSocket();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [userDetailsOpen, setUserDetailsOpen] = useState(false);
  const [mode, setMode] = useState('agent');

  const [theme, setTheme] = useState(() => readStoredTheme());
  const [themePack, setThemePack] = useState(() => readStoredThemePack());
  const [density, setDensity] = useState(() => readStoredDensity());
  const [uiShell, setUiShell] = useState(() => readStoredUiShell());

  useLayoutEffect(() => {
    const appearance = { theme, themePack, density, uiShell };
    applyDocumentAppearance(appearance);
    persistAppearance(appearance);
  }, [theme, themePack, density, uiShell]);

  useEffect(() => {
    void ensureThemePackFontsLoaded(themePack);
  }, [themePack]);

  function handleUiShellChange(next) {
    setUiShell(next);
    if (next === 'agent') {
      setThemePack((p) => (p === 'default' ? 'claude' : p));
    }
    setUserDetailsOpen(false);
  }

  const agentUserMode = mode === 'agent' && uiShell === 'agent';

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
        onThemeChange={setTheme}
        themePack={themePack}
        onThemePackChange={setThemePack}
        density={density}
        onDensityChange={setDensity}
        uiShell={uiShell}
        onUiShellChange={handleUiShellChange}
        onOpenUserDetails={() => setUserDetailsOpen(true)}
      />

      {mode === 'agent' && agentUserMode ? (
        <>
          <div className="main-content agent-user-shell">
            <div className="left-panel agent-user-column">
              <UserAgentTimeline events={events} status={status} sessionId={sessionId} />
              <ChatInput
                variant="user"
                onSend={startAgent}
                onFollowUp={followUp}
                onStop={stopAgent}
                status={status}
                sessionId={sessionId}
                connected={connected}
              />
            </div>
          </div>
          <UserAgentDetailsDrawer open={userDetailsOpen} onClose={() => setUserDetailsOpen(false)}>
            <RightPanel events={events} sessionStats={sessionStats} />
          </UserAgentDetailsDrawer>
          <StatusBar
            status={status}
            sessionId={sessionId}
            eventCount={events.length}
            sessionStats={sessionStats}
            subtasks={subtasks}
          />
        </>
      ) : mode === 'agent' ? (
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
