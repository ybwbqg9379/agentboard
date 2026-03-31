import { describe, it, expect } from 'vitest';
import { parseFrontmatter, getMcpCapabilities } from './registry.js';

describe('registry.js - Dynamic Registry Unit Tests', () => {
  describe('parseFrontmatter (YAML extraction)', () => {
    it('should extract correct frontmatter blocks including arrays', () => {
      const content = `---
name: mock-skill
description: Mock skill test
when_to_use: For vitest verification
allowed-tools:
  - Bash
  - Read
  - Grep
paths:
  - "*.js"
  - "src/**"
---
# Content starts here`;

      const { frontmatter, markdown } = parseFrontmatter(content);

      expect(frontmatter.name).toBe('mock-skill');
      expect(frontmatter.description).toBe('Mock skill test');
      expect(frontmatter.when_to_use).toBe('For vitest verification');
      expect(frontmatter['allowed-tools']).toEqual(['Bash', 'Read', 'Grep']);
      expect(frontmatter.paths).toEqual(['"*.js"', '"src/**"']);
      expect(markdown).toBe('# Content starts here');
    });

    it('should ignore malformed or missing frontmatter without crashing', () => {
      const malformed1 = `name: test description missing dashes\n\nsome markdown`;
      const result1 = parseFrontmatter(malformed1);
      expect(result1.frontmatter).toEqual({});
      expect(result1.markdown).toBe(malformed1);

      const empty = ``;
      const resultEmpty = parseFrontmatter(empty);
      expect(resultEmpty.frontmatter).toEqual({});
      expect(resultEmpty.markdown).toBe('');
    });

    it('should handle frontmatter with empty keys or only one dash block', () => {
      const partial = `---\nempty_key:\n---`;
      const res = parseFrontmatter(partial);
      expect(res.frontmatter).toEqual({ empty_key: [] });
      expect(res.markdown).toBe('');
    });
  });

  describe('getMcpCapabilities (MCP Metadata generation)', () => {
    it('should append metadata descriptors to known MCP servers', () => {
      const rawServers = {
        filesystem: { command: 'npx', args: ['x'] },
        browser: { command: 'npx', args: ['y'] },
      };

      const capabilities = getMcpCapabilities(rawServers);
      expect(capabilities).toHaveLength(2);

      const fsCap = capabilities.find((c) => c.id === 'filesystem');
      expect(fsCap.keywords).toContain('file');
      expect(fsCap.keywords).toContain('grep');
      expect(fsCap.toolPrefix).toBe('mcp__filesystem__*');

      const browserCap = capabilities.find((c) => c.id === 'browser');
      expect(browserCap.keywords).toContain('web');
      expect(browserCap.toolPrefix).toBe('mcp__browser__*');
    });

    it('should safely fall back for completely unknown or newly added MCP servers', () => {
      const rawServers = {
        hyper_new_mcp: { url: 'sse://localhost:4000' },
      };

      const capabilities = getMcpCapabilities(rawServers);
      expect(capabilities).toHaveLength(1);

      const newCap = capabilities[0];
      expect(newCap.id).toBe('hyper_new_mcp');
      expect(newCap.description).toBe('Generic MCP');
      expect(newCap.keywords).toEqual([]);
      expect(newCap.toolPrefix).toBe('mcp__hyper_new_mcp__*');
    });
  });
});
