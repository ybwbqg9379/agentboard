import styles from './StatusBar.module.css';

const STATUS_TEXT = {
  idle: 'Ready',
  running: 'Agent running',
  completed: 'Completed',
  failed: 'Failed',
  stopped: 'Stopped',
};

function formatTokens(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function formatDuration(ms) {
  if (ms >= 60000) return (ms / 60000).toFixed(1) + 'm';
  return (ms / 1000).toFixed(1) + 's';
}

export default function StatusBar({ status, sessionId, eventCount, sessionStats, subtasks }) {
  const totalTokens = (sessionStats?.input_tokens || 0) + (sessionStats?.output_tokens || 0);
  const subtaskEntries = Object.values(subtasks || {});
  const activeSubtasks = subtaskEntries.filter((t) => t.status === 'running');
  const turns = sessionStats?.num_turns || 0;

  return (
    <footer className={styles.bar}>
      <div className={styles.left}>
        <span
          className={`dot dot-${status === 'running' ? 'running' : status === 'failed' ? 'error' : 'done'}`}
        />
        <span>{STATUS_TEXT[status] || status}</span>
        {sessionStats?.model && <span className={styles.meta}>{sessionStats.model}</span>}
        {turns > 0 && <span className={styles.meta}>{turns} turns</span>}
        {activeSubtasks.length > 0 && (
          <span className={styles.subtask}>
            <span className="dot dot-running" />
            {activeSubtasks.length} subtask{activeSubtasks.length > 1 ? 's' : ''}
          </span>
        )}
      </div>
      <div className={styles.right}>
        {totalTokens > 0 && (
          <div
            className={styles.tokenBar}
            title={`In: ${formatTokens(sessionStats?.input_tokens || 0)} / Out: ${formatTokens(sessionStats?.output_tokens || 0)}`}
          >
            <span className={styles.tokenLabel}>{formatTokens(totalTokens)}</span>
            <div className={styles.tokenTrack}>
              <div
                className={styles.tokenFillIn}
                style={{
                  width: `${Math.min(((sessionStats?.input_tokens || 0) / Math.max(totalTokens, 1)) * 100, 100)}%`,
                }}
              />
              <div
                className={styles.tokenFillOut}
                style={{
                  width: `${Math.min(((sessionStats?.output_tokens || 0) / Math.max(totalTokens, 1)) * 100, 100)}%`,
                }}
              />
            </div>
          </div>
        )}
        {sessionStats?.cost_usd > 0 && (
          <span className={styles.meta}>${sessionStats.cost_usd.toFixed(4)}</span>
        )}
        {sessionStats?.duration_ms > 0 && (
          <span className={styles.meta}>{formatDuration(sessionStats.duration_ms)}</span>
        )}
        {sessionId && <span className={styles.meta}>Session: {sessionId.slice(0, 8)}</span>}
        <span className={styles.meta}>Events: {eventCount}</span>
      </div>
    </footer>
  );
}
