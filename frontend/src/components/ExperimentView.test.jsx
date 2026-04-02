// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../lib/clientAuth.js', () => ({
  withClientAuth: (init = {}) => init,
}));

vi.mock('./ExperimentView.module.css', () => ({
  default: new Proxy(
    {},
    {
      get: (_target, prop) => String(prop),
    },
  ),
}));

import ExperimentView from './ExperimentView.jsx';

vi.stubGlobal('fetch', vi.fn());

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function experiment(id, name) {
  return {
    id,
    name,
    description: `${name} description`,
    plan: {
      name,
      metrics: {
        primary: {
          command: 'npm test',
          type: 'exit_code',
          direction: 'maximize',
        },
      },
    },
  };
}

function jsonResponse(data) {
  return {
    ok: true,
    json: async () => data,
  };
}

function run(id, bestMetric) {
  return {
    id,
    status: 'completed',
    total_trials: 3,
    accepted_trials: 1,
    best_metric: bestMetric,
  };
}

describe('ExperimentView', () => {
  beforeEach(() => {
    fetch.mockReset();
  });

  it('ignores stale run-list responses when switching experiments quickly', async () => {
    const expA = experiment('exp-a', 'Experiment A');
    const expB = experiment('exp-b', 'Experiment B');
    const runsA = deferred();
    const runsB = deferred();

    fetch.mockImplementation((url) => {
      if (url === '/api/experiments') {
        return Promise.resolve(jsonResponse({ experiments: [expA, expB] }));
      }
      if (url === '/api/experiments/exp-a/runs') {
        return runsA.promise;
      }
      if (url === '/api/experiments/exp-b/runs') {
        return runsB.promise;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(
      <ExperimentView
        experimentRunId={null}
        experimentStatus="idle"
        experimentEvents={[]}
        subscribeExperiment={vi.fn()}
        unsubscribeExperiment={vi.fn()}
        loadExperimentRunsEvents={vi.fn()}
      />,
    );

    await screen.findByText('Experiment A');
    fireEvent.click(screen.getByText('Experiment A'));
    fireEvent.click(screen.getByText('Experiment B'));

    runsB.resolve(jsonResponse({ runs: [run('run-b', 0.2222)] }));
    expect(await screen.findByText(/Best: 0\.2222/)).toBeInTheDocument();

    runsA.resolve(jsonResponse({ runs: [run('run-a', 0.1111)] }));

    await waitFor(() => {
      expect(screen.queryByText(/Best: 0\.1111/)).not.toBeInTheDocument();
    });
    expect(screen.getByText(/Best: 0\.2222/)).toBeInTheDocument();
  });

  it('applies explicit module classes to primary action buttons', async () => {
    const exp = experiment('exp-1', 'Experiment Primary');

    fetch.mockImplementation((url) => {
      if (url === '/api/experiments') {
        return Promise.resolve(jsonResponse({ experiments: [exp] }));
      }
      if (url === '/api/experiments/exp-1/runs') {
        return Promise.resolve(jsonResponse({ runs: [] }));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(
      <ExperimentView
        experimentRunId={null}
        experimentStatus="idle"
        experimentEvents={[]}
        subscribeExperiment={vi.fn()}
        unsubscribeExperiment={vi.fn()}
        loadExperimentRunsEvents={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: '+ New' }));
    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass('primaryButton');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByText('Experiment Primary'));

    expect(await screen.findByRole('button', { name: /Run Experiment/i })).toHaveClass(
      'primaryButton',
    );
  });
});
