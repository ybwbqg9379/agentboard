import { useState, useRef } from 'react';
import styles from './ChatInput.module.css';

const PERMISSION_MODES = [
  { value: 'bypassPermissions', label: 'Bypass' },
  { value: 'acceptEdits', label: 'Accept Edits' },
  { value: 'default', label: 'Default' },
  { value: 'plan', label: 'Plan' },
];

export default function ChatInput({ onSend, onStop, status }) {
  const [value, setValue] = useState('');
  const [permissionMode, setPermissionMode] = useState('bypassPermissions');
  const inputRef = useRef(null);
  const isRunning = status === 'running';

  function handleSubmit(e) {
    e.preventDefault();
    const text = value.trim();
    if (!text || isRunning) return;
    onSend(text, { permissionMode });
    setValue('');
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  return (
    <form className={styles.wrapper} onSubmit={handleSubmit}>
      <div className={styles.inputRow}>
        <select
          className={styles.modeSelect}
          value={permissionMode}
          onChange={(e) => setPermissionMode(e.target.value)}
          disabled={isRunning}
          title="Permission mode"
        >
          {PERMISSION_MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <textarea
          ref={inputRef}
          className={styles.input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter a task for the agent..."
          rows={1}
          disabled={isRunning}
        />
        {isRunning ? (
          <button type="button" className={styles.stopBtn} onClick={onStop}>
            Stop
          </button>
        ) : (
          <button type="submit" className={styles.sendBtn} disabled={!value.trim()}>
            Run
          </button>
        )}
      </div>
    </form>
  );
}
