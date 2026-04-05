/**
 * Shared Lucide glyphs for timeline rows, footer status, session list, and context legend.
 * Keeps colors aligned with semantic CSS variables.
 */
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  Circle,
  CircleDashed,
  Database,
  Loader2,
  PauseCircle,
  Wrench,
  XCircle,
} from 'lucide-react';
import styles from './LucideStatusIcons.module.css';

const T_DOT = 14;
const T_BAR = 12;
const T_SEG = 12;
const SW = 2;

/** Timeline / tool row gutter: running | thinking | error | done | tool */
export function TimelineDotIcon({ variant, className = '' }) {
  const base = `${styles.timelineDot} ${className}`.trim();
  switch (variant) {
    case 'running':
      return (
        <Loader2
          size={T_DOT}
          strokeWidth={SW}
          className={`${base} ${styles.spin}`}
          aria-hidden
          style={{ color: 'var(--status-running)' }}
        />
      );
    case 'thinking':
      return (
        <CircleDashed
          size={T_DOT}
          strokeWidth={SW}
          className={`${base} ${styles.spinSlow}`}
          aria-hidden
          style={{ color: 'var(--status-thinking)' }}
        />
      );
    case 'error':
      return (
        <XCircle
          size={T_DOT}
          strokeWidth={SW}
          className={base}
          aria-hidden
          style={{ color: 'var(--status-error)' }}
        />
      );
    case 'tool':
      return (
        <Wrench
          size={T_DOT}
          strokeWidth={SW}
          className={base}
          aria-hidden
          style={{ color: 'var(--status-tool)' }}
        />
      );
    case 'done':
    default:
      return (
        <CheckCircle2
          size={T_DOT}
          strokeWidth={SW}
          className={base}
          aria-hidden
          style={{ color: 'var(--status-done)' }}
        />
      );
  }
}

/** Status bar & session list: idle | running | completed | failed | stopped */
export function BarStatusIcon({ status, className = '' }) {
  const base = `${styles.barIcon} ${className}`.trim();
  switch (status) {
    case 'running':
      return (
        <Loader2
          size={T_BAR}
          strokeWidth={SW}
          className={`${base} ${styles.spin}`}
          aria-hidden
          style={{ color: 'var(--status-running)' }}
        />
      );
    case 'failed':
      return (
        <XCircle
          size={T_BAR}
          strokeWidth={SW}
          className={base}
          aria-hidden
          style={{ color: 'var(--status-error)' }}
        />
      );
    case 'completed':
      return (
        <CheckCircle2
          size={T_BAR}
          strokeWidth={SW}
          className={base}
          aria-hidden
          style={{ color: 'var(--status-done)' }}
        />
      );
    case 'stopped':
      return (
        <PauseCircle
          size={T_BAR}
          strokeWidth={SW}
          className={base}
          aria-hidden
          style={{ color: 'var(--status-thinking)' }}
        />
      );
    case 'idle':
    default:
      return (
        <Circle
          size={T_BAR}
          strokeWidth={SW}
          className={base}
          aria-hidden
          style={{ color: 'var(--text-tertiary)' }}
        />
      );
  }
}

/** Maps API session / agent status string to BarStatusIcon status */
export function normalizeBarStatus(status) {
  if (status === 'running') return 'running';
  if (status === 'failed' || status === 'interrupted') return 'failed';
  if (status === 'stopped') return 'stopped';
  if (status === 'completed') return 'completed';
  return 'idle';
}

/** Context panel stacked bar legend */
export function ContextSegmentIcon({ segmentKey, className = '' }) {
  const c = `${styles.segIcon} ${className}`.trim();
  if (segmentKey === 'input') {
    return (
      <ArrowDownToLine
        size={T_SEG}
        strokeWidth={SW}
        className={c}
        aria-hidden
        style={{ color: 'var(--status-tool)' }}
      />
    );
  }
  if (segmentKey === 'output') {
    return (
      <ArrowUpFromLine
        size={T_SEG}
        strokeWidth={SW}
        className={c}
        aria-hidden
        style={{ color: 'var(--status-done)' }}
      />
    );
  }
  if (segmentKey === 'cache') {
    return (
      <Database
        size={T_SEG}
        strokeWidth={SW}
        className={c}
        aria-hidden
        style={{ color: 'var(--status-thinking)' }}
      />
    );
  }
  return null;
}
