import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Braces, Clock, DollarSign, Hash, ListOrdered } from 'lucide-react';
import { BarStatusIcon, normalizeBarStatus } from './LucideStatusIcons.jsx';
import styles from './StatusBar.module.css';

const KNOWN_SESSION_STATUSES = ['idle', 'running', 'completed', 'failed', 'stopped'];

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
  const { t } = useTranslation();
  const totalTokens = (sessionStats?.input_tokens || 0) + (sessionStats?.output_tokens || 0);
  const subtaskEntries = Object.values(subtasks || {});
  const activeSubtasks = subtaskEntries.filter((sub) => sub.status === 'running');
  const turns = sessionStats?.num_turns || 0;

  useEffect(() => {
    if (
      import.meta.env.DEV &&
      status != null &&
      status !== '' &&
      !KNOWN_SESSION_STATUSES.includes(status)
    ) {
      console.warn(
        `[StatusBar] Unknown session status "${String(status)}" — add locales statusBar.${status} or normalize upstream.`,
      );
    }
  }, [status]);

  const statusLabel = KNOWN_SESSION_STATUSES.includes(status) ? t(`statusBar.${status}`) : status;

  return (
    <footer className={styles.bar}>
      <div className={styles.left}>
        <BarStatusIcon status={normalizeBarStatus(status)} />
        <span>{statusLabel}</span>
        {sessionStats?.model && <span className={styles.meta}>{sessionStats.model}</span>}
        {turns > 0 && <span className={styles.meta}>{t('statusBar.turns', { count: turns })}</span>}
        {activeSubtasks.length > 0 && (
          <span className={styles.subtask}>
            <BarStatusIcon status="running" />
            {t('statusBar.subtask', { count: activeSubtasks.length })}
          </span>
        )}
      </div>
      <div className={styles.right}>
        {totalTokens > 0 && (
          <div
            className={styles.tokenBar}
            title={t('statusBar.tokenTooltip', {
              input: formatTokens(sessionStats?.input_tokens || 0),
              output: formatTokens(sessionStats?.output_tokens || 0),
            })}
          >
            <Braces size={11} strokeWidth={2} className={styles.metaGlyph} aria-hidden />
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
          <span className={styles.meta}>
            <DollarSign size={11} strokeWidth={2} className={styles.metaGlyph} aria-hidden />
            <span>${sessionStats.cost_usd.toFixed(4)}</span>
          </span>
        )}
        {sessionStats?.duration_ms > 0 && (
          <span className={styles.meta}>
            <Clock size={11} strokeWidth={2} className={styles.metaGlyph} aria-hidden />
            <span>{formatDuration(sessionStats.duration_ms)}</span>
          </span>
        )}
        {sessionId && (
          <span className={styles.meta}>
            <Hash size={11} strokeWidth={2} className={styles.metaGlyph} aria-hidden />
            <span>{t('statusBar.session', { id: sessionId.slice(0, 8) })}</span>
          </span>
        )}
        <span className={styles.meta}>
          <ListOrdered size={11} strokeWidth={2} className={styles.metaGlyph} aria-hidden />
          <span>{t('statusBar.events', { count: eventCount })}</span>
        </span>
      </div>
    </footer>
  );
}
