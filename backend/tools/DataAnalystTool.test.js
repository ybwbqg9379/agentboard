import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DataAnalystTool } from './DataAnalystTool.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('DataAnalystTool', () => {
  const tool = new DataAnalystTool();
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentboard-test-'));
    const csvContent = 'name,age,city\nAlice,30,New York\nBob,25,San Francisco\nCharlie,35,Chicago';
    await fs.writeFile(path.join(tempDir, 'users.csv'), csvContent);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should analyze a local CSV file using SQL with tables mapping', async () => {
    const input = {
      query: 'SELECT name FROM users WHERE age > 28',
      tables: { users: 'users.csv' },
    };
    const context = { userWorkspace: tempDir };

    const result = await tool.call(input, context);

    expect(result.isError).toBe(false);
    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveLength(2);
    expect(data[0].name).toBe('Alice');
    expect(data[1].name).toBe('Charlie');
  });

  it('should perform aggregations like COUNT and AVG with smart type conversion', async () => {
    const input = {
      query: 'SELECT COUNT(*) AS [total], AVG(age) AS [avg_age] FROM users',
      tables: { users: 'users.csv' },
    };
    const context = { userWorkspace: tempDir };

    const result = await tool.call(input, context);

    expect(result.isError).toBe(false);
    const data = JSON.parse(result.content[0].text);
    expect(data[0].total).toBe(3);
    expect(data[0].avg_age).toBe(30);
  });

  it('should support JSON files and joins between CSV and JSON', async () => {
    // Create a JSON file for joining
    const cityInfo = [
      { city: 'New York', region: 'East' },
      { city: 'San Francisco', region: 'West' },
      { city: 'Chicago', region: 'Midwest' },
    ];
    await fs.writeFile(path.join(tempDir, 'cities.json'), JSON.stringify(cityInfo));

    const input = {
      query: 'SELECT u.name, c.region FROM users AS u JOIN cities AS c ON u.city = c.city',
      tables: {
        users: 'users.csv',
        cities: 'cities.json',
      },
    };
    const context = { userWorkspace: tempDir };

    const result = await tool.call(input, context);

    expect(result.isError).toBe(false);
    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveLength(3);
    expect(data.find((r) => r.name === 'Alice').region).toBe('East');
  });
});
