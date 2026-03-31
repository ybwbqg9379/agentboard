import { useEffect, useRef } from 'react';
import styles from './AgentTimeline.module.css';

function getEventMeta(event) {
  const { type, content } = event;

  switch (type) {
    case 'assistant':
      if (content?.subtype === 'thinking') {
        return { label: 'Thinking', dot: 'thinking', body: content.thinking || '' };
      }
      return { label: 'Assistant', dot: 'done', body: content?.text || content?.content?.[0]?.text || '' };

    case 'tool_use':
      return {
        label: `Tool: ${content?.name || content?.tool_name || 'unknown'}`,
        dot: 'tool',
        body: typeof content?.input === 'string'
          ? content.input
          : JSON.stringify(content?.input, null, 2) || '',
      };

    case 'tool_result':
      return {
        label: 'Tool Result',
        dot: content?.is_error ? 'error' : 'done',
        body: content?.output || content?.content || '',
      };

    case 'result':
      return { label: 'Result', dot: 'done', body: content?.result || content?.text || '' };

    case 'system':
      return { label: 'System', dot: 'done', body: content?.message || content?.text || '' };

    case 'stderr':
      return { label: 'Stderr', dot: 'error', body: content?.text || '' };

    case 'raw':
      return { label: 'Output', dot: 'done', body: content?.text || '' };

    default:
      return { label: type || 'Event', dot: 'done', body: JSON.stringify(content, null, 2) };
  }
}

function truncate(text, max = 2000) {
  if (typeof text !== 'string') text = String(text);
  return text.length > max ? text.slice(0, max) + '...' : text;
}

function TimelineEvent({ event, index }) {
  const meta = getEventMeta(event);

  return (
    <div className={`${styles.event} animate-in`} style={{ animationDelay: `${index * 30}ms` }}>
      <div className={styles.eventGutter}>
        <span className={`dot dot-${meta.dot}`} />
        <span className={styles.eventLine} />
      </div>
      <div className={styles.eventContent}>
        <div className={styles.eventHeader}>
          <span className={styles.eventLabel}>{meta.label}</span>
          <span className={styles.eventTime}>
            {new Date(event.timestamp).toLocaleTimeString()}
          </span>
        </div>
        {meta.body && (
          <pre className={styles.eventBody}>{truncate(meta.body)}</pre>
        )}
      </div>
    </div>
  );
}

export default function AgentTimeline({ events, status }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  if (events.length === 0 && status === 'idle') {
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
          {events.length} events
        </span>
      </div>
      <div className={`panel-body ${styles.timeline}`}>
        {events.map((event, i) => (
          <TimelineEvent key={i} event={event} index={i} />
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
