/**
 * SwarmBranchCard.jsx
 *
 * 展示单个 Research Swarm 分支的状态卡片。
 */
import { useTranslation } from 'react-i18next';
import { BookmarkCheck, CheckCircle2, CircleStop, Loader2, XCircle } from 'lucide-react';
import styles from './SwarmBranchCard.module.css';

const ICON_PROPS = { size: 13, strokeWidth: 2, 'aria-hidden': true };

function StatusGlyph({ status, isSelected }) {
  if (isSelected) {
    return <BookmarkCheck {...ICON_PROPS} />;
  }
  switch (status) {
    case 'running':
      return (
        <Loader2
          size={ICON_PROPS.size}
          strokeWidth={ICON_PROPS.strokeWidth}
          aria-hidden
          className={styles.lucideSpin}
        />
      );
    case 'completed':
      return <CheckCircle2 {...ICON_PROPS} />;
    case 'failed':
      return <XCircle {...ICON_PROPS} />;
    case 'aborted':
      return <CircleStop {...ICON_PROPS} />;
    default:
      return null;
  }
}

export function SwarmBranchCard({ branch, index }) {
  const { t } = useTranslation();
  const {
    hypothesis,
    status = 'running',
    bestMetric,
    totalTrials = 0,
    acceptedTrials = 0,
    isSelected = false,
    error,
  } = branch;

  const statusLabel =
    {
      running: t('swarmCard.statusRunning'),
      completed: t('swarmCard.statusCompleted'),
      failed: t('swarmCard.statusFailed'),
      aborted: t('swarmCard.statusAborted'),
    }[status] ?? status;

  const statusClass =
    status === 'running'
      ? styles.statusRunning
      : status === 'completed'
        ? isSelected
          ? styles.statusSelected
          : styles.statusCompleted
        : styles.statusFailed;

  return (
    <div className={`${styles.card} ${isSelected ? styles.cardSelected : ''}`}>
      <div className={styles.header}>
        <span className={styles.branchLabel}>{t('swarmCard.branch', { index })}</span>
        <span className={`${styles.statusBadge} ${statusClass}`}>
          <StatusGlyph status={status} isSelected={isSelected} />
          {isSelected ? t('swarmCard.selected') : statusLabel}
        </span>
      </div>

      <p className={styles.hypothesis}>{hypothesis || t('swarmCard.noHypothesis')}</p>

      <div className={styles.metrics}>
        <div className={styles.metricItem}>
          <span className={styles.metricLabel}>{t('swarmCard.bestMetric')}</span>
          <span className={styles.metricValue}>
            {bestMetric !== null && bestMetric !== undefined ? Number(bestMetric).toFixed(4) : '—'}
          </span>
        </div>
        <div className={styles.metricItem}>
          <span className={styles.metricLabel}>{t('swarmCard.trials')}</span>
          <span className={styles.metricValue}>
            {acceptedTrials}/{totalTrials}
          </span>
        </div>
      </div>

      {error && <p className={styles.errorText}>{error}</p>}
    </div>
  );
}
