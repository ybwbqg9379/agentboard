import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FileDown, Sparkles } from 'lucide-react';
import MarkdownBody from './MarkdownBody.jsx';
import { TimelineDotIcon } from './LucideStatusIcons.jsx';
import { buildDisplayItems } from './agentTimelineModel.js';
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

function DownloadRow({ fileName, sessionId }) {
  const { t } = useTranslation();
  const downloadUrl = `/api/sessions/${sessionId}/files/${encodeURIComponent(fileName)}`;
  return (
    <a href={downloadUrl} download={fileName} className={styles.downloadBtn}>
      <FileDown size={14} strokeWidth={2} className={styles.downloadIcon} aria-hidden />
      {t('timeline.download', { fileName })}
    </a>
  );
}

function truncate(text, max = 5000) {
  if (typeof text !== 'string') text = String(text);
  return text.length > max ? text.slice(0, max) + '...' : text;
}

function UserMilestoneRow({ item, index, sessionId }) {
  const { t } = useTranslation();
  const useMarkdown = item.renderMarkdown === true;
  const toolResultLabel = t('timeline.event.toolResult');

  let tableData = null;
  if (item.label === toolResultLabel && item.dot !== 'error') {
    try {
      const parsed = JSON.parse(item.body);
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
        tableData = parsed;
      }
    } catch {
      /* ignore */
    }
  }

  let pdfFile = null;
  if (item.label === toolResultLabel && item.dot !== 'error') {
    const pdfMatch = item.body.match(/File: (.*\.pdf)/i);
    if (pdfMatch) pdfFile = pdfMatch[1];
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
        {pdfFile && <DownloadRow fileName={pdfFile} sessionId={sessionId} />}
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

export default function UserAgentTimeline({ events, status, sessionId }) {
  const { t } = useTranslation();
  const bottomRef = useRef(null);
  const displayItems = useMemo(() => buildDisplayItems(events), [events]);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'instant' });
    });
    return () => cancelAnimationFrame(id);
  }, [displayItems.length]);

  if (displayItems.length === 0 && status === 'idle') {
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
          <UserMilestoneRow key={item.key} item={item} index={i} sessionId={sessionId} />
        ))}
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
