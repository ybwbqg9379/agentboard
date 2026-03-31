import styles from './StatusBar.module.css';

const STATUS_TEXT = {
  idle: 'Ready',
  running: 'Agent running',
  completed: 'Completed',
  failed: 'Failed',
  stopped: 'Stopped',
};

export default function StatusBar({ status, sessionId, eventCount }) {
  return (
    <footer className={styles.bar}>
      <div className={styles.left}>
        <span
          className={`dot dot-${status === 'running' ? 'running' : status === 'failed' ? 'error' : 'done'}`}
        />
        <span>{STATUS_TEXT[status] || status}</span>
      </div>
      <div className={styles.right}>
        {sessionId && <span className={styles.meta}>Session: {sessionId.slice(0, 8)}</span>}
        <span className={styles.meta}>Events: {eventCount}</span>
      </div>
    </footer>
  );
}
