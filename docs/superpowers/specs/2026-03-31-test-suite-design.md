# AgentBoard Test Suite Design

Date: 2026-03-31
Status: Approved

## Framework

Vitest (ESM native, Vite pipeline shared, frontend+backend unified)

## Approach

Unit + Integration (方案 B): pure function unit tests + supertest API integration + RTL hook tests + in-memory SQLite

## Test Scope

| #   | Source File                                         | Type             | Strategy                                                                                         |
| --- | --------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------ |
| 1   | `backend/proxy.js`                                  | Unit             | convertMessages, convertTools, convertResponse, createStreamTransformer -- 纯函数, 最多边界 case |
| 2   | `backend/hooks.js`                                  | Unit             | isDangerous regex 安全检测, buildHooks event emission                                            |
| 3   | `backend/middleware.js`                             | Unit+Integration | authMiddleware (open/closed), wsAuth, Zod schema validation                                      |
| 4   | `backend/sessionStore.js`                           | Integration      | CRUD on in-memory SQLite (:memory:), schema correctness                                          |
| 5   | `backend/mcpHealth.js`                              | Unit             | State machine transitions, threshold logic, backoff                                              |
| 6   | `backend/server.js`                                 | Integration      | REST API routes via supertest, WebSocket subscription                                            |
| 7   | `frontend/src/components/AgentTimeline.test.jsx`    | Unit             | flattenEvent dispatch maps, all event types                                                      |
| 8   | `frontend/src/components/TerminalView.test.jsx`     | Unit             | extractTerminalLines Bash extraction                                                             |
| 9   | `frontend/src/components/FileChangesPanel.test.jsx` | Unit             | extractFileChanges aggregation                                                                   |
| 10  | `frontend/src/hooks/useWebSocket.test.jsx`          | Unit             | Connection lifecycle, message dispatch, state transitions                                        |

## File Organization

Co-located: `*.test.js` / `*.test.jsx` next to source files.

## Dependencies to Install

- `vitest` -- test runner
- `@testing-library/react` -- React component/hook testing
- `@testing-library/jest-dom` -- DOM matchers
- `jsdom` -- browser environment for frontend tests
- `supertest` -- HTTP assertion for Express routes

## Config

- `backend/vitest.config.js` -- Node environment
- `frontend/vitest.config.js` -- jsdom environment, shares Vite plugin-react
- Root package.json: `test`, `test:backend`, `test:frontend` scripts
- CI: add test step before build
