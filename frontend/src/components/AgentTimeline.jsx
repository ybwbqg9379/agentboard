import { useEffect, useMemo, useRef } from 'react';
import MarkdownBody from './MarkdownBody.jsx';
import styles from './AgentTimeline.module.css';

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
  const downloadUrl = `/api/sessions/${sessionId}/files/${encodeURIComponent(fileName)}`;

  return (
    <a href={downloadUrl} download={fileName} className={styles.downloadBtn}>
      <span className={styles.downloadIcon}>📄</span>
      Download {fileName}
    </a>
  );
};

// --- System subtype dispatch map ---
export const SYSTEM_HANDLERS = {
  init: (c, ts) => {
    const parts = [
      `Model: ${c?.model || 'unknown'}`,
      `Tools: ${c?.tools?.length || 0}`,
      `MCP: ${c?.mcp_servers?.length || 0}`,
    ];
    if (c?.skills?.length) parts.push(`Skills: ${c.skills.length}`);
    return [{ label: 'Session Init', dot: 'done', body: parts.join(' | '), ts }];
  },
  api_retry: (c, ts) => [
    {
      label: 'API Retry',
      dot: 'error',
      body: `Retry ${c?.attempt || '?'}/${c?.max_retries || '?'} (${c?.retry_delay_ms || 0}ms)`,
      ts,
    },
  ],
  status: (c, ts) =>
    c?.status === 'compacting'
      ? [{ label: 'Compacting', dot: 'thinking', body: 'Context compacting...', ts }]
      : [],
  compact_boundary: (_c, ts) => [
    { label: 'Compacted', dot: 'done', body: 'Context window compacted', ts },
  ],
  task_started: (c, ts) => [{ label: 'Subtask', dot: 'running', body: c?.description || '', ts }],
  task_notification: (c, ts) => {
    const st = c?.status || 'completed';
    return [
      {
        label: `Subtask ${st}`,
        dot: st === 'failed' ? 'error' : 'done',
        body: c?.summary || '',
        ts,
      },
    ];
  },
  subagent_stop: (c, ts) => [{ label: 'Subagent Done', dot: 'done', body: c?.message || '', ts }],
  permission_denied: (c, ts) => [
    {
      label: 'Permission Denied',
      dot: 'error',
      body: c?.message || `${c?.tool}: ${c?.reason}`,
      ts,
    },
  ],
  tool_failed: (c, ts) => [
    { label: 'Tool Failed', dot: 'error', body: c?.message || `${c?.tool}: ${c?.error}`, ts },
  ],
  pre_compact: (_c, ts) => [
    { label: 'Compacting', dot: 'thinking', body: 'Context compaction starting...', ts },
  ],
  post_compact: (_c, ts) => [
    { label: 'Compacted', dot: 'done', body: 'Context compaction completed', ts },
  ],
  session_start: (_c, ts) => [{ label: 'Session', dot: 'done', body: 'Session initialized', ts }],
  session_end: (_c, ts) => [{ label: 'Session End', dot: 'done', body: 'Session ended', ts }],
  // Silent subtypes
  task_progress: () => [],
  hook_started: () => [],
  hook_progress: () => [],
  hook_response: () => [],
  prompt_submitted: () => [],
};

// --- Top-level type dispatch map ---
export const TYPE_HANDLERS = {
  tool_progress: (c, ts) => {
    const tool = c?.tool_name || 'unknown';
    return [
      { label: `${tool}`, dot: 'running', body: `${c?.elapsed_time_seconds || 0}s elapsed`, ts },
    ];
  },
  rate_limit_event: (c, ts) => [
    { label: 'Rate Limit', dot: 'error', body: c?.rate_limit_info?.status || 'Rate limited', ts },
  ],
  stream_event: () => [],
  stderr: (c, ts) => [{ label: 'Stderr', dot: 'error', body: c?.text || '', ts }],
  raw: (c, ts) => [{ label: 'Output', dot: 'done', body: c?.text || '', ts }],
  result: (c, ts) => {
    const {
      total_cost_usd: cost,
      usage: tokens,
      duration_ms: duration,
      num_turns: turns,
    } = c || {};
    if (cost == null && !tokens && !duration && !turns) return [];
    const parts = [];
    if (turns) parts.push(`${turns} turns`);
    if (duration) parts.push(`${(duration / 1000).toFixed(1)}s`);
    if (tokens) parts.push(`${(tokens.input_tokens || 0) + (tokens.output_tokens || 0)} tokens`);
    if (cost) parts.push(`$${cost.toFixed(4)}`);
    return [{ label: 'Stats', dot: 'done', body: parts.join(' | '), ts }];
  },
};

