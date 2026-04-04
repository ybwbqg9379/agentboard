import { Tool } from './Tool.js';
import alasql from 'alasql';
import fs from 'fs/promises';
import path from 'path';

/**
 * DataAnalystTool: Lightweight SQL engine for local data analysis.
 * Uses AlaSQL to query CSV and JSON files in the session workspace.
 */
export class DataAnalystTool extends Tool {
  constructor() {
    super({
      name: 'DataAnalystTool',
      description:
        'Perform complex data analysis using SQL on local CSV or JSON files. Supports aggregations, joins, and sorting.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'The SQL query to execute (e.g., "SELECT city, AVG(age) FROM users GROUP BY city").',
          },
          tables: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'Map of table names to file names (e.g., {"users": "data.csv"}).',
          },
        },
        required: ['query', 'tables'],
      },
      isConcurrencySafe: true,
      isDangerous: false,
    });
  }

  async call(input, context) {
    const { query, tables } = input;
    const { userWorkspace } = context;

    if (!userWorkspace) {
      throw new Error('DataAnalyst Context Error: Missing userWorkspace path.');
    }

    try {
      const db = new alasql.Database();

      for (const [tableName, fileName] of Object.entries(tables)) {
        const safePath = path.join(userWorkspace, path.basename(fileName));
        const fileContent = await fs.readFile(safePath, 'utf8');

        const ext = path.extname(fileName).toLowerCase();
        let parsed;

        if (ext === '.csv') {
          parsed = alasql(`SELECT * FROM CSV(?, {headers:true})`, [fileContent]);
          // Auto-convert numeric strings to numbers for easier SQL operations
          parsed = parsed.map((row) => {
            const newRow = {};
            for (const [k, v] of Object.entries(row)) {
              if (typeof v === 'string' && v.trim() !== '' && !isNaN(v)) {
                newRow[k] = Number(v);
              } else {
                newRow[k] = v;
              }
            }
            return newRow;
          });
        } else if (ext === '.json') {
          parsed = JSON.parse(fileContent);
          parsed = Array.isArray(parsed) ? parsed : [parsed];
        } else {
          throw new Error(`Unsupported file format: ${ext}`);
        }

        db.exec(`CREATE TABLE ${tableName}`);
        db.tables[tableName].data = parsed;
      }

      const result = db.exec(query);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
        isError: false,
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `[SQL Analysis Error]\n${err.message}`,
          },
        ],
        isError: true,
      };
    }
  }
}
