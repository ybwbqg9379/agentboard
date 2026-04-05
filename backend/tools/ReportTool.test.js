import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ReportTool } from './ReportTool.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const SYSTEM_UNICODE_FONT_CANDIDATES = [
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  '/Library/Fonts/Arial Unicode.ttf',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf',
  '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
  '/usr/share/fonts/truetype/arphic/ukai.ttc',
];

async function findExistingUnicodeFont() {
  for (const candidate of SYSTEM_UNICODE_FONT_CANDIDATES) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Continue probing.
    }
  }

  return null;
}

describe('ReportTool', () => {
  const tool = new ReportTool();
  let tempDir;
  let originalPdfFont;
  let originalDisableBundled;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentboard-report-test-'));
    originalPdfFont = process.env.AGENTBOARD_PDF_FONT;
    originalDisableBundled = process.env.AGENTBOARD_DISABLE_BUNDLED_PDF_FONT;
  });

  afterEach(async () => {
    if (originalPdfFont === undefined) {
      delete process.env.AGENTBOARD_PDF_FONT;
    } else {
      process.env.AGENTBOARD_PDF_FONT = originalPdfFont;
    }
    if (originalDisableBundled === undefined) {
      delete process.env.AGENTBOARD_DISABLE_BUNDLED_PDF_FONT;
    } else {
      process.env.AGENTBOARD_DISABLE_BUNDLED_PDF_FONT = originalDisableBundled;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should generate a PDF report with content and title', async () => {
    const input = {
      title: 'Annual AI Safety Report',
      content: '# Summary\nThis is a professional report.\n## Details\nAgentBoard is safe.',
      fileName: 'report.pdf',
    };
    const context = { userWorkspace: tempDir };

    const result = await tool.call(input, context);

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('report.pdf');

    // Check if file exists and has content
    const stats = await fs.stat(path.join(tempDir, 'report.pdf'));
    expect(stats.size).toBeGreaterThan(100);
  });

  it('should handle pagination for long content', async () => {
    // Generate long content that exceeds one page
    let longContent = '# Multi-page Report\n';
    for (let i = 0; i < 100; i++) {
      longContent += `Line number ${i} of the report. This is a very interesting piece of information.\n`;
    }

    const input = {
      title: 'Long Report',
      content: longContent,
      fileName: 'long_report.pdf',
    };
    const context = { userWorkspace: tempDir };

    const result = await tool.call(input, context);

    expect(result.isError).toBe(false);

    // Extract page count from the result text (e.g., "Pages: 3")
    const pageCountMatch = result.content[0].text.match(/Pages: (\d+)/);
    const pageCount = parseInt(pageCountMatch[1], 10);
    expect(pageCount).toBeGreaterThanOrEqual(2);
  });

  it('should reject non-.pdf file extensions to prevent arbitrary file writes', async () => {
    const input = {
      title: 'Malicious Report',
      content: '#!/bin/bash\nrm -rf /',
      fileName: 'payload.sh',
    };
    const context = { userWorkspace: tempDir };

    await expect(tool.call(input, context)).rejects.toThrow('Only .pdf extension is allowed');
  });

  it('uses bundled Noto WOFF2 for CJK when AGENTBOARD_PDF_FONT is invalid', async () => {
    process.env.AGENTBOARD_PDF_FONT = path.join(tempDir, 'missing-unicode-font.ttf');

    const input = {
      title: '中文报告',
      content: '# 摘要\n这是一份包含中文内容的研究报告。\n## 详细数据\nAgentBoard 安全审计通过。',
      fileName: 'cjk_report.pdf',
      author: '测试作者',
    };
    const context = { userWorkspace: tempDir };

    const result = await tool.call(input, context);

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('cjk_report.pdf');
    expect(result.content[0].text).not.toContain('non-Latin');
    expect(result.content[0].text).toMatch(/Font:.*noto-sans-sc.*\.woff2/i);

    const stats = await fs.stat(path.join(tempDir, 'cjk_report.pdf'));
    expect(stats.size).toBeGreaterThan(100);
  });

  it('falls back to TimesRoman when bundled font is disabled and no OS Unicode font exists', async () => {
    process.env.AGENTBOARD_DISABLE_BUNDLED_PDF_FONT = '1';
    process.env.AGENTBOARD_PDF_FONT = path.join(tempDir, 'missing-unicode-font.ttf');

    const unicodeFontPath = await findExistingUnicodeFont();
    if (unicodeFontPath) {
      return;
    }

    const input = {
      title: '中文报告',
      content: '# 摘要\n短。',
      fileName: 'cjk_fallback.pdf',
      author: '测试',
    };
    const context = { userWorkspace: tempDir };

    const result = await tool.call(input, context);

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('non-Latin');
    expect(result.content[0].text).toContain('Font: TimesRoman');
  });

  it('uses a Unicode font to preserve CJK text when one is configured', async () => {
    const unicodeFontPath = await findExistingUnicodeFont();
    if (!unicodeFontPath) return;

    process.env.AGENTBOARD_PDF_FONT = unicodeFontPath;

    const input = {
      title: '中文报告',
      content: '# 摘要\n这是一份包含中文内容的研究报告。\n## 详细数据\nAgentBoard 安全审计通过。',
      fileName: 'unicode_report.pdf',
      author: '测试作者',
    };
    const context = { userWorkspace: tempDir };

    const result = await tool.call(input, context);

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('unicode_report.pdf');
    expect(result.content[0].text).toContain(path.basename(unicodeFontPath));
    expect(result.content[0].text).not.toContain('non-Latin');

    const stats = await fs.stat(path.join(tempDir, 'unicode_report.pdf'));
    expect(stats.size).toBeGreaterThan(100);
  });
});
