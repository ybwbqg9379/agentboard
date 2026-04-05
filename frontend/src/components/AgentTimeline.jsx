import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import MarkdownBody from './MarkdownBody.jsx';
import styles from './AgentTimeline.module.css';
import i18n from '../i18n.js';

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
  const downloadUrl = `/api/sessions/${sessionId}/files/${encodeURIComponent(fileName)}`;

  return (
    <a href={downloadUrl} download={fileName} className={styles.downloadBtn}>
      <span className={styles.downloadIcon}>📄</span>
      {t('timeline.download', { fileName })}
    </a>
  );
};

// --- System subtype dispatch map ---
export const SYSTEM_HANDLERS = {
  init: (c, ts) => {
    const skillsPart = c?.skills?.length
      ? i18n.t('timeline.body.sessionInitSkills', { count: c.skills.length })
      : '';
    const body = i18n.t('timeline.body.sessionInit', {
      model: c?.model || i18n.t('common.unknown'),
      tools: c?.tools?.length || 0,
      mcp: c?.mcp_servers?.length || 0,
      skillsPart,
    });
    return [
      { label: i18n.t('timeline.event.sessionInit'), dot: 'done', body, ts, renderMarkdown: false },
    ];
  },
  api_retry: (c, ts) => [
    {
      label: i18n.t('timeline.event.apiRetry'),
      dot: 'error',
      body: i18n.t('timeline.body.apiRetry', {
        attempt: c?.attempt ?? '?',
        max: c?.max_retries ?? '?',
        ms: c?.retry_delay_ms || 0,
      }),
      ts,
      renderMarkdown: false,
    },
  ],
  status: (c, ts) =>
    c?.status === 'compacting'
      ? [
          {
            label: i18n.t('timeline.event.compacting'),
            dot: 'thinking',
            body: i18n.t('timeline.body.compactingShort'),
            ts,
            renderMarkdown: false,
          },
        ]
      : [],
  compact_boundary: (_c, ts) => [
    {
      label: i18n.t('timeline.event.compacted'),
      dot: 'done',
      body: i18n.t('timeline.body.compactedShort'),
      ts,
      renderMarkdown: false,
    },
  ],
  task_started: (c, ts) => [
    {
      label: i18n.t('timeline.event.subtask'),
      dot: 'running',
      body: c?.description || '',
      ts,
      renderMarkdown: false,
    },
  ],
  task_notification: (c, ts) => {
    const st = c?.status || 'completed';
    return [
      {
        label: i18n.t('timeline.event.subtaskStatus', { status: st }),
        dot: st === 'failed' ? 'error' : 'done',
        body: c?.summary || '',
        ts,
        renderMarkdown: false,
      },
    ];
  },
  subagent_stop: (c, ts) => [
    {
      label: i18n.t('timeline.event.subagentDone'),
      dot: 'done',
      body: c?.message || '',
      ts,
      renderMarkdown: false,
    },
  ],
  permission_denied: (c, ts) => [
    {
      label: i18n.t('timeline.event.permissionDenied'),
      dot: 'error',
      body: c?.message || `${c?.tool}: ${c?.reason}`,
      ts,
      renderMarkdown: false,
    },
  ],
  tool_failed: (c, ts) => [
    {
      label: i18n.t('timeline.event.toolFailed'),
      dot: 'error',
      body: c?.message || `${c?.tool}: ${c?.error}`,
      ts,
      renderMarkdown: false,
    },
  ],
  pre_compact: (_c, ts) => [
    {
      label: i18n.t('timeline.event.compacting'),
      dot: 'thinking',
      body: i18n.t('timeline.body.compactingStart'),
      ts,
      renderMarkdown: false,
    },
  ],
  post_compact: (_c, ts) => [
    {
      label: i18n.t('timeline.event.compacted'),
      dot: 'done',
      body: i18n.t('timeline.body.compactingDone'),
      ts,
      renderMarkdown: false,
    },
  ],
  session_start: (_c, ts) => [
    {
      label: i18n.t('timeline.event.session'),
      dot: 'done',
      body: i18n.t('timeline.body.sessionInitialized'),
      ts,
      renderMarkdown: false,
    },
  ],
  session_end: (_c, ts) => [
    {
      label: i18n.t('timeline.event.sessionEnd'),
      dot: 'done',
      body: i18n.t('timeline.body.sessionEnded'),
      ts,
      renderMarkdown: false,
    },
  ],
  task_progress: () => [],
  hook_started: () => [],
  hook_progress: () => [],
  hook_response: () => [],
  prompt_submitted: () => [],
};

