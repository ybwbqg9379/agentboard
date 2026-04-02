import { useState, useEffect } from 'react';
import { withClientAuth } from '../lib/clientAuth.js';
import styles from './ExperimentView.module.css';

export default function ExperimentView({
  experimentRunId,
  experimentStatus,
  experimentEvents,
  subscribeExperiment,
  unsubscribeExperiment,
  loadExperimentRunsEvents,
}) {
  const [experiments, setExperiments] = useState([]);
  const [selectedExperiment, setSelectedExperiment] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState('');
  const [runs, setRuns] = useState([]);
  const [saveError, setSaveError] = useState(null);

  // Load experiments
  useEffect(() => {
    fetchExperiments();
  }, []);

  const fetchExperiments = async () => {
    try {
      const res = await fetch('/api/experiments', withClientAuth());
      if (res.ok) {
        const data = await res.json();
        setExperiments(data.experiments || []);
      }
    } catch (e) {
      console.error('Failed to fetch experiments', e);
    }
  };

  const handleSelectExperiment = async (exp) => {
    setSelectedExperiment(exp);
    setIsEditing(false);
    fetchRuns(exp.id);
  };

  const fetchRuns = async (expId) => {
    try {
      const res = await fetch(`/api/experiments/${expId}/runs`, withClientAuth());
      if (res.ok) {
        const data = await res.json();
        setRuns(data.runs || []);
      }
    } catch (e) {
      console.error('Failed to fetch runs', e);
    }
  };

  const handleNewExperiment = () => {
    const template = {
      name: 'New Experiment',
      description: 'Desc',
      target: { files: [] },
      metrics: {
        primary: { command: 'npm test', type: 'exit_code', direction: 'maximize' },
      },
      budget: { max_experiments: 10 },
    };
    setEditForm(JSON.stringify(template, null, 2));
    setSelectedExperiment(null);
    setIsEditing(true);
  };

  const handleSave = async () => {
    setSaveError(null);
    let plan;
    try {
      plan = JSON.parse(editForm);
    } catch {
      setSaveError('Invalid JSON');
      return;
    }
    const url = selectedExperiment
      ? `/api/experiments/${selectedExperiment.id}`
      : '/api/experiments';
    const method = selectedExperiment ? 'PUT' : 'POST';

    try {
      const res = await fetch(
        url,
        withClientAuth({
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: plan.name || 'Untitled',
            description: plan.description || '',
            plan,
          }),
        }),
      );

      if (res.ok) {
        setIsEditing(false);
        setSaveError(null);
        fetchExperiments();
      } else {
        const errData = await res.json().catch(() => ({}));
        setSaveError(errData.error || 'Validation failed');
      }
    } catch (e) {
      setSaveError(`Save failed: ${e.message}`);
    }
  };

  const handleRun = async (expId) => {
    try {
      const res = await fetch(`/api/experiments/${expId}/run`, withClientAuth({ method: 'POST' }));
      if (res.ok) {
        const data = await res.json();
        // Subscribe to the new run
        subscribeExperiment(data.runId, expId);
        fetchRuns(expId);
      }
    } catch (e) {
      console.error('Failed to run experiment', e);
    }
  };

  const handleAbort = async () => {
    if (!experimentRunId) return;
    try {
      await fetch(
        `/api/experiment-runs/${experimentRunId}/abort`,
        withClientAuth({ method: 'POST' }),
      );
    } catch (e) {
      console.error('Failed to abort run', e);
    }
  };

  // Derive simple dashboard state from events array
  let bestMetric = null;
  let trialCount = 0;
  let acceptedCount = 0;

  // Find the most recent 'trial_complete' or 'experiment_done' metrics
  const trialEvents = experimentEvents.filter((e) => e.subtype === 'trial_complete');
  if (trialEvents.length > 0) {
    const lastEvent = trialEvents[trialEvents.length - 1];
    bestMetric = lastEvent.content?.bestMetric ?? null;
    trialCount = lastEvent.content?.totalTrials ?? 0;
    acceptedCount = lastEvent.content?.acceptedTrials ?? 0;
  }

  return (
    <div className={styles.container}>
      <div className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <h3>Experiments</h3>
          <button onClick={handleNewExperiment}>+ New</button>
        </div>
        <div className={styles.experimentList}>
          {experiments.map((exp) => (
            <div
              key={exp.id}
              className={`${styles.experimentItem} ${selectedExperiment?.id === exp.id ? styles.active : ''}`}
              onClick={() => handleSelectExperiment(exp)}
            >
              {exp.name}
            </div>
          ))}
        </div>
      </div>

      <div className={styles.mainContent}>
        {isEditing ? (
          <div className={styles.editor}>
            <h2>Edit ResearchPlan (JSON)</h2>
            <textarea
              value={editForm}
              onChange={(e) => setEditForm(e.target.value)}
              className={styles.textarea}
            />
            {saveError && <div className={styles.saveError}>{saveError}</div>}
            <div className={styles.actions}>
              <button
                onClick={() => {
                  setIsEditing(false);
                  setSaveError(null);
                }}
              >
                Cancel
              </button>
              <button onClick={handleSave} className="primary">
                Save
              </button>
            </div>
          </div>
        ) : selectedExperiment ? (
          <div className={styles.dashboard}>
            <div className={styles.headerRow}>
              <h2>{selectedExperiment.name}</h2>
              <p>{selectedExperiment.description}</p>
              <button onClick={() => handleRun(selectedExperiment.id)} className="primary">
                Run Experiment
              </button>
              <button
                onClick={() => {
                  setEditForm(JSON.stringify(selectedExperiment.plan, null, 2));
                  setIsEditing(true);
                }}
              >
                Edit Plan
              </button>
            </div>

            <div className={styles.runsCont}>
              <h3>Recent Runs</h3>
              {runs.map((r) => (
                <div key={r.id} className={styles.runRow}>
                  <span>{r.status}</span>
                  <span>
                    Trials: {r.total_trials} ({r.accepted_trials} accepted)
                  </span>
                  <span>Best: {r.best_metric ?? 'N/A'}</span>
                  {r.status === 'running' && experimentRunId !== r.id && (
                    <button onClick={() => subscribeExperiment(r.id, selectedExperiment.id)}>
                      Watch
                    </button>
                  )}
                  {r.status !== 'running' && (
                    <button onClick={() => loadExperimentRunsEvents(r.id, selectedExperiment.id)}>
                      View History
                    </button>
                  )}
                </div>
              ))}
            </div>

            {experimentRunId && (
              <div className={styles.liveDashboard}>
                <div className={styles.liveHeader}>
                  <h3>Live Dashboard - {experimentStatus}</h3>
                  {experimentStatus === 'running' && (
                    <button onClick={handleAbort} className="danger">
                      Abort
                    </button>
                  )}
                  <button onClick={unsubscribeExperiment}>Close View</button>
                </div>

                <div className={styles.metricsBar}>
                  <div className={styles.metricCard}>
                    <label>Best Metric</label>
                    <div className={styles.metricValue}>
                      {bestMetric !== null ? Number(bestMetric).toFixed(4) : '--'}
                    </div>
                  </div>
                  <div className={styles.metricCard}>
                    <label>Trials</label>
                    <div className={styles.metricValue}>{trialCount}</div>
                  </div>
                  <div className={styles.metricCard}>
                    <label>Accepted</label>
                    <div className={styles.metricValue}>{acceptedCount}</div>
                  </div>
                </div>

                <div className={styles.eventsList}>
                  {experimentEvents.map((evt, idx) => (
                    <div key={idx} className={styles.eventRow}>
                      <span className={styles.time}>
                        {new Date(evt.timestamp).toLocaleTimeString()}
                      </span>
                      <span className={styles.type}>[{evt.subtype}]</span>
                      <span className={styles.info}>
                        {evt.subtype === 'trial_complete' &&
                          `Trial ${evt.content?.trialNumber}: Metric ${evt.content?.metric ?? 'failed'} - ${evt.content?.accepted ? 'ACCEPTED' : 'REJECTED'}`}
                        {evt.subtype === 'trial_rejected' &&
                          `Trial ${evt.content?.trialNumber} rejected: ${evt.content?.reason}`}
                        {evt.subtype === 'experiment_done' &&
                          `Finished with total ${evt.content?.totalTrials} trials.`}
                        {evt.subtype === 'budget_exhausted' &&
                          `Budget Exhausted: ${evt.content?.reason}`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className={styles.emptyState}>Select or create an experiment.</div>
        )}
      </div>
    </div>
  );
}
