/**
 * Unit tests for metricExtractor -- pure function tests, no mocks needed.
 *
 * Covers: extractMetric (regex/json_path/exit_code), extractAllMetrics
 * (primary + secondary + guard), isImproved, improvementPercent.
 */

import { describe, it, expect } from 'vitest';
import {
  extractMetric,
  extractAllMetrics,
  isImproved,
  improvementPercent,
} from './metricExtractor.js';

// ---------------------------------------------------------------------------
// extractMetric
// ---------------------------------------------------------------------------

describe('extractMetric', () => {
  describe('regex mode', () => {
    it('extracts a number from capture group', () => {
      const output = 'Tests passed: 42/50\nScore: 84.5%';
      const result = extractMetric(output, { type: 'regex', extract: 'Score:\\s*([\\d.]+)' });
      expect(result).toBeCloseTo(84.5);
    });

    it('defaults to regex mode when type is omitted', () => {
      const output = 'result: 99';
      const result = extractMetric(output, { extract: 'result:\\s*(\\d+)' });
      expect(result).toBe(99);
    });

    it('returns null when no match', () => {
      const result = extractMetric('no match here', { type: 'regex', extract: 'score: (\\d+)' });
      expect(result).toBeNull();
    });

    it('returns null when capture group is not a number', () => {
      const output = 'status: ok';
      const result = extractMetric(output, { type: 'regex', extract: 'status: (\\w+)' });
      expect(result).toBeNull();
    });

    it('returns null when extract is missing', () => {
      const result = extractMetric('output', { type: 'regex' });
      expect(result).toBeNull();
    });

    it('returns null for invalid regex', () => {
      const result = extractMetric('output', { type: 'regex', extract: '([invalid' });
      expect(result).toBeNull();
    });

    it('handles multiline output (m flag)', () => {
      const output = 'line1\naccuracy: 0.97\nline3';
      const result = extractMetric(output, {
        type: 'regex',
        extract: '^accuracy:\\s*([\\d.]+)',
      });
      expect(result).toBeCloseTo(0.97);
    });

    it('returns null for NaN parsed value', () => {
      const output = 'value: Infinity';
      const result = extractMetric(output, { type: 'regex', extract: 'value: (\\w+)' });
      expect(result).toBeNull();
    });
  });

  describe('json_path mode', () => {
    it('extracts value from flat JSON', () => {
      const output = '{"score": 42}';
      const result = extractMetric(output, { type: 'json_path', extract: 'score' });
      expect(result).toBe(42);
    });

    it('extracts value from nested JSON path', () => {
      const output = '{"results": {"primary": {"value": 0.95}}}';
      const result = extractMetric(output, {
        type: 'json_path',
        extract: 'results.primary.value',
      });
      expect(result).toBeCloseTo(0.95);
    });

    it('extracts JSON embedded in other text', () => {
      const output = 'Benchmark complete.\n{"metrics": {"latency": 120}}\nDone.';
      const result = extractMetric(output, {
        type: 'json_path',
        extract: 'metrics.latency',
      });
      expect(result).toBe(120);
    });

    it('returns null when JSON path not found', () => {
      const output = '{"a": 1}';
      const result = extractMetric(output, { type: 'json_path', extract: 'b.c' });
      expect(result).toBeNull();
    });

    it('returns null when no JSON in output', () => {
      const output = 'plain text only';
      const result = extractMetric(output, { type: 'json_path', extract: 'key' });
      expect(result).toBeNull();
    });

    it('returns null for invalid JSON', () => {
      const output = '{broken json';
      const result = extractMetric(output, { type: 'json_path', extract: 'key' });
      expect(result).toBeNull();
    });

    it('returns null when extract is missing', () => {
      const result = extractMetric('{"a":1}', { type: 'json_path' });
      expect(result).toBeNull();
    });

    it('converts string numbers to float', () => {
      const output = '{"val": "3.14"}';
      const result = extractMetric(output, { type: 'json_path', extract: 'val' });
      expect(result).toBeCloseTo(3.14);
    });
  });

  describe('exit_code mode', () => {
    it('returns 1 for exit code 0 (success)', () => {
      const result = extractMetric('', { type: 'exit_code' }, 0);
      expect(result).toBe(1);
    });

    it('returns 0 for non-zero exit code (failure)', () => {
      const result = extractMetric('', { type: 'exit_code' }, 1);
      expect(result).toBe(0);
    });

    it('returns 0 for exit code 2', () => {
      const result = extractMetric('', { type: 'exit_code' }, 2);
      expect(result).toBe(0);
    });
  });

  describe('unknown mode', () => {
    it('returns null for unknown extraction type', () => {
      const result = extractMetric('output', { type: 'xml_xpath', extract: '//score' });
      expect(result).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// extractAllMetrics
// ---------------------------------------------------------------------------

describe('extractAllMetrics', () => {
  it('extracts primary metric', () => {
    const output = 'score: 42';
    const config = {
      primary: { type: 'regex', extract: 'score: (\\d+)', direction: 'maximize' },
    };
    const result = extractAllMetrics(output, config);
    expect(result.primary).toBe(42);
    expect(result.guardPassed).toBe(true);
    expect(result.secondary).toEqual([]);
  });

  it('returns null primary when not configured', () => {
    const result = extractAllMetrics('output', {});
    expect(result.primary).toBeNull();
  });

  it('extracts secondary metrics', () => {
    const output = '{"latency": 120, "memory": 256}';
    const config = {
      secondary: [
        { name: 'latency', type: 'json_path', extract: 'latency', direction: 'minimize' },
        { name: 'memory', type: 'json_path', extract: 'memory', direction: 'minimize' },
      ],
    };
    const result = extractAllMetrics(output, config);
    expect(result.secondary).toHaveLength(2);
    expect(result.secondary[0]).toEqual({ name: 'latency', value: 120, direction: 'minimize' });
    expect(result.secondary[1]).toEqual({ name: 'memory', value: 256, direction: 'minimize' });
  });

  it('defaults secondary name to "unnamed"', () => {
    const output = 'val: 5';
    const config = {
      secondary: [{ type: 'regex', extract: 'val: (\\d+)' }],
    };
    const result = extractAllMetrics(output, config);
    expect(result.secondary[0].name).toBe('unnamed');
    expect(result.secondary[0].direction).toBe('maximize');
  });

  describe('guard check', () => {
    it('passes when success_pattern matches', () => {
      const output = 'All tests passed\nscore: 10';
      const config = {
        primary: { type: 'regex', extract: 'score: (\\d+)' },
        guard: { success_pattern: 'All tests passed' },
      };
      const result = extractAllMetrics(output, config);
      expect(result.guardPassed).toBe(true);
    });

    it('fails when success_pattern does not match', () => {
      const output = '3 tests failed\nscore: 10';
      const config = {
        primary: { type: 'regex', extract: 'score: (\\d+)' },
        guard: { success_pattern: 'All tests passed' },
      };
      const result = extractAllMetrics(output, config);
      expect(result.guardPassed).toBe(false);
    });

    it('defaults to exit code check when no success_pattern', () => {
      const config = { guard: {} };
      expect(extractAllMetrics('output', config, 0).guardPassed).toBe(true);
      expect(extractAllMetrics('output', config, 1).guardPassed).toBe(false);
    });

    it('guard fails on invalid regex', () => {
      const config = { guard: { success_pattern: '([invalid' } };
      const result = extractAllMetrics('output', config);
      expect(result.guardPassed).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// isImproved
// ---------------------------------------------------------------------------

describe('isImproved', () => {
  it('minimize: lower is better', () => {
    expect(isImproved(5, 10, 'minimize')).toBe(true);
    expect(isImproved(10, 5, 'minimize')).toBe(false);
    expect(isImproved(5, 5, 'minimize')).toBe(false);
  });

  it('maximize: higher is better', () => {
    expect(isImproved(10, 5, 'maximize')).toBe(true);
    expect(isImproved(5, 10, 'maximize')).toBe(false);
    expect(isImproved(5, 5, 'maximize')).toBe(false);
  });

  it('defaults to minimize', () => {
    expect(isImproved(3, 7)).toBe(true);
    expect(isImproved(7, 3)).toBe(false);
  });

  it('returns false when current is null', () => {
    expect(isImproved(null, 5, 'minimize')).toBe(false);
    expect(isImproved(undefined, 5, 'maximize')).toBe(false);
  });

  it('returns true when best is null (first valid result)', () => {
    expect(isImproved(5, null, 'minimize')).toBe(true);
    expect(isImproved(5, undefined, 'maximize')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// improvementPercent
// ---------------------------------------------------------------------------

describe('improvementPercent', () => {
  it('minimize: baseline 100 -> current 80 = 20% improvement', () => {
    const result = improvementPercent(80, 100, 'minimize');
    expect(result).toBe(20);
  });

  it('maximize: baseline 100 -> current 120 = 20% improvement', () => {
    const result = improvementPercent(120, 100, 'maximize');
    expect(result).toBe(20);
  });

  it('minimize: baseline 100 -> current 120 = -20% (regression)', () => {
    const result = improvementPercent(120, 100, 'minimize');
    expect(result).toBe(-20);
  });

  it('maximize: baseline 100 -> current 80 = -20% (regression)', () => {
    const result = improvementPercent(80, 100, 'maximize');
    expect(result).toBe(-20);
  });

  it('returns 0 when baseline is 0 or null', () => {
    expect(improvementPercent(50, 0, 'minimize')).toBe(0);
    expect(improvementPercent(50, null, 'minimize')).toBe(0);
  });

  it('returns 0 when current is 0 or null', () => {
    expect(improvementPercent(0, 100, 'minimize')).toBe(0);
    expect(improvementPercent(null, 100, 'minimize')).toBe(0);
  });

  it('rounds to 2 decimal places', () => {
    // baseline 3 -> current 2: improvement = (3-2)/3 * 100 = 33.33...
    const result = improvementPercent(2, 3, 'minimize');
    expect(result).toBe(33.33);
  });

  it('defaults to minimize', () => {
    const result = improvementPercent(80, 100);
    expect(result).toBe(20);
  });
});
