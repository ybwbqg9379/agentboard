import { describe, it, expect } from 'vitest';
import { fileBasename } from './pathBasename.js';

describe('fileBasename', () => {
  it('returns last POSIX segment', () => {
    expect(fileBasename('/ws/subdir/out.pdf')).toBe('out.pdf');
  });

  it('normalizes backslashes to match basename semantics', () => {
    expect(fileBasename('C:\\ws\\script.py')).toBe('script.py');
  });

  it('strips trailing slashes before taking the last segment', () => {
    expect(fileBasename('/workspace/dir/')).toBe('dir');
  });

  it('returns empty for empty or non-string', () => {
    expect(fileBasename('')).toBe('');
    expect(fileBasename(null)).toBe('');
  });
});
