import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch, API_BASE } from '../lib/apiFetch.js';

const WorkspaceFilesContext = createContext({
  workspaceList: [],
  workspaceError: null,
  workspaceLoading: false,
});

const DEBOUNCE_MS = 350;

/**
 * Fetches `GET /api/sessions/:id/workspace-files` for the active session. Must wrap the tree that
 * uses {@link useWorkspaceFiles} (see `App.jsx`).
 */
export function WorkspaceFilesProvider({ sessionId, refreshKey, children }) {
  const [workspaceList, setWorkspaceList] = useState([]);
  const [workspaceError, setWorkspaceError] = useState(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const previousSessionIdRef = useRef(null);

  useEffect(() => {
    if (!sessionId) {
      previousSessionIdRef.current = null;
      setWorkspaceList([]);
      setWorkspaceError(null);
      setWorkspaceLoading(false);
      return;
    }

    const sessionChanged = previousSessionIdRef.current !== sessionId;
    previousSessionIdRef.current = sessionId;

    if (sessionChanged) {
      setWorkspaceList([]);
      setWorkspaceError(null);
      setWorkspaceLoading(true);
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      if (!cancelled) {
        setWorkspaceLoading(true);
        setWorkspaceError(null);
      }
      try {
        const res = await apiFetch(`${API_BASE}/api/sessions/${sessionId}/workspace-files`);
        if (cancelled) return;
        if (!res.ok) {
          setWorkspaceError('http');
          setWorkspaceList([]);
          return;
        }
        const data = await res.json();
        if (!Array.isArray(data.files)) {
          setWorkspaceList([]);
        } else {
          setWorkspaceList(data.files);
        }
      } catch {
        if (!cancelled) {
          setWorkspaceError('network');
          setWorkspaceList([]);
        }
      } finally {
        if (!cancelled) setWorkspaceLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      setWorkspaceLoading(false);
    };
  }, [sessionId, refreshKey]);

  const value = useMemo(
    () => ({ workspaceList, workspaceError, workspaceLoading }),
    [workspaceList, workspaceError, workspaceLoading],
  );

  return <WorkspaceFilesContext.Provider value={value}>{children}</WorkspaceFilesContext.Provider>;
}

/** Consumes {@link WorkspaceFilesProvider}; default context is empty (silent, for tests / mis-mount debugging). */
export function useWorkspaceFiles() {
  return useContext(WorkspaceFilesContext);
}
