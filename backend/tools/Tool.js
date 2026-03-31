/**
 * Base abstract Tool interface for AgentBoard Native Tools.
 * All advanced native capabilities (LSP, Task Orchestration, REPL)
 * will inherit from this base class or conform to its structure.
 */

export class Tool {
  constructor(options = {}) {
    this.name = options.name;
    this.description = options.description;
    this.inputSchema = options.inputSchema; // Zod schema or raw JSON spec
    this.isConcurrencySafe = options.isConcurrencySafe || false;
    this.isDangerous = options.isDangerous || false;
  }

  /**
   * Execute the tool with the provided input context.
   * @param {object} _input - Tool arguments from the LLM
   * @param {object} _context - Execution context { sessionId, userId, userWorkspace, mcpClients }
   */
  async call(_input, _context) {
    throw new Error(`Tool [${this.name}] must implement call() method.`);
  }

  /**
   * Get the standard Anthropic Tool payload definition.
   */
  getToolDef() {
    return {
      name: this.name,
      description: this.description,
      input_schema: this.inputSchema,
    };
  }
}
