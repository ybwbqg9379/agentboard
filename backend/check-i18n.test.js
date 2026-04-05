import { describe, it, expect } from 'vitest';
import { collectForbiddenI18nIssues } from '../scripts/check-i18n.mjs';

describe('check-i18n forbidden call patterns', () => {
  it('flags bare identifiers passed across multiple lines', () => {
    const issues = collectForbiddenI18nIssues(
      `t(
  statusKey,
);`,
      'demo.jsx',
    );

    expect(issues).toEqual([
      expect.stringContaining(
        'demo.jsx:1: t()/i18n.t() first argument must be a string/template literal',
      ),
    ]);
    expect(issues[0]).toContain('"statusKey"');
  });

  it('flags concatenated keys across multiple lines', () => {
    const issues = collectForbiddenI18nIssues(
      `i18n.t(
  'statusBar.' + nextStatus,
);`,
      'demo.jsx',
    );

    expect(issues).toEqual([
      'demo.jsx:1: do not build i18n keys with + inside t() — use one literal/template or // i18n-exempt on this call',
    ]);
  });

  it('allows supported indirect key props and rejects arbitrary property access', () => {
    expect(
      collectForbiddenI18nIssues(
        `const row = { labelKey: 'statusBar.running' }; t(row.labelKey);`,
        'demo.jsx',
      ),
    ).toEqual([]);

    expect(
      collectForbiddenI18nIssues(
        `const row = { badKey: 'statusBar.running' }; t(row.badKey);`,
        'demo.jsx',
      ),
    ).toEqual([expect.stringContaining('supported indirect key property access')]);
  });

  it('respects i18n-exempt anywhere on the call span', () => {
    const issues = collectForbiddenI18nIssues(
      `t(
  statusKey, // i18n-exempt
);`,
      'demo.jsx',
    );

    expect(issues).toEqual([]);
  });
});
