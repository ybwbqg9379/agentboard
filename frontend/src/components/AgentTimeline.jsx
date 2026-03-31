import { useEffect, useMemo, useRef } from 'react';
import MarkdownBody from './MarkdownBody.jsx';
import styles from './AgentTimeline.module.css';

/**
 * 将 Claude Code stream-json 事件解析为展示用的扁平事件列表。
 * stream-json 的顶层事件有 assistant / user / system / result 等类型，
 * 其中 assistant 和 user 的 content 是 content block 数组，
 * 需要拆开展示。
 */
function flattenEvent(event) {
  const { type, content } = event;
  const ts = event.timestamp;
  const subtype = event.subtype || content?.subtype;

  // --- system messages (23 subtypes) ---
  if (type === 'system') {
    if (subtype === 'init') {
      const model = content?.model || 'unknown';
      const toolCount = content?.tools?.length || 0;
      const mcpCount = content?.mcp_servers?.length || 0;
      const skillCount = content?.skills?.length || 0;
      const parts = [`Model: ${model}`, `Tools: ${toolCount}`, `MCP: ${mcpCount}`];
      if (skillCount > 0) parts.push(`Skills: ${skillCount}`);
      return [{ label: 'Session Init', dot: 'done', body: parts.join(' | '), ts }];
    }
    if (subtype === 'api_retry') {
      const attempt = content?.attempt || '?';
      const max = content?.max_retries || '?';
      const delay = content?.retry_delay_ms || 0;
      return [
        { label: 'API Retry', dot: 'error', body: `Retry ${attempt}/${max} (${delay}ms)`, ts },
      ];
    }
    if (subtype === 'status') {
      if (content?.status === 'compacting')
        return [{ label: 'Compacting', dot: 'thinking', body: 'Context compacting...', ts }];
      return [];
    }
    if (subtype === 'compact_boundary')
      return [{ label: 'Compacted', dot: 'done', body: 'Context window compacted', ts }];
    if (subtype === 'task_started')
      return [{ label: 'Subtask', dot: 'running', body: content?.description || '', ts }];
    if (subtype === 'task_notification') {
      const st = content?.status || 'completed';
      return [
        {
          label: `Subtask ${st}`,
          dot: st === 'failed' ? 'error' : 'done',
          body: content?.summary || '',
          ts,
        },
      ];
    }
    if (subtype === 'task_progress') return []; // skip noisy progress
    if (subtype === 'hook_started' || subtype === 'hook_progress' || subtype === 'hook_response')
      return [];
    if (subtype === 'subagent_stop')
      return [{ label: 'Subagent Done', dot: 'done', body: content?.message || '', ts }];
    if (subtype === 'permission_denied')
      return [
        {
          label: 'Permission Denied',
          dot: 'error',
          body: content?.message || `${content?.tool}: ${content?.reason}`,
          ts,
        },
      ];
    if (subtype === 'prompt_submitted') return []; // audit only
    if (subtype === 'pre_compact')
      return [{ label: 'Compacting', dot: 'thinking', body: 'Context compaction starting...', ts }];
    if (subtype === 'post_compact')
      return [{ label: 'Compacted', dot: 'done', body: 'Context compaction completed', ts }];
    if (subtype === 'session_start')
      return [{ label: 'Session', dot: 'done', body: 'Session initialized', ts }];
    if (subtype === 'session_end')
      return [{ label: 'Session End', dot: 'done', body: 'Session ended', ts }];
    if (subtype === 'tool_failed')
      return [
        {
          label: 'Tool Failed',
          dot: 'error',
          body: content?.message || `${content?.tool}: ${content?.error}`,
          ts,
        },
      ];
    const body = content?.message || content?.text || subtype || '';
    return body ? [{ label: 'System', dot: 'done', body, ts }] : [];
  }

  // --- tool progress ---
  if (type === 'tool_progress') {
    const tool = content?.tool_name || 'unknown';
    const elapsed = content?.elapsed_time_seconds || 0;
    return [{ label: `${tool}`, dot: 'running', body: `${elapsed}s elapsed`, ts }];
  }

  // --- rate limit ---
  if (type === 'rate_limit_event') {
    const info = content?.rate_limit_info;
    return [{ label: 'Rate Limit', dot: 'error', body: info?.status || 'Rate limited', ts }];
  }

  // --- stream events (partial messages) ---
  if (type === 'stream_event') return []; // rendered separately if needed

  if (type === 'stderr') {
    return [{ label: 'Stderr', dot: 'error', body: content?.text || '', ts }];
  }
  if (type === 'raw') {
    return [{ label: 'Output', dot: 'done', body: content?.text || '', ts }];
  }

  // --- result with stats (skip result text to avoid duplicating assistant message) ---
  if (type === 'result') {
    const items = [];
    const cost = content?.total_cost_usd;
    const tokens = content?.usage;
    const duration = content?.duration_ms;
    const turns = content?.num_turns;
    if (cost != null || tokens || duration || turns) {
      const parts = [];
      if (turns) parts.push(`${turns} turns`);
      if (duration) parts.push(`${(duration / 1000).toFixed(1)}s`);
      if (tokens) parts.push(`${(tokens.input_tokens || 0) + (tokens.output_tokens || 0)} tokens`);
      if (cost) parts.push(`$${cost.toFixed(4)}`);
      items.push({ label: 'Stats', dot: 'done', body: parts.join(' | '), ts });
    }
    return items;
  }

  // assistant / user -- 拆开 content blocks
  const blocks = content?.content || content?.message?.content;
  if (Array.isArray(blocks)) {
    return blocks.map((block) => parseBlock(block, ts)).filter(Boolean);
  }

  // assistant 直接有 text
  if (type === 'assistant' && typeof content?.text === 'string') {
    return content.text ? [{ label: 'Assistant', dot: 'done', body: content.text, ts }] : [];
  }

  // tool_result 顶层（旧格式兼容）
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

  // fallback -- 展示原始 JSON
  const raw = JSON.stringify(content, null, 2);
  return raw && raw !== '{}' ? [{ label: type || 'Event', dot: 'done', body: raw, ts }] : [];
}

