import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FileDown, Inbox, MessagesSquare } from 'lucide-react';
import MarkdownBody from './MarkdownBody.jsx';
import { BarStatusIcon, normalizeBarStatus, TimelineDotIcon } from './LucideStatusIcons.jsx';
import { sessionFileDownloadHref } from '../lib/sessionDownloads.js';
import styles from './AgentTimeline.module.css';
import { buildDisplayItems } from './agentTimelineModel.js';

export {
  SYSTEM_HANDLERS,
  TYPE_HANDLERS,
  BLOCK_HANDLERS,
  parseBlock,
  flattenEvent,
  buildDisplayItems,
  buildUserShellDisplayItems,
  isUserShellTimelineItem,
} from './agentTimelineModel.js';

/**
 * JsonTable: Renders a JSON array as a clean HTML table.
 */
const JsonTable = ({ data }) => {
  if (!Array.isArray(data) || data.length === 0) return null;
  const headers = Object.keys(data[0]);

  return (
    <div className={styles.tableContainer}>
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
};

/**
 * DownloadButton: Renders a link to download a file from the session workspace.
 */
const DownloadButton = ({ fileName, sessionId }) => {
  const { t } = useTranslation();
  const downloadUrl = sessionFileDownloadHref(sessionId, fileName);

  return (
    <a href={downloadUrl} download={fileName} className={styles.downloadBtn}>
      <FileDown size={14} strokeWidth={2} className={styles.downloadBtnIcon} aria-hidden />
      {t('timeline.download', { fileName })}
    </a>
  );
};

function truncate(text, max = 5000) {
  if (typeof text !== 'string') text = String(text);
  return text.length > max ? text.slice(0, max) + '...' : text;
}

function TimelineItem({ item, index, sessionId }) {
  const useMarkdown = item.renderMarkdown === true;

  // UX Enhancement: Detect if body is a JSON array (for DataAnalystTool)
  let tableData = null;
  if (item.kind === 'tool_result') {
    try {
      const parsed = JSON.parse(item.body);
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
        tableData = parsed;
      }
    } catch {
      // Not a JSON array, ignore
    }
  }

  // UX Enhancement: Detect if body mentions a generated PDF (for ReportTool)
  let pdfFile = null;
  if (item.kind === 'tool_result') {
    const pdfMatch = item.body.match(/File: (.*\.pdf)/i);
    if (pdfMatch) pdfFile = pdfMatch[1];
  }

  return (
    <div
      className={`${styles.event} animate-in`}
      style={{ animationDelay: `${Math.min(index, 20) * 30}ms` }}
    >
      <div className={styles.eventGutter}>
        <TimelineDotIcon variant={item.dot} />
        <span className={styles.eventLine} />
      </div>
      <div className={styles.eventContent}>
        <div className={styles.eventHeader}>
          <span className={styles.eventLabel}>{item.label}</span>
          <span className={styles.eventTime}>
            {item.ts ? new Date(item.ts).toLocaleTimeString() : '--:--:--'}
          </span>
        </div>

        {/* Render PDF download button if detected */}
        {pdfFile && <DownloadButton fileName={pdfFile} sessionId={sessionId} />}

        {/* Render Table if data is a JSON array, otherwise render text/markdown */}
        {tableData ? (
          <JsonTable data={tableData} />
        ) : (
          item.body &&
          (useMarkdown ? (
            <MarkdownBody>{truncate(item.body)}</MarkdownBody>
          ) : (
            <pre className={styles.eventBody}>{truncate(item.body)}</pre>
          ))
        )}
      </div>
    </div>
  );
}

export default function AgentTimeline({ events, status, sessionId }) {
  const { t, i18n } = useTranslation();
  const bottomRef = useRef(null);
  const displayItems = useMemo(() => buildDisplayItems(events), [events, i18n.language]);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'instant' });
    });
    return () => cancelAnimationFrame(id);
  }, [displayItems.length]);

  if (displayItems.length === 0 && status === 'idle') {
    return (
      <div className="panel">
        <div className="panel-header">
          <MessagesSquare size={14} strokeWidth={2} className="panel-header-icon" aria-hidden />
          {t('timeline.title')}
        </div>
        <div className="empty-state">
          <Inbox size={40} strokeWidth={1.5} className="empty-state-icon" aria-hidden />
          <div className="empty-state-title">{t('timeline.emptyTitle')}</div>
          <div>{t('timeline.emptyHint')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <BarStatusIcon status={normalizeBarStatus(status)} />
        {t('timeline.title')}
        <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
          {t('timeline.eventsCount', { count: displayItems.length })}
        </span>
      </div>
      <div className={`panel-body ${styles.timeline}`}>
        {displayItems.map((item, i) => (
          <TimelineItem key={item.key} item={item} index={i} sessionId={sessionId} />
        ))}
        {status === 'running' && (
          <div className={styles.runningIndicator}>
            <TimelineDotIcon variant="running" />
            <span>{t('timeline.working')}</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
