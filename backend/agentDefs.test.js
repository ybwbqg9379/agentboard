/**
 * Sanity checks for subagent definitions: structure and non-recursion constraints.
 */

import { describe, it, expect } from 'vitest';
import { getAgentDefs } from './agentDefs.js';

describe('getAgentDefs', () => {
  it('returns a non-empty map of agent keys', () => {
    const defs = getAgentDefs();
    expect(typeof defs).toBe('object');
    expect(Object.keys(defs).length).toBeGreaterThan(0);
  });

  it('each definition has description, prompt, and tools array', () => {
    const defs = getAgentDefs();
    for (const [key, def] of Object.entries(defs)) {
      expect(def, key).toMatchObject({
        description: expect.any(String),
        prompt: expect.any(String),
        tools: expect.any(Array),
      });
      expect(def.description.length).toBeGreaterThan(0);
      expect(def.prompt.length).toBeGreaterThan(0);
    }
  });

  it('does not grant the recursive Agent / AgentTool to subagents', () => {
    const defs = getAgentDefs();
    for (const [key, def] of Object.entries(defs)) {
      const tools = def.tools || [];
      expect(tools, `${key} tools`).not.toContain('Agent');
    }
  });
});
