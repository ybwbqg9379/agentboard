import { useState, useEffect, useCallback } from 'react';
import styles from './SessionDrawer.module.css';
import { withClientAuth } from '../lib/clientAuth.js';
import ConfirmDialog from './ConfirmDialog.jsx';

const API_BASE = '';

export default function SessionDrawer({ open, onClose, onLoadSession, currentSessionId }) {
  const [sessions, setSessions] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [confirmState, setConfirmState] = useState(null); // { type, ids, message }

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/sessions?limit=30`, withClientAuth());
      if (!res.ok) return;
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
    if (open) {
      fetchSessions();
      setSelected(new Set());
    }
  }, [open, fetchSessions]);

  function toggleSelect(id, e) {
    e.stopPropagation();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === sessions.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(sessions.map((s) => s.id)));
    }
  }

  function requestDeleteSingle(e, sessionId) {
    e.stopPropagation();
    setConfirmState({
      ids: [sessionId],
      message: 'Delete this session and all its events?',
    });
  }

  function requestDeleteBatch() {
    if (selected.size === 0) return;
    setConfirmState({
      ids: [...selected],
      message: `Delete ${selected.size} session${selected.size > 1 ? 's' : ''} and all their events?`,
    });
  }

  async function executeDelete() {
    if (!confirmState) return;
    const { ids } = confirmState;
    setConfirmState(null);
    try {
      if (ids.length === 1) {
        await fetch(`${API_BASE}/api/sessions/${ids[0]}`, withClientAuth({ method: 'DELETE' }));
      } else {
        await fetch(
          `${API_BASE}/api/sessions/batch-delete`,
          withClientAuth({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids }),
          }),
        );
      }
      const deletedIds = new Set(ids);
      setSessions((prev) => {
        const remaining = prev.filter((s) => !deletedIds.has(s.id));
        setTotal(remaining.length);
        return remaining;
      });
      setSelected((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    } catch {
      // Refresh list to get accurate counts after partial failure
      fetchSessions();
    }
  }

  if (!open) return null;

  const statusDot = (s) => {
    if (s === 'running') return 'dot-running';
    if (s === 'failed' || s === 'interrupted') return 'dot-error';
    if (s === 'stopped') return 'dot-thinking';
    return 'dot-done';
  };

  const isSelectMode = selected.size > 0;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.drawer} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span>Session History</span>
          <span className={styles.count}>{total}</span>
          {sessions.length > 0 && (
            <button className={styles.selectAllBtn} onClick={toggleSelectAll}>
              {selected.size === sessions.length ? 'Deselect All' : 'Select All'}
            </button>
          )}
          {isSelectMode && (
            <button className={styles.batchDeleteBtn} onClick={requestDeleteBatch}>
              Delete ({selected.size})
            </button>
          )}
          <button className={styles.closeBtn} onClick={onClose}>
            ✕
          </button>
        </div>
        <div className={styles.list}>
          {loading && <div className={styles.loading}>Loading...</div>}
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`${styles.item} ${s.id === currentSessionId ? styles.active : ''} ${selected.has(s.id) ? styles.selected : ''}`}
            >
              <label className={styles.checkbox} onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selected.has(s.id)}
                  onChange={(e) => toggleSelect(s.id, e)}
                />
              </label>
              <button
                className={styles.itemContent}
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
              <button
                className={styles.deleteBtn}
                title="Delete session"
                onClick={(e) => requestDeleteSingle(e, s.id)}
              >
                🗑
              </button>
            </div>
          ))}
          {!loading && sessions.length === 0 && <div className={styles.empty}>No sessions yet</div>}
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmState}
        title="Delete Sessions"
        message={confirmState?.message || ''}
        onConfirm={executeDelete}
        onCancel={() => setConfirmState(null)}
      />
    </div>
  );
}