function parseBlock(block, ts) {
  if (!block) return null;

  switch (block.type) {
    case 'thinking':
      return { label: 'Thinking', dot: 'thinking', body: block.thinking || block.text || '', ts };

    case 'text':
      return block.text ? { label: 'Assistant', dot: 'done', body: block.text, ts } : null;

    case 'tool_use':
      return {
        label: `Tool: ${block.name || 'unknown'}`,
        dot: 'tool',
        body: typeof block.input === 'string' ? block.input : JSON.stringify(block.input, null, 2),
        ts,
      };

    case 'tool_result': {
      const body =
        typeof block.content === 'string'
          ? block.content
          : block.output || JSON.stringify(block.content, null, 2) || '';
      return {
        label: block.is_error ? 'Tool Error' : 'Tool Result',
        dot: block.is_error ? 'error' : 'done',
        body,
        ts,
      };
    }

    default:
      return {
        label: block.type || 'Block',
        dot: 'done',
        body: JSON.stringify(block, null, 2),
        ts,
      };
  }
}

function truncate(text, max = 2000) {
  if (typeof text !== 'string') text = String(text);
  return text.length > max ? text.slice(0, max) + '...' : text;
}

// Labels whose body should be rendered as markdown instead of raw pre
const MARKDOWN_LABELS = new Set(['Assistant', 'Result', 'Tool Result']);

function TimelineItem({ item, index }) {
  const useMarkdown = MARKDOWN_LABELS.has(item.label);

  return (
    <div className={`${styles.event} animate-in`} style={{ animationDelay: `${index * 30}ms` }}>
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
        {item.body &&
          (useMarkdown ? (
            <MarkdownBody>{truncate(item.body)}</MarkdownBody>
          ) : (
            <pre className={styles.eventBody}>{truncate(item.body)}</pre>
          ))}
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

export default function AgentTimeline({ events, status }) {
  const bottomRef = useRef(null);
  const displayItems = useMemo(() => buildDisplayItems(events), [events]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
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
          <TimelineItem key={item.key} item={item} index={i} />
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
