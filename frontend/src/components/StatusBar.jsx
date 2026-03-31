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

export default function StatusBar({ status, sessionId, eventCount, sessionStats }) {
  const totalTokens = (sessionStats?.input_tokens || 0) + (sessionStats?.output_tokens || 0);

  return (
    <footer className={styles.bar}>
      <div className={styles.left}>
        <span
          className={`dot dot-${status === 'running' ? 'running' : status === 'failed' ? 'error' : 'done'}`}
        />
        <span>{STATUS_TEXT[status] || status}</span>
        {sessionStats?.model && <span className={styles.meta}>{sessionStats.model}</span>}
      </div>
      <div className={styles.right}>
        {totalTokens > 0 && <span className={styles.meta}>{formatTokens(totalTokens)} tokens</span>}
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
