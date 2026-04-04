import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ReportTool } from './ReportTool.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('ReportTool', () => {
  const tool = new ReportTool();
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentboard-report-test-'));
  });

  afterEach(async () => {
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

  it('should handle CJK content gracefully without crashing', async () => {
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
    // Should warn about non-Latin character substitution
    expect(result.content[0].text).toContain('non-Latin');

    // File should still be created and valid
    const stats = await fs.stat(path.join(tempDir, 'cjk_report.pdf'));
    expect(stats.size).toBeGreaterThan(100);
  });
});