// --- Top-level type dispatch map ---
export const TYPE_HANDLERS = {
  tool_progress: (c, ts) => {
    const tool = c?.tool_name || i18n.t('common.unknown');
    return [
      {
        label: `${tool}`,
        dot: 'running',
        body: i18n.t('timeline.body.toolElapsed', { seconds: c?.elapsed_time_seconds || 0 }),
        ts,
        renderMarkdown: false,
      },
    ];
  },
  rate_limit_event: (c, ts) => [
    {
      label: i18n.t('timeline.event.rateLimit'),
      dot: 'error',
      body: c?.rate_limit_info?.status || i18n.t('timeline.body.rateLimited'),
      ts,
      renderMarkdown: false,
    },
  ],
  stream_event: () => [],
  stderr: (c, ts) => [
    {
      label: i18n.t('timeline.event.stderr'),
      dot: 'error',
      body: c?.text || '',
      ts,
      renderMarkdown: false,
    },
  ],
  raw: (c, ts) => [
    {
      label: i18n.t('timeline.event.output'),
      dot: 'done',
      body: c?.text || '',
      ts,
      renderMarkdown: false,
    },
  ],
  result: (c, ts) => {
    const {
      total_cost_usd: cost,
      usage: tokens,
      duration_ms: duration,
      num_turns: turns,
    } = c || {};
    if (cost == null && !tokens && !duration && !turns) return [];
    const parts = [];
    if (turns) parts.push(i18n.t('timeline.body.statsTurns', { count: turns }));
    if (duration)
      parts.push(i18n.t('timeline.body.statsDuration', { seconds: (duration / 1000).toFixed(1) }));
    if (tokens)
      parts.push(
        i18n.t('timeline.body.statsTokens', {
          count: (tokens.input_tokens || 0) + (tokens.output_tokens || 0),
        }),
      );
    if (cost) parts.push(i18n.t('timeline.body.statsCost', { cost: cost.toFixed(4) }));
    return [
      {
        label: i18n.t('timeline.event.stats'),
        dot: 'done',
        body: parts.join(' | '),
        ts,
        renderMarkdown: false,
      },
    ];
  },
};

// --- Content block dispatch map ---
export const BLOCK_HANDLERS = {
  thinking: (b, ts) => ({
    label: i18n.t('timeline.event.thinking'),
    dot: 'thinking',
    body: b.thinking || b.text || '',
    ts,
    renderMarkdown: true,
  }),
  text: (b, ts) =>
    b.text
      ? {
          label: i18n.t('timeline.event.assistant'),
          dot: 'done',
          body: b.text,
          ts,
          renderMarkdown: true,
        }
      : null,
  tool_use: (b, ts) => ({
    label: i18n.t('timeline.event.toolColon', { name: b.name || i18n.t('common.unknown') }),
    dot: 'tool',
    body: typeof b.input === 'string' ? b.input : JSON.stringify(b.input, null, 2),
    ts,
    renderMarkdown: false,
  }),
  tool_result: (b, ts) => ({
    label: b.is_error ? i18n.t('timeline.event.toolError') : i18n.t('timeline.event.toolResult'),
    dot: b.is_error ? 'error' : 'done',
    body:
      typeof b.content === 'string'
        ? b.content
        : b.output || JSON.stringify(b.content, null, 2) || '',
    ts,
    renderMarkdown: !b.is_error,
  }),
};

