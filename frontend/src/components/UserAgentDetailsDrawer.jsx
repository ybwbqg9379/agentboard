import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import styles from './UserAgentDetailsDrawer.module.css';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function listFocusables(container) {
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

export default function UserAgentDetailsDrawer({ open, onClose, children }) {
  const { t } = useTranslation();
  const titleId = useId();
  const containerRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const previousFocusRef = useRef(null);

  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape') onCloseRef.current();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (!container) return;

    previousFocusRef.current = document.activeElement;
    const closeBtn = container.querySelector('[data-drawer-close]');
    (closeBtn ?? listFocusables(container)[0])?.focus({ preventScroll: true });

    function onKeyDown(e) {
      if (e.key !== 'Tab') return;
      const nodes = listFocusables(container);
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      const inside = container.contains(active);

      if (e.shiftKey) {
        if (!inside || active === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      const prevEl = previousFocusRef.current;
      if (prevEl && typeof prevEl.focus === 'function') {
        try {
          prevEl.focus({ preventScroll: true });
        } catch {
          /* ignore */
        }
      }
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div ref={containerRef} className={styles.root} role="presentation">
      <button
        type="button"
        className={styles.backdrop}
        aria-label={t('userShell.dismissDetailsOverlay')}
        tabIndex={-1}
        onClick={() => onCloseRef.current()}
      />
      <div className={styles.panel} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className={styles.toolbar}>
          <h2 id={titleId} className={styles.title}>
            {t('userShell.detailsTitle')}
          </h2>
          <button
            type="button"
            className={styles.closeBtn}
            data-drawer-close
            onClick={() => onCloseRef.current()}
            aria-label={t('userShell.closeDetails')}
          >
            <X size={18} strokeWidth={2} aria-hidden />
          </button>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
