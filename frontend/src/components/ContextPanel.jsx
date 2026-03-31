import styles from './ContextPanel.module.css';

/**
 * Token 用量可视化面板 -- 展示 input/output/cache token 占比和分布条。
 */
export default function ContextPanel({ sessionStats }) {
  const input = sessionStats?.input_tokens || 0;
  const output = sessionStats?.output_tokens || 0;
  const cache = sessionStats?.cache_read_tokens || 0;
  const total = input + output + cache;

  if (total === 0) {
    return (
      <div className={styles.panel}>
        <div className={styles.header}>Context Usage</div>
        <div className={styles.empty}>No token data available</div>
      </div>
    );
  }

  const segments = [
    { label: 'Input', value: input, color: 'var(--status-tool)' },
    { label: 'Output', value: output, color: 'var(--status-done)' },
  ];
  if (cache > 0) {
    segments.push({ label: 'Cache', value: cache, color: 'var(--status-thinking)' });
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        Context Usage
        <span className={styles.total}>{formatTokens(total)} tokens</span>
      </div>

      <div className={styles.bar}>
        {segments.map((seg) => (
          <div
            key={seg.label}
            className={styles.segment}
            style={{
              width: `${(seg.value / total) * 100}%`,
              background: seg.color,
            }}
            title={`${seg.label}: ${formatTokens(seg.value)}`}
          />
        ))}
      </div>

      <div className={styles.legend}>
        {segments.map((seg) => (
          <div key={seg.label} className={styles.legendItem}>
            <span className={styles.legendDot} style={{ background: seg.color }} />
            <span className={styles.legendLabel}>{seg.label}</span>
            <span className={styles.legendValue}>{formatTokens(seg.value)}</span>
            <span className={styles.legendPct}>{((seg.value / total) * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>

      {sessionStats?.cost_usd > 0 && (
        <div className={styles.cost}>
          Cost: ${sessionStats.cost_usd.toFixed(4)}
          {sessionStats?.model && <span> ({sessionStats.model})</span>}
        </div>
      )}
    </div>
  );
}

function formatTokens(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}
