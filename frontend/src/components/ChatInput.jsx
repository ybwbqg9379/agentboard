import { useState, useRef } from 'react';
import styles from './ChatInput.module.css';

export default function ChatInput({ onSend, onStop, status }) {
  const [value, setValue] = useState('');
  const inputRef = useRef(null);
  const isRunning = status === 'running';

  function handleSubmit(e) {
    e.preventDefault();
    const text = value.trim();
    if (!text || isRunning) return;
    onSend(text);
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
          <button
            type="button"
            className={styles.stopBtn}
            onClick={onStop}
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            className={styles.sendBtn}
            disabled={!value.trim()}
          >
            Run
          </button>
        )}
      </div>
    </form>
  );
}
