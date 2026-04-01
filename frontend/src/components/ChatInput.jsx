import { useState, useRef } from 'react';
import styles from './ChatInput.module.css';
import Dropdown from './Dropdown';

const PERMISSION_MODES = [
  { value: 'bypassPermissions', label: 'Bypass' },
  { value: 'acceptEdits', label: 'Accept Edits' },
  { value: 'default', label: 'Default' },
  { value: 'plan', label: 'Plan' },
];

// Statuses that allow sending a follow-up message
const CONTINUABLE = new Set(['completed', 'failed', 'stopped']);

export default function ChatInput({ onSend, onFollowUp, onStop, status, sessionId, connected }) {
  const [value, setValue] = useState('');
  const [permissionMode, setPermissionMode] = useState('bypassPermissions');
  const inputRef = useRef(null);
  const isRunning = status === 'running';
  const canFollowUp = sessionId && CONTINUABLE.has(status);
  const canSubmit = connected && !isRunning && Boolean(value.trim());

  function handleSubmit(e) {
    e.preventDefault();
    const text = value.trim();
    if (!text || isRunning || !connected) return;
    if (canFollowUp) {
      onFollowUp(text, { permissionMode });
    } else {
      onSend(text, { permissionMode });
    }
    setValue('');
  }

  function handleKeyDown(e) {
    // Submit with Cmd+Enter (Mac) or Ctrl+Enter (Windows/Linux)
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  const placeholder = connected
    ? canFollowUp
      ? 'Send a follow-up message...'
      : 'Enter a task for the agent...'
    : 'Waiting for connection...';

  const buttonLabel = canFollowUp ? 'Continue' : 'Run';

  return (
    <form className={styles.wrapper} onSubmit={handleSubmit}>
      <div className={styles.inputRow}>
        <Dropdown
          className={styles.modeSelect}
          options={PERMISSION_MODES}
          value={permissionMode}
          onChange={setPermissionMode}
          disabled={isRunning || !connected}
          title="Permission mode"
          direction="up"
        />
        <textarea
          ref={inputRef}
          className={styles.input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          disabled={isRunning}
        />
        {isRunning ? (
          <button type="button" className={styles.stopBtn} onClick={onStop} disabled={!connected}>
            Stop
          </button>
        ) : (
          <button
            type="submit"
            className={canFollowUp ? styles.continueBtn : styles.sendBtn}
            disabled={!canSubmit}
          >
            {buttonLabel}
          </button>
        )}
      </div>
    </form>
  );
}
