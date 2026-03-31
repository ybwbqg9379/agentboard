import { useState, useEffect, useCallback } from 'react';
import styles from './SessionDrawer.module.css';

const API_BASE = `${window.location.protocol}//${window.location.hostname}:3001`;

export default function SessionDrawer({ open, onClose, onLoadSession, currentSessionId }) {
  const [sessions, setSessions] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/sessions?limit=30`);
      const data = await res.json();
      setSessions(data.sessions || []);
      setTotal(data.total || 0);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchSessions();
  }, [open, fetchSessions]);

  if (!open) return null;

  const statusDot = (s) => {
    if (s === 'running') return 'dot-running';
    if (s === 'failed' || s === 'interrupted') return 'dot-error';
    if (s === 'stopped') return 'dot-thinking';
    return 'dot-done';
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.drawer} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span>Session History</span>
          <span className={styles.count}>{total}</span>
          <button className={styles.closeBtn} onClick={onClose}>
            x
          </button>
        </div>
        <div className={styles.list}>
          {loading && <div className={styles.loading}>Loading...</div>}
          {sessions.map((s) => (
            <button
              key={s.id}
              className={`${styles.item} ${s.id === currentSessionId ? styles.active : ''}`}
              onClick={() => {
                onLoadSession(s.id);
                onClose();
              }}
            >
              <div className={styles.itemHeader}>
                <span className={`dot ${statusDot(s.status)}`} />
                <span className={styles.itemStatus}>{s.status}</span>
                <span className={styles.itemTime}>{new Date(s.created_at).toLocaleString()}</span>
              </div>
              <div className={styles.itemPrompt}>
                {(s.prompt || '').slice(0, 80)}
                {(s.prompt || '').length > 80 ? '...' : ''}
              </div>
              {s.stats &&
                (() => {
                  try {
                    const st = typeof s.stats === 'string' ? JSON.parse(s.stats) : s.stats;
                    const parts = [];
                    if (st.num_turns) parts.push(`${st.num_turns}t`);
                    if (st.duration_ms) parts.push(`${(st.duration_ms / 1000).toFixed(0)}s`);
                    if (st.model) parts.push(st.model);
                    return parts.length ? (
                      <div className={styles.itemMeta}>{parts.join(' | ')}</div>
                    ) : null;
                  } catch {
                    return null;
                  }
                })()}
            </button>
          ))}
          {!loading && sessions.length === 0 && <div className={styles.empty}>No sessions yet</div>}
        </div>
      </div>
    </div>
  );
}
