import { useEffect, useMemo, useRef } from 'react';
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

  // system / stderr / raw / result -- 直接展示
  if (type === 'system') {
    const body = content?.message || content?.text || content?.subtype || '';
    return body ? [{ label: 'System', dot: 'done', body, ts }] : [];
  }
  if (type === 'stderr') {
    return [{ label: 'Stderr', dot: 'error', body: content?.text || '', ts }];
  }
  if (type === 'raw') {
    return [{ label: 'Output', dot: 'done', body: content?.text || '', ts }];
  }
  if (type === 'result') {
    const body = content?.result || content?.text || '';
    return body ? [{ label: 'Result', dot: 'done', body, ts }] : [];
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

function TimelineItem({ item, index }) {
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
        {item.body && <pre className={styles.eventBody}>{truncate(item.body)}</pre>}
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
