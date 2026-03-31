import styles from './Header.module.css';

export default function Header({ connected, sessionId, onClear }) {
  return (
    <header className={styles.header}>
      <div className={styles.left}>
        <span className={styles.logo}>AgentBoard</span>
        <span className={styles.version}>v0.3.1</span>
      </div>

      <div className={styles.right}>
        {sessionId && (
          <button className={styles.clearBtn} onClick={onClear}>
            New Session
          </button>
        )}
        <div className={styles.connStatus}>
          <span className={styles.connDot} data-connected={connected} />
          <span className={styles.connText}>{connected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </div>
    </header>
  );
}
