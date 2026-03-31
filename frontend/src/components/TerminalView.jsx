import { useEffect, useMemo, useRef } from 'react';
import styles from './TerminalView.module.css';

function isBashTool(name) {
  return name === 'Bash' || name === 'bash';
}

function extractTerminalLines(events) {
  const lines = [];
  let lineIdx = 0;
  // Track Bash tool_use IDs so we only show their corresponding tool_results
  const bashToolIds = new Set();

  for (const event of events) {
    const { type, content } = event;

    const blocks = content?.content || content?.message?.content;
    if (Array.isArray(blocks)) {
      for (const block of blocks) {
        if (block.type === 'tool_use' && isBashTool(block.name)) {
          if (block.id) bashToolIds.add(block.id);
          const cmd = block.input?.command || (typeof block.input === 'string' ? block.input : '');
          if (cmd) lines.push({ type: 'command', text: cmd, key: `cmd-${lineIdx++}` });
        }
        // Only show tool_result for Bash tools
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

    // 顶层 tool_use
    if (type === 'tool_use' && isBashTool(content?.name)) {
      if (content?.id) bashToolIds.add(content.id);
      const cmd = content?.input?.command || content?.input;
      if (cmd)
        lines.push({
          type: 'command',
          text: typeof cmd === 'string' ? cmd : JSON.stringify(cmd),
          key: `cmd-${lineIdx++}`,
        });
    }

    // 顶层 tool_result -- only for Bash
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
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
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
          {line.type === 'command' && <span className={styles.prompt}>$</span>}
          <pre className={styles.text}>{line.text}</pre>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
