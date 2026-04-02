import { useEffect, useMemo, useRef } from 'react';
import styles from './TerminalView.module.css';

const BASH_NAMES = new Set(['Bash', 'bash']);

/**
 * Map a tool_use block to a terminal-displayable command.
 * Returns { prefix, text } or null if the tool should not appear in terminal.
 */
export function getCommandDisplay(name, input) {
  if (BASH_NAMES.has(name)) {
    const cmd = input?.command || (typeof input === 'string' ? input : '');
    return cmd ? { prefix: '$', text: cmd } : null;
  }
  if (name === 'WebSearch') {
    return input?.query ? { prefix: '?', text: input.query } : null;
  }
  if (name === 'WebFetch') {
    return input?.url ? { prefix: '>', text: input.url } : null;
  }
  if (name === 'mcp__browser__browser_navigate') {
    return input?.url ? { prefix: '>', text: input.url } : null;
  }
  if (name === 'mcp__browser__browser_snapshot') {
    return { prefix: '>', text: 'browser snapshot' };
  }
  if (name === 'mcp__browser__browser_click') {
    return { prefix: '>', text: `click ${input?.element || input?.selector || ''}`.trim() };
  }
  if (name === 'mcp__browser__browser_type') {
    return { prefix: '>', text: `type "${input?.text || ''}"` };
  }
  return null;
}

export function extractTerminalLines(events) {
  const lines = [];
  let lineIdx = 0;
  // Track Bash tool_use IDs so we only show their corresponding tool_results
  const bashToolIds = new Set();

  for (const event of events) {
    const { type, content } = event;

    const blocks = content?.content || content?.message?.content;
    if (Array.isArray(blocks)) {
      for (const block of blocks) {
        if (block.type === 'tool_use') {
          const display = getCommandDisplay(block.name, block.input);
          if (display) {
            if (block.id && BASH_NAMES.has(block.name)) bashToolIds.add(block.id);
            lines.push({
              type: 'command',
              prefix: display.prefix,
              text: display.text,
              key: `cmd-${lineIdx++}`,
            });
          }
        }
        // Only show tool_result output for Bash tools
        if (
          block.type === 'tool_result' &&
          block.tool_use_id &&
          bashToolIds.has(block.tool_use_id)
        ) {
          const output = typeof block.content === 'string' ? block.content : block.output || '';
          if (output)
            lines.push({
              type: block.is_error ? 'error' : 'output',
              text: output,
              key: `out-${lineIdx++}`,
            });
        }
      }
    }

    // Top-level tool_use
    if (type === 'tool_use') {
      const display = getCommandDisplay(content?.name, content?.input || content);
      if (display) {
        if (content?.id && BASH_NAMES.has(content.name)) bashToolIds.add(content.id);
        lines.push({
          type: 'command',
          prefix: display.prefix,
          text: display.text,
          key: `cmd-${lineIdx++}`,
        });
      }
    }

    // Top-level tool_result -- only for Bash
    if (type === 'tool_result' && content?.tool_use_id && bashToolIds.has(content.tool_use_id)) {
      const output =
        content?.output || (typeof content?.content === 'string' ? content.content : '');
      if (output)
        lines.push({
          type: content?.is_error ? 'error' : 'output',
          text: output,
          key: `out-${lineIdx++}`,
        });
    }

    // stderr
    if (type === 'stderr') {
      lines.push({ type: 'error', text: content?.text || '', key: `err-${lineIdx++}` });
    }
  }

  return lines;
}

export default function TerminalView({ events }) {
  const bottomRef = useRef(null);
  const lines = useMemo(() => extractTerminalLines(events), [events]);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'instant' });
    });
    return () => cancelAnimationFrame(id);
  }, [lines.length]);

  if (lines.length === 0) {
    return (
      <div className={styles.empty}>
        <div>No terminal output</div>
        <div>Commands executed by the agent will appear here</div>
      </div>
    );
  }

  return (
    <div className={styles.terminal}>
      {lines.map((line) => (
        <div key={line.key} className={`${styles.line} ${styles[line.type]}`}>
          {line.type === 'command' && <span className={styles.prompt}>{line.prefix || '$'}</span>}
          <pre className={styles.text}>{line.text}</pre>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
