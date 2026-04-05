import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './TerminalView.module.css';

const BASH_NAMES = new Set(['Bash', 'bash']);

/**
 * Map a tool_use block to a terminal-displayable command.
 * Returns { prefix, text } or null if the tool should not appear in terminal.
 */
export function getCommandDisplay(name, input, t) {
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
    return { prefix: '>', text: t('terminal.browserSnapshot') };
  }
  if (name === 'mcp__browser__browser_click') {
    const target = `${input?.element || input?.selector || ''}`.trim();
    return {
      prefix: '>',
      text: target ? t('terminal.browserClick', { target }) : t('terminal.browserClickBare'),
    };
  }
  if (name === 'mcp__browser__browser_type') {
    return { prefix: '>', text: t('terminal.browserType', { text: input?.text || '' }) };
  }
  return null;
}

export function extractTerminalLines(events, t) {
  const lines = [];
  let lineIdx = 0;
  const bashToolIds = new Set();

  for (const event of events) {
    const { type, content } = event;

    const blocks = content?.content || content?.message?.content;
    if (Array.isArray(blocks)) {
      for (const block of blocks) {
        if (block.type === 'tool_use') {
          const display = getCommandDisplay(block.name, block.input, t);
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

    if (type === 'tool_use') {
      const display = getCommandDisplay(content?.name, content?.input || content, t);
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

    if (type === 'stderr') {
      lines.push({ type: 'error', text: content?.text || '', key: `err-${lineIdx++}` });
    }
  }

  return lines;
}

export default function TerminalView({ events }) {
  const { t } = useTranslation();
  const bottomRef = useRef(null);
  const lines = useMemo(() => extractTerminalLines(events, t), [events, t]);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'instant' });
    });
    return () => cancelAnimationFrame(id);
  }, [lines.length]);

  if (lines.length === 0) {
    return (
      <div className={styles.empty}>
        <div>{t('terminal.emptyTitle')}</div>
        <div>{t('terminal.emptyHint')}</div>
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
