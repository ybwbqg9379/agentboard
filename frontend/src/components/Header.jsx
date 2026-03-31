import styles from './Header.module.css';

const MCP_STATE_COLORS = {
  connected: 'var(--status-running)',
  degraded: 'var(--status-warning, #f59e0b)',
  failed: 'var(--status-error)',
  pending: 'var(--text-tertiary)',
  needs_auth: '#f97316',
};

export default function Header({
  connected,
  sessionId,
  onClear,
  onOpenHistory,
  mcpHealth,
  mode,
  onModeChange,
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
        </div>
      </div>

      <div className={styles.right}>
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
