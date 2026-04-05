import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FileDown } from 'lucide-react';
import { useWorkspaceFiles } from '../context/WorkspaceFilesProvider.jsx';
import { isSessionDownloadableFileName, sessionFileDownloadHref } from '../lib/sessionDownloads.js';
import styles from './SessionDownloadablesStrip.module.css';

/**
 * Lists session workspace files that match the download API allowlist.
 * Rendered above the user-shell composer (see App.jsx + index.css `.user-shell-composer-footer`).
 * Data comes from WorkspaceFilesProvider (shared with FileChangesPanel).
 */
export default function SessionDownloadablesStrip({ sessionId }) {
  const { t } = useTranslation();
  const { workspaceList, workspaceError } = useWorkspaceFiles();

  const files = useMemo(() => {
    if (!Array.isArray(workspaceList)) return [];
    return workspaceList.filter((f) => f?.name && isSessionDownloadableFileName(f.name));
  }, [workspaceList]);

  if (!sessionId) return null;

  if (workspaceError) {
    return (
      <div
        className={`${styles.dock} ${styles.errorDock} session-downloadables-dock`}
        role="alert"
        aria-label={t('userShell.downloadsRegion')}
      >
        <div className={styles.label}>{t('userShell.downloadsTitle')}</div>
        <p className={styles.errorText}>{t('userShell.workspaceListError')}</p>
      </div>
    );
  }

  if (files.length === 0) return null;

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
