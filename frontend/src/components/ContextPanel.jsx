import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart2, DollarSign } from 'lucide-react';
import { ContextSegmentIcon } from './LucideStatusIcons.jsx';
import styles from './ContextPanel.module.css';

export default function ContextPanel({ sessionStats }) {
  const { t } = useTranslation();
  const input = sessionStats?.input_tokens || 0;
  const output = sessionStats?.output_tokens || 0;
  const cache = sessionStats?.cache_read_tokens || 0;
  const total = input + output + cache;

  const segments = useMemo(() => {
    const segs = [
      { key: 'input', label: t('contextPanel.input'), value: input, color: 'var(--status-tool)' },
      {
        key: 'output',
        label: t('contextPanel.output'),
        value: output,
        color: 'var(--status-done)',
      },
    ];
    if (cache > 0) {
      segs.push({
        key: 'cache',
        label: t('contextPanel.cache'),
        value: cache,
        color: 'var(--status-thinking)',
      });
    }
    return segs;
  }, [t, input, output, cache]);

  if (total === 0) {
    return (
      <div className={styles.panel}>
        <div className={styles.header}>
          <span className={styles.headerLead}>
            <BarChart2 size={14} strokeWidth={2} className={styles.headerIcon} aria-hidden />
            {t('contextPanel.header')}
          </span>
        </div>
        <div className={styles.empty}>
          <BarChart2 size={36} strokeWidth={1.5} className={styles.emptyIcon} aria-hidden />
          {t('contextPanel.empty')}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.headerLead}>
          <BarChart2 size={14} strokeWidth={2} className={styles.headerIcon} aria-hidden />
          {t('contextPanel.header')}
        </span>
        <span className={styles.total}>
          {t('contextPanel.totalTokens', { formatted: formatTokens(total) })}
        </span>
      </div>

      <div className={styles.bar}>
        {segments.map((seg) => (
          <div
            key={seg.key}
            className={styles.segment}
            style={{
              width: `${(seg.value / total) * 100}%`,
              background: seg.color,
            }}
            title={t('contextPanel.segmentTitle', {
              label: seg.label,
              value: formatTokens(seg.value),
            })}
          />
        ))}
      </div>

      <div className={styles.legend}>
        {segments.map((seg) => (
          <div key={seg.key} className={styles.legendItem}>
            <ContextSegmentIcon segmentKey={seg.key} />
            <span className={styles.legendLabel}>{seg.label}</span>
            <span className={styles.legendValue}>{formatTokens(seg.value)}</span>
            <span className={styles.legendPct}>{((seg.value / total) * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>

      {sessionStats?.cost_usd > 0 && (
        <div className={styles.cost}>
          <DollarSign size={11} strokeWidth={2} className={styles.costIcon} aria-hidden />
          <span>
            {t('contextPanel.cost', {
              amount: sessionStats.cost_usd.toFixed(4),
              model: sessionStats?.model ? ` (${sessionStats.model})` : '',
            })}
          </span>
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
