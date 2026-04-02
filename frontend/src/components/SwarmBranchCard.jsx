/**
 * SwarmBranchCard.jsx
 *
 * 展示单个 Research Swarm 分支的状态卡片。
 * 显示内容：假说文本、运行状态、最优 Metric、Trial 进度。
 */
import styles from './SwarmBranchCard.module.css';

const STATUS_ICON = {
  running: '⟳',
  completed: '✅',
  failed: '❌',
  aborted: '⏹',
};

const STATUS_LABEL = {
  running: '运行中',
  completed: '完成',
  failed: '失败',
  aborted: '已中止',
};

export function SwarmBranchCard({ branch, index }) {
  const {
    hypothesis,
    status = 'running',
    bestMetric,
    totalTrials = 0,
    acceptedTrials = 0,
    isSelected = false,
    error,
  } = branch;

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
      {/* 头部：分支编号 + 状态 */}
      <div className={styles.header}>
        <span className={styles.branchLabel}>Branch {index}</span>
        <span className={`${styles.statusBadge} ${statusClass}`}>
          <span className={status === 'running' ? styles.spinIcon : ''}>
            {STATUS_ICON[status] ?? '○'}
          </span>
          {isSelected ? '⭐ 已选中' : (STATUS_LABEL[status] ?? status)}
        </span>
      </div>

      {/* 假说文本 */}
      <p className={styles.hypothesis}>{hypothesis || '（无假说文本）'}</p>

      {/* 指标 + 进度 */}
      <div className={styles.metrics}>
        <div className={styles.metricItem}>
          <span className={styles.metricLabel}>最优指标</span>
          <span className={styles.metricValue}>
            {bestMetric !== null && bestMetric !== undefined ? Number(bestMetric).toFixed(4) : '—'}
          </span>
        </div>
        <div className={styles.metricItem}>
          <span className={styles.metricLabel}>试验</span>
          <span className={styles.metricValue}>
            {acceptedTrials}/{totalTrials}
          </span>
        </div>
      </div>

      {/* 错误提示 */}
      {error && <p className={styles.errorText}>{error}</p>}
    </div>
  );
}
