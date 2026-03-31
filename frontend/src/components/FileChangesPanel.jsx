import { useMemo } from 'react';
import styles from './FileChangesPanel.module.css';

/**
 * Extract file operations from events (Read, Write, Edit tool calls).
 */
function extractFileChanges(events) {
  const files = new Map(); // path -> { reads, writes, edits }

  for (const event of events) {
    const blocks = event.content?.content || event.content?.message?.content;
    if (!Array.isArray(blocks)) continue;

    for (const block of blocks) {
      if (block.type !== 'tool_use') continue;

      const path = block.input?.file_path || block.input?.path || block.input?.filePath || null;
      if (!path) continue;

      if (!files.has(path)) {
        files.set(path, { reads: 0, writes: 0, edits: 0, firstSeen: event.timestamp });
      }
      const entry = files.get(path);

      if (block.name === 'Read') entry.reads++;
      else if (block.name === 'Write') entry.writes++;
      else if (block.name === 'Edit') entry.edits++;
    }
  }

  return [...files.entries()]
    .map(([path, info]) => ({ path, ...info }))
    .sort((a, b) => b.writes + b.edits - (a.writes + a.edits) || a.path.localeCompare(b.path));
}

function basename(path) {
  return path.split('/').pop() || path;
}

export default function FileChangesPanel({ events }) {
  const files = useMemo(() => extractFileChanges(events), [events]);

  if (files.length === 0) {
    return (
      <div className={styles.panel}>
        <div className={styles.header}>Files Touched</div>
        <div className={styles.empty}>No file operations yet</div>
      </div>
    );
  }

  const modified = files.filter((f) => f.writes > 0 || f.edits > 0);
  const readOnly = files.filter((f) => f.writes === 0 && f.edits === 0);

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        Files Touched
        <span className={styles.count}>{files.length}</span>
      </div>
      <div className={styles.list}>
        {modified.length > 0 && (
          <div className={styles.group}>
            <div className={styles.groupLabel}>Modified ({modified.length})</div>
            {modified.map((f) => (
              <div key={f.path} className={styles.file}>
                <span className={styles.dot} style={{ background: 'var(--status-running)' }} />
                <span className={styles.name} title={f.path}>
                  {basename(f.path)}
                </span>
                <span className={styles.ops}>
                  {f.writes > 0 && <span className={styles.write}>W{f.writes}</span>}
                  {f.edits > 0 && <span className={styles.edit}>E{f.edits}</span>}
                  {f.reads > 0 && <span className={styles.read}>R{f.reads}</span>}
                </span>
              </div>
            ))}
          </div>
        )}
        {readOnly.length > 0 && (
          <div className={styles.group}>
            <div className={styles.groupLabel}>Read Only ({readOnly.length})</div>
            {readOnly.map((f) => (
              <div key={f.path} className={styles.file}>
                <span className={styles.dot} style={{ background: 'var(--text-tertiary)' }} />
                <span className={styles.name} title={f.path}>
                  {basename(f.path)}
                </span>
                <span className={styles.ops}>
                  <span className={styles.read}>R{f.reads}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
