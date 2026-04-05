import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Send, Square } from 'lucide-react';
import styles from './ChatInput.module.css';

/** Agent 主界面固定为完全绕过权限提示（与后端 `permissionMode` 约定一致）。 */
const PERMISSION_MODE = 'bypassPermissions';

// Statuses that allow sending a follow-up message
const CONTINUABLE = new Set(['completed', 'failed', 'stopped']);

export default function ChatInput({
  onSend,
  onFollowUp,
  onStop,
  status,
  sessionId,
  connected,
  variant = 'pro',
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const isRunning = status === 'running';
  const canFollowUp = sessionId && CONTINUABLE.has(status);
  const canSubmit = connected && !isRunning && Boolean(value.trim());

  function handleSubmit(e) {
    e.preventDefault();
    const text = value.trim();
    if (!text || isRunning || !connected) return;
    const opts = { permissionMode: PERMISSION_MODE };
    if (canFollowUp) {
      onFollowUp(text, opts);
    } else {
      onSend(text, opts);
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

  const isUser = variant === 'user';
  const placeholder = connected
    ? canFollowUp
      ? isUser
        ? t('userShell.placeholderFollowUp')
        : t('chatInput.placeholderFollowUp')
      : isUser
        ? t('userShell.placeholderTask')
        : t('chatInput.placeholderTask')
    : isUser
      ? t('userShell.placeholderWait')
      : t('chatInput.placeholderWait');

  const buttonLabel = canFollowUp
    ? isUser
      ? t('userShell.continueTask')
      : t('chatInput.continue')
    : isUser
      ? t('userShell.runAgent')
      : t('chatInput.run');

  return (
    <form
      className={`${styles.wrapper} ${isUser ? styles.wrapperUser : ''}`}
      onSubmit={handleSubmit}
    >
      <div className={styles.inputRow}>
        <textarea
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
            <Square size={14} strokeWidth={2} className={styles.inputActionIcon} aria-hidden />
            {t('chatInput.stop')}
          </button>
        ) : (
          <button
            type="submit"
            className={canFollowUp ? styles.continueBtn : styles.sendBtn}
            disabled={!canSubmit}
          >
            {canFollowUp ? (
              <ArrowRight
                size={16}
                strokeWidth={2}
                className={styles.inputActionIcon}
                aria-hidden
              />
            ) : (
              <Send size={16} strokeWidth={2} className={styles.inputActionIcon} aria-hidden />
            )}
            {buttonLabel}
          </button>
        )}
      </div>
    </form>
  );
}
