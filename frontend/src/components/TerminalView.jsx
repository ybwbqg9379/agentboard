import { useEffect, useRef } from 'react';
import styles from './TerminalView.module.css';

function extractTerminalLines(events) {
  const lines = [];
  for (const event of events) {
    const { type, content } = event;

    if (type === 'tool_use' && content?.name === 'Bash') {
      const cmd = content?.input?.command || content?.input;
      if (cmd) {
        lines.push({ type: 'command', text: typeof cmd === 'string' ? cmd : JSON.stringify(cmd) });
      }
    }

    if (type === 'tool_result') {
      const output = content?.output || content?.content;
      if (output && typeof output === 'string') {
        lines.push({ type: 'output', text: output });
      }
    }

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
