import { describe, it, expect } from 'vitest';
import { isSessionDownloadableFileName, sessionFileDownloadHref } from './sessionDownloads.js';

describe('sessionDownloads', () => {
  it('isSessionDownloadableFileName matches backend allowlist', () => {
    expect(isSessionDownloadableFileName('report.PDF')).toBe(true);
    expect(isSessionDownloadableFileName('data.csv')).toBe(true);
    expect(isSessionDownloadableFileName('reports/out/report.pdf')).toBe(true);
    expect(isSessionDownloadableFileName('x.py')).toBe(false);
    expect(isSessionDownloadableFileName('noext')).toBe(false);
  });

  it('sessionFileDownloadHref encodes nested file paths via query string', () => {
    expect(sessionFileDownloadHref('sid', 'reports/a b.pdf')).toBe(
      '/api/sessions/sid/files?path=reports%2Fa%20b.pdf',
    );
  });
});
