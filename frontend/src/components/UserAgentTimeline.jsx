import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import MarkdownBody from './MarkdownBody.jsx';
import { TimelineDotIcon } from './LucideStatusIcons.jsx';
import { buildUserShellDisplayItems } from './agentTimelineModel.js';
import styles from './UserAgentTimeline.module.css';

function JsonTable({ data }) {
  if (!Array.isArray(data) || data.length === 0) return null;
  const headers = Object.keys(data[0]);
  return (
    <div className={styles.tableWrap}>
      <table className={styles.jsonTable}>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i}>
              {headers.map((h) => (
                <td key={h}>{String(row[h] ?? '')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function truncate(text, max = 5000) {
  if (typeof text !== 'string') text = String(text);
  return text.length > max ? text.slice(0, max) + '...' : text;
}

function UserMilestoneRow({ item, index }) {
  const useMarkdown = item.renderMarkdown === true;

  let tableData = null;
  if (item.kind === 'tool_result') {
    try {
      const parsed = JSON.parse(item.body);
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
        tableData = parsed;
      }
    } catch {
      /* ignore */
    }
  }

  return (
    <article
      className={styles.milestone}
      style={{
        animationDelay: `${Math.min(index, 24) * 25}ms`,
      }}
    >
      <div className={styles.milestoneGutter} aria-hidden>
        <TimelineDotIcon variant={item.dot} />
        <span className={styles.milestoneLine} />
      </div>
      <div className={styles.milestoneBody}>
        <header className={styles.milestoneHeader}>
          <h3 className={styles.milestoneTitle}>{item.label}</h3>
          <time className={styles.milestoneTime} dateTime={item.ts || undefined}>
            {item.ts ? new Date(item.ts).toLocaleTimeString() : '--:--:--'}
          </time>
        </header>
        {tableData ? (
          <JsonTable data={tableData} />
        ) : (
          item.body &&
          (useMarkdown ? (
            <div className={styles.milestoneRich}>
              <MarkdownBody>{truncate(item.body)}</MarkdownBody>
            </div>
          ) : (
            <pre className={styles.milestonePlain}>{truncate(item.body)}</pre>
          ))
        )}
      </div>
    </article>
  );
}

export default function UserAgentTimeline({ events, status }) {
  const { t, i18n } = useTranslation();
  const bottomRef = useRef(null);
  const displayItems = useMemo(() => buildUserShellDisplayItems(events), [events, i18n.language]);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'instant' });
    });
    return () => cancelAnimationFrame(id);
  }, [displayItems.length]);

  if (events.length === 0 && status === 'idle') {
    return (
      <div className={`${styles.emptyWrap} user-agent-feed`}>
        <div className={styles.emptyInner}>
          <Sparkles size={36} strokeWidth={1.5} className={styles.emptyIcon} aria-hidden />
          <h2 className={styles.emptyTitle}>{t('userShell.emptyTitle')}</h2>
          <p className={styles.emptyHint}>{t('userShell.emptyHint')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.scrollArea} user-agent-feed`}>
      <div className={styles.feedTop}>
        <h2 className={styles.feedHeading}>{t('userShell.feedTitle')}</h2>
        <span className={styles.feedMeta}>
          {t('timeline.eventsCount', { count: displayItems.length })}
        </span>
      </div>
      <div className={styles.feedList}>
        {displayItems.map((item, i) => (
          <UserMilestoneRow key={item.key} item={item} index={i} />
        ))}
        {displayItems.length === 0 && events.length > 0 && (
          <p className={styles.toolsOnlyNote}>{t('userShell.toolsOnlyHidden')}</p>
        )}
        {status === 'running' && (
          <div className={styles.runningRow}>
            <TimelineDotIcon variant="running" />
            <span className={styles.runningLabel}>{t('userShell.runningHint')}</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
