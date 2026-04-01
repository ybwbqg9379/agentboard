import { useEffect, useCallback } from 'react';
import styles from './ConfirmDialog.module.css';

/**
 * Custom confirmation dialog matching the platform's design system.
 * Replaces browser-native window.confirm().
 *
 * @param {boolean} open - Whether the dialog is visible
 * @param {string} title - Dialog title
 * @param {string} message - Confirmation message body
 * @param {string} [confirmLabel='Delete'] - Label for the confirm button
 * @param {string} [cancelLabel='Cancel'] - Label for the cancel button
 * @param {'danger'|'default'} [variant='danger'] - Visual style
 * @param {() => void} onConfirm - Called when user confirms
 * @param {() => void} onCancel - Called when user cancels
 */
export default function ConfirmDialog({
  open,
  title = 'Confirm',
  message = 'Are you sure?',
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  variant = 'danger',
  onConfirm,
  onCancel,
}) {
  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
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
        <div className={styles.title}>{title}</div>
        <div className={styles.message}>{message}</div>
        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            className={`${styles.confirmBtn} ${variant === 'danger' ? styles.danger : ''}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
