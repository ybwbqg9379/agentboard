import { useMemo, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './ChatInput.module.css';
import Dropdown from './Dropdown';

// Statuses that allow sending a follow-up message
const CONTINUABLE = new Set(['completed', 'failed', 'stopped']);

export default function ChatInput({ onSend, onFollowUp, onStop, status, sessionId, connected }) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [permissionMode, setPermissionMode] = useState('bypassPermissions');
  const inputRef = useRef(null);
  const isRunning = status === 'running';
  const canFollowUp = sessionId && CONTINUABLE.has(status);
  const canSubmit = connected && !isRunning && Boolean(value.trim());

  const permissionModes = useMemo(
    () => [
      { value: 'bypassPermissions', label: t('chatInput.permissionBypass') },
      { value: 'acceptEdits', label: t('chatInput.permissionAcceptEdits') },
      { value: 'default', label: t('chatInput.permissionDefault') },
      { value: 'plan', label: t('chatInput.permissionPlan') },
    ],
    [t],
  );

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
      ? t('chatInput.placeholderFollowUp')
      : t('chatInput.placeholderTask')
    : t('chatInput.placeholderWait');

  const buttonLabel = canFollowUp ? t('chatInput.continue') : t('chatInput.run');

  return (
    <form className={styles.wrapper} onSubmit={handleSubmit}>
      <div className={styles.inputRow}>
        <Dropdown
          className={styles.modeSelect}
          options={permissionModes}
          value={permissionMode}
          onChange={setPermissionMode}
          disabled={isRunning || !connected}
          title={t('chatInput.permissionTitle')}
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
            {t('chatInput.stop')}
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
