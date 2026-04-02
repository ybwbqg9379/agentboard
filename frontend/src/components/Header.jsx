import styles from './Header.module.css';

const MCP_STATE_COLORS = {
  connected: 'var(--status-running)',
  degraded: 'var(--status-thinking)',
  failed: 'var(--status-error)',
  pending: 'var(--text-tertiary)',
  needs_auth: 'var(--status-thinking)',
};

export default function Header({
  connected,
  sessionId,
  onClear,
  onOpenHistory,
  mcpHealth,
  mode,
  onModeChange,
  theme,
  onToggleTheme,
}) {
  const mcpEntries = Object.entries(mcpHealth || {});

  return (
    <header className={styles.header}>
      <div className={styles.left}>
        <span className={styles.logo}>AgentBoard</span>
        <span className={styles.version}>v{__APP_VERSION__}</span>
        <div className={styles.modeTabs}>
          <button
            className={`${styles.modeTab} ${mode === 'agent' ? styles.modeActive : ''}`}
            onClick={() => onModeChange('agent')}
          >
            Agent
          </button>
          <button
            className={`${styles.modeTab} ${mode === 'workflow' ? styles.modeActive : ''}`}
            onClick={() => onModeChange('workflow')}
          >
            Workflow
          </button>
          <button
            className={`${styles.modeTab} ${mode === 'experiment' ? styles.modeActive : ''}`}
            onClick={() => onModeChange('experiment')}
          >
            Experiment
          </button>
        </div>
      </div>

      <div className={styles.right}>
        <button
          className={styles.themeBtn}
          onClick={onToggleTheme}
          title={`Switch theme (current: ${theme})`}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          {theme === 'dark' ? (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="4"></circle>
              <path d="M12 2v2"></path>
              <path d="M12 20v2"></path>
              <path d="m4.93 4.93 1.41 1.41"></path>
              <path d="m17.66 17.66 1.41 1.41"></path>
              <path d="M2 12h2"></path>
              <path d="M20 12h2"></path>
              <path d="m6.34 17.66-1.41 1.41"></path>
              <path d="m19.07 4.93-1.41 1.41"></path>
            </svg>
          ) : (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path>
            </svg>
          )}
        </button>
        {mcpEntries.length > 0 && (
          <div className={styles.mcpHealth}>
            <span className={styles.mcpLabel}>MCP</span>
            {mcpEntries.map(([name, info]) => (
              <span
                key={name}
                className={styles.mcpDot}
                style={{ background: MCP_STATE_COLORS[info.state] || MCP_STATE_COLORS.pending }}
                title={`${name}: ${info.state} (${info.toolCalls} calls, ${info.toolErrors} errors)`}
              />
            ))}
          </div>
        )}
        {mode === 'agent' && (
          <>
            <button className={styles.historyBtn} onClick={onOpenHistory}>
              History
            </button>
            {sessionId && (
              <button className={styles.clearBtn} onClick={onClear}>
                New Session
              </button>
            )}
          </>
        )}
        <div className={styles.connStatus}>
          <span className={styles.connDot} data-connected={connected} />
          <span className={styles.connText}>{connected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </div>
    </header>
  );
}
