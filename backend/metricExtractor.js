/**
 * metricExtractor.js
 *
 * Extracts quantitative metrics from command output.
 * Supports three extraction modes:
 *   - regex:     Apply a regex with a capture group to extract a numeric value
 *   - json_path: Parse output as JSON and extract by dot-separated path
 *   - exit_code: Use the command's exit code (0 → success)
 */

/**
 * Extract a single metric value from command output.
 *
 * @param {string} output - Raw stdout/stderr from the benchmark command
 * @param {object} config - Metric extraction configuration
 * @param {string} [config.type='regex'] - Extraction mode: 'regex' | 'json_path' | 'exit_code'
 * @param {string} config.extract - Regex pattern (with capture group) or JSON path
 * @param {number} [exitCode] - The process exit code (used for exit_code mode)
 * @returns {number|null} Extracted numeric value, or null if extraction fails
 */
export function extractMetric(output, config, exitCode = 0) {
  const mode = config.type || 'regex';

  switch (mode) {
    case 'regex': {
      if (!config.extract) return null;
      try {
        const re = new RegExp(config.extract, 'm');
        const match = output.match(re);
        if (match && match[1] !== undefined) {
          const val = parseFloat(match[1]);
          return Number.isFinite(val) ? val : null;
        }
      } catch (err) {
        console.error(`[metricExtractor] Invalid regex "${config.extract}": ${err.message}`);
      }
      return null;
    }

    case 'json_path': {
      if (!config.extract) return null;
      try {
        // Try to find JSON in the output (may be surrounded by other text)
        const jsonMatch = output.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return null;
        const json = JSON.parse(jsonMatch[0]);
        const val = getByPath(json, config.extract);
        if (val !== undefined && val !== null) {
          const num = parseFloat(val);
          return Number.isFinite(num) ? num : null;
        }
      } catch (err) {
        console.error(`[metricExtractor] JSON parse error: ${err.message}`);
      }
      return null;
    }

    case 'exit_code': {
      return exitCode === 0 ? 1 : 0;
    }

    default:
      console.error(`[metricExtractor] Unknown extraction mode: ${mode}`);
      return null;
  }
}

/**
 * Run all metric extractions for a complete benchmark result.
 *
 * @param {string} output - Combined stdout from benchmark commands
 * @param {object} metricsConfig - The `metrics` section of a ResearchPlan
 * @param {number} [exitCode=0] - Exit code from the benchmark command
 * @returns {{ primary: number|null, secondary: object[], guardPassed: boolean }}
 */
export function extractAllMetrics(output, metricsConfig, exitCode = 0) {
  // Primary metric
  const primary = metricsConfig.primary
    ? extractMetric(output, metricsConfig.primary, exitCode)
    : null;

  // Secondary metrics
  const secondary = (metricsConfig.secondary || []).map((cfg) => ({
    name: cfg.name || 'unnamed',
    value: extractMetric(output, cfg, exitCode),
    direction: cfg.direction || 'maximize',
  }));

  // Guard check
  let guardPassed = true;
  if (metricsConfig.guard) {
    const guardCfg = metricsConfig.guard;
    if (guardCfg.success_pattern) {
      try {
        const re = new RegExp(guardCfg.success_pattern, 'm');
        guardPassed = re.test(output);
      } catch {
        guardPassed = false;
      }
    } else {
      // Default: guard passes if exit code is 0
      guardPassed = exitCode === 0;
    }
  }

  return { primary, secondary, guardPassed };
}

/**
 * Compare two metric values to determine if there's improvement.
 *
 * @param {number} current - Current trial's metric value
 * @param {number} best - Previous best metric value
 * @param {string} direction - 'minimize' or 'maximize'
 * @returns {boolean} Whether current is an improvement over best
 */
export function isImproved(current, best, direction = 'minimize') {
  if (current === null || current === undefined) return false;
  if (best === null || best === undefined) return true; // First valid result is always an improvement

  if (direction === 'minimize') {
    return current < best;
  }
  return current > best;
}

/**
 * Calculate improvement percentage between two metric values.
 *
 * @param {number} current
 * @param {number} baseline
 * @param {string} direction
 * @returns {number} Improvement percentage (positive = better)
 */
export function improvementPercent(current, baseline, direction = 'minimize') {
  if (!baseline || !current) return 0;
  const delta =
    direction === 'minimize'
      ? ((baseline - current) / baseline) * 100
      : ((current - baseline) / baseline) * 100;
  return Math.round(delta * 100) / 100;
}

// ── Internal helpers ──

/**
 * Get a nested value from an object by dot-separated path.
 * @param {object} obj
 * @param {string} path - e.g. "results.primary.value"
 * @returns {*}
 */
function getByPath(obj, path) {
  const keys = path.split('.');
  let current = obj;
  for (const key of keys) {
    if (current === null || current === undefined) return undefined;
    current = current[key];
  }
  return current;
}
