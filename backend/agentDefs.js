/**
 * Subagent definitions for AgentBoard.
 *
 * Each definition describes a specialised agent role with a curated tool set.
 * No agent receives the `Agent` tool -- recursive delegation is not allowed.
 */

/**
 * Returns the map of agent-type key to its definition.
 *
 * @returns {Record<string, {description: string, prompt: string, tools: string[]}>}
 */
export function getAgentDefs() {
  return {
    'code-reviewer': {
      description:
        'Reviews code for quality, security vulnerabilities, and adherence to best-practice patterns.',
      prompt: [
        'You are a senior code reviewer.',
        'Focus on bugs, security vulnerabilities, performance issues, and code clarity.',
        'Always cite the exact file path and line number when reporting a finding.',
        'Be concise -- prioritise actionable feedback over lengthy explanations.',
      ].join('\n'),
      tools: ['Read', 'Glob', 'Grep'],
      disallowedTools: ['Bash', 'Write'],
      skills: ['differential-review'],
      maxTurns: 15,
      permissionMode: 'default',
      model: 'inherit',
    },

    'test-writer': {
      description:
        'Writes comprehensive test suites covering happy paths, edge cases, and error conditions.',
      prompt: [
        'You are a test engineering specialist.',
        'Cover happy paths, edge cases, error conditions, and boundary values.',
        'Use the simplest testing framework already available in the project.',
        'Ensure every test is deterministic and self-contained.',
      ].join('\n'),
      tools: ['Read', 'Write', 'Bash', 'Glob'],
      disallowedTools: ['Bash(rm *)', 'Bash(sudo *)'],
      skills: ['test-driven-development', 'property-based-testing'],
      maxTurns: 25,
      permissionMode: 'acceptEdits',
      model: 'inherit',
    },

    researcher: {
      description: 'Browses the web and reads documentation to gather technical information.',
      prompt: [
        'You are a technical researcher.',
        'Search the web for up-to-date information when needed.',
        'Summarise findings with source URLs so the reader can verify.',
        'Prefer official documentation over third-party blog posts.',
      ].join('\n'),
      tools: ['Read', 'Grep', 'mcp__browser__*'],
      disallowedTools: ['Write', 'Bash'],
      skills: ['audit-context-building'],
      maxTurns: 20,
      permissionMode: 'default',
      model: 'inherit',
      background: true,
    },

    architect: {
      description:
        'Analyses complex tasks and designs high-level solutions with clear trade-off reasoning.',
      prompt: [
        'You are a software architect.',
        'Break every problem into discrete, well-defined steps.',
        'Consider trade-offs (performance, maintainability, complexity) explicitly.',
        'Produce actionable plans that other agents or developers can execute directly.',
      ].join('\n'),
      tools: ['Read', 'Glob', 'Grep', 'mcp__sequential-thinking__*'],
      disallowedTools: ['Write', 'Bash'],
      skills: ['writing-plans', 'brainstorming'],
      maxTurns: 20,
      permissionMode: 'default',
      model: 'inherit',
      initialPrompt: 'Analyze the workspace structure before proposing any design.',
    },
  };
}
