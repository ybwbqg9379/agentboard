import { Tool } from './Tool.js';
import { saveEntity, saveRelation, getUserMemoryGraph } from '../memoryStore.js';

export class RememberTool extends Tool {
  constructor() {
    super({
      name: 'Remember',
      description:
        'Store an important entity or relationship in your cross-session memory graph. Use this to remember user preferences, architectural decisions, and critical context that should persist beyond this conversation.',
      inputSchema: {
        type: 'object',
        properties: {
          entities: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                type: { type: 'string' },
                content: { type: 'string' },
              },
              required: ['name', 'type', 'content'],
            },
          },
          relations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                source: { type: 'string' },
                target: { type: 'string' },
                relation: { type: 'string' },
              },
              required: ['source', 'target', 'relation'],
            },
          },
        },
      },
      isConcurrencySafe: true,
      isDangerous: false,
    });
  }

  async call(input, context) {
    const { entities = [], relations = [] } = input;
    const { userId } = context;

    try {
      if (!userId || userId === 'default') {
        throw new Error(
          'Memory operations require an authenticated tenant (userId is null/default).',
        );
      }

      for (const entity of entities) {
        saveEntity(userId, entity.name, entity.type, entity.content);
      }

      for (const rel of relations) {
        saveRelation(userId, rel.source, rel.target, rel.relation);
      }

      return {
        content: [
          {
            type: 'text',
            text: `[Memory Stored Successfully] Saved ${entities.length} entities and ${relations.length} relations.`,
          },
        ],
        isError: false,
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to store memory: ${err.message}` }],
        isError: true,
      };
    }
  }
}

export class RecallTool extends Tool {
  constructor() {
    super({
      name: 'Recall',
      description:
        'Retrieve all elements from your persistent memory graph. The memory graph contains user preferences, system-wide rules, and architectural standards.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      isConcurrencySafe: true,
      isDangerous: false,
    });
  }

  async call(input, context) {
    const { userId } = context;

    try {
      if (!userId) {
        throw new Error('UserId not available. Cannot fetch isolated tenant memory.');
      }

      const graph = getUserMemoryGraph(userId);

      const formatted = `[Memory Retrieval]\nEntities: ${graph.entities.length}\nRelations: ${graph.relations.length}\n\n${JSON.stringify(graph, null, 2)}`;

      return {
        content: [
          {
            type: 'text',
            text: formatted,
          },
        ],
        isError: false,
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to recall memory: ${err.message}` }],
        isError: true,
      };
    }
  }
}
