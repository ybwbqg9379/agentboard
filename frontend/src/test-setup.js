import { expect } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';

// Use explicit `expect.extend` so matchers attach to the same `vitest` instance as the test runner
// (importing `@testing-library/jest-dom/vitest` can bind to a nested `frontend/node_modules/vitest`
// when `vitest` is invoked from the repo root while tests import the hoisted/root copy).
expect.extend(matchers);

import './i18n.js';
