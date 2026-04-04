import { describe, it, expect, vi } from 'vitest';
import { OCRTool } from './OCRTool.js';
import fs from 'fs/promises';

// Mock Tesseract.js since it downloads data models which is slow for CI
vi.mock('tesseract.js', () => ({
  createWorker: vi.fn().mockResolvedValue({
    recognize: vi.fn().mockResolvedValue({
      data: { text: 'Mocked OCR Result: Hello World!', confidence: 95 },
    }),
    terminate: vi.fn(),
  }),
}));

describe('OCRTool', () => {
  const tool = new OCRTool();

  it('should process a fake image path and return mocked OCR text', async () => {
    // Mock fs.access to pretend the file exists
    vi.spyOn(fs, 'access').mockResolvedValue(undefined);

    const input = { imagePath: 'screenshot.png', language: 'eng' };
    const context = { userWorkspace: '/tmp/test-workspace' };

    const result = await tool.call(input, context);

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('Mocked OCR Result');
    expect(result.content[0].text).toContain('Confidence: 95%');
  });

  it('should handle missing files correctly', async () => {
    vi.spyOn(fs, 'access').mockRejectedValue(new Error('File not found'));

    const input = { imagePath: 'ghost.png' };
    const context = { userWorkspace: '/tmp/non-existent' };

    const result = await tool.call(input, context);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('OCR Execution Error');
  });
});
