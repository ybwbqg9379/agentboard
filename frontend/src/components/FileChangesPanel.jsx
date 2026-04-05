import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BookOpen,
  File,
  FileDown,
  FilePenLine,
  FilePlus,
  FolderOpen,
  HardDrive,
  Pencil,
} from 'lucide-react';
import { apiFetch } from '../lib/apiFetch.js';
import { isSessionDownloadableFileName, sessionFileDownloadHref } from '../lib/sessionDownloads.js';
import styles from './FileChangesPanel.module.css';

const API_BASE = '';

/**
 * Extract file operations from events (Read, Write, Edit tool calls, native ReportTool).
 */
export function extractFileChanges(events) {
  const files = new Map(); // path -> { reads, writes, edits }

  for (const event of events) {
    const blocks = event.content?.content || event.content?.message?.content;
    if (!Array.isArray(blocks)) continue;

    for (const block of blocks) {
      if (block.type !== 'tool_use') continue;

      const isReportTool =
        block.name === 'ReportTool' ||
        (typeof block.name === 'string' && /(?:^|__)ReportTool$/i.test(block.name));

      let filePath = block.input?.file_path || block.input?.path || block.input?.filePath || null;
      if (!filePath && isReportTool && block.input?.fileName) {
        filePath = String(block.input.fileName);
      }
      if (!filePath) continue;

      if (!files.has(filePath)) {
        files.set(filePath, { reads: 0, writes: 0, edits: 0, firstSeen: event.timestamp });
      }
      const entry = files.get(filePath);

      if (isReportTool) {
        entry.writes++;
      } else if (block.name === 'Read') entry.reads++;
      else if (block.name === 'Write') entry.writes++;
      else if (block.name === 'Edit') entry.edits++;
    }
  }

  return [...files.entries()]
    .map(([path, info]) => ({ path, ...info }))
    .sort((a, b) => b.writes + b.edits - (a.writes + a.edits) || a.path.localeCompare(b.path));
}

/**
 * Workspace files that are not already attributed to a tool path (by basename).
 * @param {{ path: string }[]} toolFiles
 * @param {{ name: string }[]} workspaceList
 */
export function workspaceFilesNotInToolList(toolFiles, workspaceList) {
  const basenames = new Set(toolFiles.map((f) => basename(f.path)));
  return workspaceList.filter((w) => w?.name && !basenames.has(w.name));
}

function basename(path) {
  return path.split('/').pop() || path;
}

export default function FileChangesPanel({ events, sessionId }) {
  const { t } = useTranslation();
  const files = useMemo(() => extractFileChanges(events), [events]);
  const [workspaceList, setWorkspaceList] = useState([]);

  useEffect(() => {
    if (!sessionId) {
      setWorkspaceList([]);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`${API_BASE}/api/sessions/${sessionId}/workspace-files`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data.files)) {
          setWorkspaceList(data.files);
        }
      } catch {
        if (!cancelled) setWorkspaceList([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId, events.length]);

  const workspaceExtra = useMemo(
    () => workspaceFilesNotInToolList(files, workspaceList),
    [files, workspaceList],
  );

  const totalListed = files.length + workspaceExtra.length;

  if (totalListed === 0) {
    return (
      <div className={styles.panel}>
        <div className={styles.header}>
          <FolderOpen size={14} strokeWidth={2} className={styles.headerIcon} aria-hidden />
          {t('filesPanel.header')}
        </div>
        <div className={styles.empty}>
          <FolderOpen size={36} strokeWidth={1.5} className={styles.emptyIcon} aria-hidden />
          {t('filesPanel.empty')}
        </div>
      </div>
    );
  }

  const modified = files.filter((f) => f.writes > 0 || f.edits > 0);
  const readOnly = files.filter((f) => f.writes === 0 && f.edits === 0);

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.headerLead}>
          <FolderOpen size={14} strokeWidth={2} className={styles.headerIcon} aria-hidden />
          {t('filesPanel.header')}
        </span>
        <span className={styles.count}>{totalListed}</span>
      </div>
      <div className={styles.list}>
        {modified.length > 0 && (
          <div className={styles.group}>
            <div className={styles.groupLabel}>
              {t('filesPanel.modified', { count: modified.length })}
            </div>
            {modified.map((f) => (
              <div key={f.path} className={styles.file}>
                <FilePenLine
                  size={12}
                  strokeWidth={2}
                  className={styles.fileKindIcon}
                  aria-hidden
                />
                <span className={styles.name} title={f.path}>
                  {basename(f.path)}
                </span>
                <span className={styles.ops}>
                  {f.writes > 0 && (
                    <span className={styles.write} title={t('filesPanel.opWrite')}>
                      <FilePlus size={11} strokeWidth={2} className={styles.opsIcon} aria-hidden />
                      {f.writes}
                    </span>
                  )}
                  {f.edits > 0 && (
                    <span className={styles.edit} title={t('filesPanel.opEdit')}>
                      <Pencil size={11} strokeWidth={2} className={styles.opsIcon} aria-hidden />
                      {f.edits}
                    </span>
                  )}
                  {f.reads > 0 && (
                    <span className={styles.read} title={t('filesPanel.opRead')}>
                      <BookOpen size={11} strokeWidth={2} className={styles.opsIcon} aria-hidden />
                      {f.reads}
                    </span>
                  )}
                  <FileRowDownload sessionId={sessionId} baseName={basename(f.path)} t={t} />
                </span>
              </div>
            ))}
          </div>
        )}
        {readOnly.length > 0 && (
          <div className={styles.group}>
            <div className={styles.groupLabel}>
              {t('filesPanel.readOnly', { count: readOnly.length })}
            </div>
            {readOnly.map((f) => (
              <div key={f.path} className={styles.file}>
                <File size={12} strokeWidth={2} className={styles.fileKindIconMuted} aria-hidden />
                <span className={styles.name} title={f.path}>
                  {basename(f.path)}
                </span>
                <span className={styles.ops}>
                  <span className={styles.read} title={t('filesPanel.opRead')}>
                    <BookOpen size={11} strokeWidth={2} className={styles.opsIcon} aria-hidden />
                    {f.reads}
                  </span>
                  <FileRowDownload sessionId={sessionId} baseName={basename(f.path)} t={t} />
                </span>
              </div>
            ))}
          </div>
        )}
        {workspaceExtra.length > 0 && (
          <div className={styles.group}>
            <div className={styles.groupLabel}>
              {t('filesPanel.workspaceExtra', { count: workspaceExtra.length })}
            </div>
            {workspaceExtra.map((f) => (
              <div key={f.name} className={styles.file}>
                <HardDrive
                  size={12}
                  strokeWidth={2}
                  className={styles.fileKindIconWorkspace}
                  aria-hidden
                />
                <span className={styles.name} title={f.name}>
                  {f.name}
                </span>
                <span className={styles.ops}>
                  <span className={styles.workspaceMeta} title={t('filesPanel.workspaceHint')}>
                    {f.bytes != null ? `${formatBytes(f.bytes)}` : ''}
                  </span>
                  <FileRowDownload sessionId={sessionId} baseName={f.name} t={t} />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatBytes(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function FileRowDownload({ sessionId, baseName, t }) {
  if (!sessionId || !isSessionDownloadableFileName(baseName)) return null;
  return (
    <a
      href={sessionFileDownloadHref(sessionId, baseName)}
      download={baseName}
      className={styles.fileDownload}
      title={t('timeline.download', { fileName: baseName })}
    >
      <FileDown size={14} strokeWidth={2} aria-hidden />
    </a>
  );
}
