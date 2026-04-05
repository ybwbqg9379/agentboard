// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('./FileChangesPanel.module.css', () => ({ default: {} }));

const mockUseWorkspaceFiles = vi.fn();

vi.mock('../context/WorkspaceFilesProvider.jsx', () => ({
  useWorkspaceFiles: () => mockUseWorkspaceFiles(),
}));

import FileChangesPanel from './FileChangesPanel.jsx';

describe('FileChangesPanel download links', () => {
  beforeEach(() => {
    mockUseWorkspaceFiles.mockReturnValue({
      workspaceList: [],
      workspaceError: null,
      workspaceLoading: false,
    });
  });

  it('uses the full tool path for nested downloadable files and keeps basename as the download name', () => {
    const events = [
      {
        timestamp: '2026-04-04T12:00:00.000Z',
        content: {
          content: [
            {
              type: 'tool_use',
              name: 'Write',
              input: { file_path: 'reports/out/report.pdf' },
            },
          ],
        },
      },
    ];

    const { container } = render(<FileChangesPanel events={events} sessionId="sess-1" />);
    const downloadLink = container.querySelector('a[download="report.pdf"]');

    expect(downloadLink).toBeTruthy();
    expect(downloadLink.getAttribute('href')).toBe(
      '/api/sessions/sess-1/files?path=reports%2Fout%2Freport.pdf',
    );
  });
});