export function parseBlock(block, ts) {
  if (!block) return null;
  const handler = BLOCK_HANDLERS[block.type];
  if (handler) return handler(block, ts);
  return {
    label: block.type || i18n.t('timeline.event.block'),
    dot: 'done',
    body: JSON.stringify(block, null, 2),
    ts,
    renderMarkdown: false,
  };
}

export function flattenEvent(event) {
  const { type, content } = event;
  const ts = event.timestamp;
  const subtype = event.subtype || content?.subtype;

  if (type === 'system') {
    const handler = SYSTEM_HANDLERS[subtype];
    if (handler) return handler(content, ts);
    const body = content?.message || content?.text || subtype || '';
    return body
      ? [{ label: i18n.t('timeline.event.system'), dot: 'done', body, ts, renderMarkdown: false }]
      : [];
  }

  const typeHandler = TYPE_HANDLERS[type];
  if (typeHandler) return typeHandler(content, ts);

  const blocks = content?.content || content?.message?.content;
  if (Array.isArray(blocks)) return blocks.map((b) => parseBlock(b, ts)).filter(Boolean);

  if (type === 'assistant' && typeof content?.text === 'string') {
    return content.text
      ? [
          {
            label: i18n.t('timeline.event.assistant'),
            dot: 'done',
            body: content.text,
            ts,
            renderMarkdown: true,
          },
        ]
      : [];
  }

  if (content?.tool_result) {
    const err = Boolean(content?.is_error);
    return [
      {
        label: err ? i18n.t('timeline.event.toolError') : i18n.t('timeline.event.toolResult'),
        dot: err ? 'error' : 'done',
        body: content.tool_result,
        ts,
        renderMarkdown: !err,
      },
    ];
  }

  const raw = JSON.stringify(content, null, 2);
  return raw && raw !== '{}'
    ? [
        {
          label: i18n.t('timeline.event.eventFallback', { type: type || 'event' }),
          dot: 'done',
          body: raw,
          ts,
          renderMarkdown: false,
        },
      ]
    : [];
}

function truncate(text, max = 5000) {
  if (typeof text !== 'string') text = String(text);
  return text.length > max ? text.slice(0, max) + '...' : text;
}

function TimelineItem({ item, index, sessionId }) {
  const { t } = useTranslation();
  const useMarkdown = item.renderMarkdown === true;
  const toolResultLabel = t('timeline.event.toolResult');

  // UX Enhancement: Detect if body is a JSON array (for DataAnalystTool)
  let tableData = null;
  if (item.label === toolResultLabel && item.dot !== 'error') {
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
  if (item.label === toolResultLabel && item.dot !== 'error') {
    const pdfMatch = item.body.match(/File: (.*\.pdf)/i);
    if (pdfMatch) pdfFile = pdfMatch[1];
  }

  return (
    <div
      className={`${styles.event} animate-in`}
      style={{ animationDelay: `${Math.min(index, 20) * 30}ms` }}
    >
      <div className={styles.eventGutter}>
        <span className={`dot dot-${item.dot}`} />
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

function buildDisplayItems(events) {
  const items = [];
  for (let ei = 0; ei < events.length; ei++) {
    const flat = flattenEvent(events[ei]);
    for (let bi = 0; bi < flat.length; bi++) {
      items.push({ ...flat[bi], key: `${ei}-${bi}` });
    }
  }
  return items;
}

export default function AgentTimeline({ events, status, sessionId }) {
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
      <div className="panel">
        <div className="panel-header">
          <span className="dot dot-done" />
          {t('timeline.title')}
        </div>
        <div className="empty-state">
          <div className="empty-state-title">{t('timeline.emptyTitle')}</div>
          <div>{t('timeline.emptyHint')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <span className={`dot ${status === 'running' ? 'dot-running' : 'dot-done'}`} />
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
            <span className="dot dot-running" />
            <span>{t('timeline.working')}</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
