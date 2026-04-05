import { describe, it, expect } from 'vitest';
import { isSessionDownloadableFileName, sessionFileDownloadHref } from './sessionDownloads.js';

describe('sessionDownloads', () => {
  it('isSessionDownloadableFileName matches backend allowlist', () => {
    expect(isSessionDownloadableFileName('report.PDF')).toBe(true);
    expect(isSessionDownloadableFileName('data.csv')).toBe(true);
    expect(isSessionDownloadableFileName('x.py')).toBe(false);
    expect(isSessionDownloadableFileName('noext')).toBe(false);
  });

  it('sessionFileDownloadHref encodes file name', () => {
    expect(sessionFileDownloadHref('sid', 'a b.pdf')).toBe('/api/sessions/sid/files/a%20b.pdf');
  });
});
