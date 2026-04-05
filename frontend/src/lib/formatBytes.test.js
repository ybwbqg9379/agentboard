import { describe, it, expect } from 'vitest';
import { formatBytes } from './formatBytes.js';

describe('formatBytes', () => {
  it('formats B, KB, MB', () => {
    expect(formatBytes(100)).toBe('100 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('formats GB for large values', () => {
    expect(formatBytes(2 * 1024 ** 3)).toBe('2.0 GB');
  });

  it('returns empty for invalid numbers', () => {
    expect(formatBytes(NaN)).toBe('');
    expect(formatBytes('x')).toBe('');
  });
});
