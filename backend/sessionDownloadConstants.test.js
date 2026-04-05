import { describe, it, expect } from 'vitest';
import { SESSION_FILE_DOWNLOAD_EXTENSIONS } from '../shared/sessionDownloadExtensions.js';

describe('shared/sessionDownloadExtensions', () => {
  it('lists lowercase dotted extensions for the download route allowlist', () => {
    expect(SESSION_FILE_DOWNLOAD_EXTENSIONS.length).toBeGreaterThan(0);
    for (const ext of SESSION_FILE_DOWNLOAD_EXTENSIONS) {
      expect(ext).toMatch(/^\./);
      expect(ext).toBe(ext.toLowerCase());
    }
  });
});
