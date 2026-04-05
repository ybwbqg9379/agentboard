import { useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import styles from './ConfirmDialog.module.css';

/**
 * Custom confirmation dialog matching the platform's design system.
 * Replaces browser-native window.confirm().
 *
 * @param {boolean} open - Whether the dialog is visible
 * @param {string} [title] - Dialog title (defaults to i18n)
 * @param {string} [message] - Confirmation message body (defaults to i18n)
 * @param {string} [confirmLabel] - Label for the confirm button (defaults to i18n)
 * @param {string} [cancelLabel] - Label for the cancel button (defaults to i18n)
 * @param {'danger'|'default'} [variant='danger'] - Visual style
 * @param {() => void} onConfirm - Called when user confirms
 * @param {() => void} onCancel - Called when user cancels
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = 'danger',
  onConfirm,
  onCancel,
}) {
  const { t } = useTranslation();
  const resolvedTitle = title ?? t('confirmDialog.defaultTitle');
  const resolvedMessage = message ?? t('confirmDialog.defaultMessage');
  const resolvedConfirm = confirmLabel ?? t('confirmDialog.defaultConfirm');
  const resolvedCancel = cancelLabel ?? t('confirmDialog.defaultCancel');

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') onCancel();
      // Only confirm on Enter when not focused on a text input (prevents accidental deletion)
      const tag = e.target?.tagName;
      if (e.key === 'Enter' && tag !== 'TEXTAREA' && tag !== 'INPUT') {
        onConfirm();
      }
    },
    [onConfirm, onCancel],
  );

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.titleRow}>
          <div className={styles.title}>{resolvedTitle}</div>
          <button
            type="button"
            className={styles.dismiss}
            onClick={onCancel}
            aria-label={t('experiment.close')}
          >
            <X size={18} strokeWidth={2} aria-hidden />
          </button>
        </div>
        <div className={styles.message}>{resolvedMessage}</div>
        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={onCancel}>
            {resolvedCancel}
          </button>
          <button
            className={`${styles.confirmBtn} ${variant === 'danger' ? styles.danger : ''}`}
            onClick={onConfirm}
          >
            {resolvedConfirm}
          </button>
        </div>
      </div>
    </div>
  );
}