// --- Content block dispatch map ---
export const BLOCK_HANDLERS = {
  thinking: (b, ts) => ({
    label: 'Thinking',
    dot: 'thinking',
    body: b.thinking || b.text || '',
    ts,
  }),
  text: (b, ts) => (b.text ? { label: 'Assistant', dot: 'done', body: b.text, ts } : null),
  tool_use: (b, ts) => ({
    label: `Tool: ${b.name || 'unknown'}`,
    dot: 'tool',
    body: typeof b.input === 'string' ? b.input : JSON.stringify(b.input, null, 2),
    ts,
  }),
  tool_result: (b, ts) => ({
    label: b.is_error ? 'Tool Error' : 'Tool Result',
    dot: b.is_error ? 'error' : 'done',
    body:
      typeof b.content === 'string'
        ? b.content
        : b.output || JSON.stringify(b.content, null, 2) || '',
    ts,
  }),
};

export function parseBlock(block, ts) {
  if (!block) return null;
  const handler = BLOCK_HANDLERS[block.type];
  if (handler) return handler(block, ts);
  return { label: block.type || 'Block', dot: 'done', body: JSON.stringify(block, null, 2), ts };
}

export function flattenEvent(event) {
  const { type, content } = event;
  const ts = event.timestamp;
  const subtype = event.subtype || content?.subtype;

  // System messages -- dispatch by subtype
  if (type === 'system') {
    const handler = SYSTEM_HANDLERS[subtype];
    if (handler) return handler(content, ts);
    const body = content?.message || content?.text || subtype || '';
    return body ? [{ label: 'System', dot: 'done', body, ts }] : [];
  }

  // Known top-level types
  const typeHandler = TYPE_HANDLERS[type];
  if (typeHandler) return typeHandler(content, ts);

  // Content blocks (assistant/user messages)
  const blocks = content?.content || content?.message?.content;
  if (Array.isArray(blocks)) return blocks.map((b) => parseBlock(b, ts)).filter(Boolean);

  // Assistant with direct text
  if (type === 'assistant' && typeof content?.text === 'string') {
    return content.text ? [{ label: 'Assistant', dot: 'done', body: content.text, ts }] : [];
  }

  // Legacy tool_result
  if (content?.tool_result) {
    return [
      {
        label: 'Tool Result',
        dot: content?.is_error ? 'error' : 'done',
        body: content.tool_result,
        ts,
      },
    ];
  }

  // Fallback
  const raw = JSON.stringify(content, null, 2);
  return raw && raw !== '{}' ? [{ label: type || 'Event', dot: 'done', body: raw, ts }] : [];
}

function truncate(text, max = 5000) {
  if (typeof text !== 'string') text = String(text);
  return text.length > max ? text.slice(0, max) + '...' : text;
}

// Labels whose body should be rendered as markdown instead of raw pre
const MARKDOWN_LABELS = new Set(['Assistant', 'Result', 'Tool Result']);

function TimelineItem({ item, index, sessionId }) {
  const useMarkdown = MARKDOWN_LABELS.has(item.label);

  // UX Enhancement: Detect if body is a JSON array (for DataAnalystTool)
  let tableData = null;
  if (item.label === 'Tool Result' && !item.is_error) {
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
  if (item.label === 'Tool Result' && !item.is_error) {
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
          Timeline
        </div>
        <div className="empty-state">
          <div className="empty-state-title">No active session</div>
          <div>Send a task to start the agent</div>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <span className={`dot ${status === 'running' ? 'dot-running' : 'dot-done'}`} />
        Timeline
        <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
          {displayItems.length} events
        </span>
      </div>
      <div className={`panel-body ${styles.timeline}`}>
        {displayItems.map((item, i) => (
          <TimelineItem key={item.key} item={item} index={i} sessionId={sessionId} />
        ))}
        {status === 'running' && (
          <div className={styles.runningIndicator}>
            <span className="dot dot-running" />
            <span>Agent is working...</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
