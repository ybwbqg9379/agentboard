import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileDown } from 'lucide-react';
import { apiFetch } from '../lib/apiFetch.js';
import { isSessionDownloadableFileName, sessionFileDownloadHref } from '../lib/sessionDownloads.js';
import styles from './SessionDownloadablesStrip.module.css';

const API_BASE = '';

/**
 * Lists session workspace files that match the download API allowlist.
 * Rendered above the user-shell composer (see App.jsx + index.css `.user-shell-composer-footer`).
 */
export default function SessionDownloadablesStrip({ sessionId, refreshKey }) {
  const { t } = useTranslation();
  const [files, setFiles] = useState([]);

  useEffect(() => {
    if (!sessionId) {
      setFiles([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`${API_BASE}/api/sessions/${sessionId}/workspace-files`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !Array.isArray(data.files)) return;
        const downloadable = data.files
          .filter((f) => f?.name && isSessionDownloadableFileName(f.name))
          .sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
        setFiles(downloadable);
      } catch {
        if (!cancelled) setFiles([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, refreshKey]);

  if (!sessionId || files.length === 0) return null;

  return (
    <div
      className={`${styles.dock} session-downloadables-dock`}
      role="region"
      aria-label={t('userShell.downloadsRegion')}
    >
      <div className={styles.label}>{t('userShell.downloadsTitle')}</div>
      <div className={styles.chips}>
        {files.map((f) => (
          <a
            key={f.name}
            href={sessionFileDownloadHref(sessionId, f.name)}
            download={f.name}
            className={styles.chip}
          >
            <FileDown size={14} strokeWidth={2} className={styles.chipIcon} aria-hidden />
            <span className={styles.chipName}>{f.name}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
