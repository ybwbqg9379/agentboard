import { useEffect, useRef } from 'react';
import styles from './TerminalView.module.css';

function extractTerminalLines(events) {
  const lines = [];

  for (const event of events) {
    const { type, content } = event;

    // 提取嵌套在 content blocks 中的 Bash 命令和结果
    const blocks = content?.content || content?.message?.content;
    if (Array.isArray(blocks)) {
      for (const block of blocks) {
        if (block.type === 'tool_use' && (block.name === 'Bash' || block.name === 'bash')) {
          const cmd = block.input?.command || (typeof block.input === 'string' ? block.input : '');
          if (cmd) lines.push({ type: 'command', text: cmd });
        }
        if (block.type === 'tool_result') {
          const output = typeof block.content === 'string' ? block.content : block.output || '';
          if (output) lines.push({ type: block.is_error ? 'error' : 'output', text: output });
        }
      }
    }

    // 顶层 tool_use（旧格式兼容）
    if (type === 'tool_use' && (content?.name === 'Bash' || content?.name === 'bash')) {
      const cmd = content?.input?.command || content?.input;
      if (cmd) lines.push({ type: 'command', text: typeof cmd === 'string' ? cmd : JSON.stringify(cmd) });
    }

    // 顶层 tool_result
    if (type === 'tool_result') {
      const output = content?.output || (typeof content?.content === 'string' ? content.content : '');
      if (output) lines.push({ type: content?.is_error ? 'error' : 'output', text: output });
    }

    // stderr
    if (type === 'stderr') {
      lines.push({ type: 'error', text: content?.text || '' });
    }
  }

  return lines;
}

export default function TerminalView({ events }) {
  const bottomRef = useRef(null);
  const lines = extractTerminalLines(events);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines.length]);

  return (
    <div className="panel">
      <div className="panel-header">
        <span className="dot dot-tool" />
        Terminal
      </div>
      {lines.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">No terminal output</div>
          <div>Commands executed by the agent will appear here</div>
        </div>
      ) : (
        <div className={`panel-body ${styles.terminal}`}>
          {lines.map((line, i) => (
            <div key={i} className={`${styles.line} ${styles[line.type]}`}>
              {line.type === 'command' && <span className={styles.prompt}>$</span>}
              <pre className={styles.text}>{line.text}</pre>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
