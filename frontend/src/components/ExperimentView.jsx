import { useState, useEffect, useMemo, useId, useRef } from 'react';
import { withClientAuth } from '../lib/clientAuth.js';
import { SwarmBranchCard } from './SwarmBranchCard.jsx';
import styles from './ExperimentView.module.css';

// ─── Template definitions ─────────────────────────────────────────────────────
const TEMPLATES = [
  { key: 'ml-training', label: '🧠 ML Training', file: 'ml-training.json' },
  {
    key: 'performance-optimization',
    label: '⚡ API Performance',
    file: 'performance-optimization.json',
  },
  { key: 'bundle-size', label: '📦 Bundle Size', file: 'bundle-size.json' },
  { key: 'ci-quality', label: '✅ CI Quality', file: 'ci-quality.json' },
  { key: 'security-fuzz', label: '🛡 Security Fuzz', file: 'security-fuzz.json' },
];

// ─── SVG Metric Chart ─────────────────────────────────────────────────────────
// Fix #1: useId() generates a per-instance unique ID, preventing SVG gradient
// id="areaGrad" from colliding when multiple MetricChart instances exist in DOM.
function MetricChart({ trialEvents }) {
  const uid = useId().replace(/:/g, '');
  const gradientId = `areaGrad_${uid}`;
  const WIDTH = 600;
  const HEIGHT = 200;
  const PAD = { top: 16, right: 16, bottom: 36, left: 52 };
  const chartW = WIDTH - PAD.left - PAD.right;
  const chartH = HEIGHT - PAD.top - PAD.bottom;

  const points = useMemo(() => {
    return trialEvents
      .map((e, i) => ({
        trial: e.content?.trialNumber ?? i + 1,
        metric: typeof e.content?.metric === 'number' ? e.content.metric : null,
        accepted: Boolean(e.content?.accepted),
        best: e.content?.bestMetric ?? null,
      }))
      .filter((p) => p.metric !== null);
  }, [trialEvents]);

  if (points.length < 2) {
    return (
      <div className={styles.chartEmpty}>
        Not enough data yet — run at least 2 trials to see the chart.
      </div>
    );
  }

  const metrics = points.map((p) => p.metric);
  const minY = Math.min(...metrics);
  const maxY = Math.max(...metrics);
  const rangeY = maxY - minY || 1;
  const minX = points[0].trial;
  const maxX = points[points.length - 1].trial;
  const rangeX = maxX - minX || 1;

  const toX = (trial) => PAD.left + ((trial - minX) / rangeX) * chartW;
  const toY = (metric) => PAD.top + (1 - (metric - minY) / rangeY) * chartH;

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(p.trial)} ${toY(p.metric)}`)
    .join(' ');

  const areaPath =
    `M ${toX(points[0].trial)} ${PAD.top + chartH} ` +
    points.map((p) => `L ${toX(p.trial)} ${toY(p.metric)}`).join(' ') +
    ` L ${toX(points[points.length - 1].trial)} ${PAD.top + chartH} Z`;

  // Y-axis tick labels (4 ticks)
  const yTicks = [0, 0.33, 0.67, 1].map((t) => ({
    val: minY + t * rangeY,
    y: PAD.top + (1 - t) * chartH,
  }));

  // X-axis ticks — show subset to avoid crowding
  const xStep = Math.max(1, Math.ceil(points.length / 6));
  const xTicks = points.filter((_, i) => i % xStep === 0 || i === points.length - 1);

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className={styles.chart}
      aria-label="Metric progression chart"
    >
      <defs>
        {/* Fix #1: use per-instance gradientId instead of static "areaGrad" */}
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--bg-accent)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="var(--bg-accent)" stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {/* Grid lines */}
      {yTicks.map(({ y }, i) => (
        <line
          key={i}
          x1={PAD.left}
          x2={PAD.left + chartW}
          y1={y}
          y2={y}
          stroke="var(--border-color)"
          strokeDasharray="4 4"
          strokeWidth="1"
        />
      ))}

      {/* Area fill — Fix #1: reference per-instance gradient */}
      <path d={areaPath} fill={`url(#${gradientId})`} />

      {/* Main line */}
      <path
        d={linePath}
        fill="none"
        stroke="var(--bg-accent)"
        strokeWidth="2"
        strokeLinejoin="round"
      />

      {/* Data points */}
      {points.map((p) => (
        <circle
          key={p.trial}
          cx={toX(p.trial)}
          cy={toY(p.metric)}
          r={4}
          fill={p.accepted ? 'var(--bg-accent)' : 'var(--status-error, #e53935)'}
          stroke="var(--bg-primary)"
          strokeWidth="2"
        >
          <title>
            Trial {p.trial}: {p.metric.toFixed(4)} ({p.accepted ? 'ACCEPTED' : 'REJECTED'})
          </title>
        </circle>
      ))}

      {/* Y-axis labels */}
      {yTicks.map(({ val, y }, i) => (
        <text
          key={i}
          x={PAD.left - 6}
          y={y + 4}
          textAnchor="end"
          fontSize="10"
          fill="var(--text-tertiary)"
        >
          {val.toFixed(3)}
        </text>
      ))}

      {/* X-axis labels */}
      {xTicks.map((p) => (
        <text
          key={p.trial}
          x={toX(p.trial)}
          y={PAD.top + chartH + 20}
          textAnchor="middle"
          fontSize="10"
          fill="var(--text-tertiary)"
        >
          {p.trial}
        </text>
      ))}

      {/* Axis labels */}
      <text
        x={PAD.left + chartW / 2}
        y={HEIGHT - 2}
        textAnchor="middle"
        fontSize="11"
        fill="var(--text-secondary)"
      >
        Trial #
      </text>
      <text
        x={10}
        y={PAD.top + chartH / 2}
        textAnchor="middle"
        fontSize="11"
        fill="var(--text-secondary)"
        transform={`rotate(-90, 10, ${PAD.top + chartH / 2})`}
      >
        Metric
      </text>

      {/* Legend */}
      <circle cx={PAD.left + chartW - 90} cy={PAD.top + 8} r={4} fill="var(--bg-accent)" />
      <text x={PAD.left + chartW - 82} y={PAD.top + 12} fontSize="10" fill="var(--text-secondary)">
        Accepted
      </text>
      <circle
        cx={PAD.left + chartW - 30}
        cy={PAD.top + 8}
        r={4}
        fill="var(--status-error, #e53935)"
      />
      <text x={PAD.left + chartW - 22} y={PAD.top + 12} fontSize="10" fill="var(--text-secondary)">
        Rejected
      </text>
    </svg>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ExperimentView({
  experimentRunId,
  experimentStatus,
  experimentEvents,
  subscribeExperiment,
  unsubscribeExperiment,
  loadExperimentRunsEvents,
  // P3 Swarm props
  swarmBranches = [],
  swarmHypotheses = [],
  swarmStatus = 'idle',
  swarmReasoning = null,
  runSwarm,
  abortSwarmRun,
  loadSwarmBranches,
}) {
  const [experiments, setExperiments] = useState([]);
  const [selectedExperiment, setSelectedExperiment] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState('');
  const [runs, setRuns] = useState([]);
  const [saveError, setSaveError] = useState(null);
  const [templateLoading, setTemplateLoading] = useState(false);
  // Fix #5: surfaces template-load errors to the user
  const [templateError, setTemplateError] = useState(null);
  const runsRequestControllerRef = useRef(null);
  const selectedExperimentIdRef = useRef(null);

  const cancelPendingRunsRequest = () => {
    runsRequestControllerRef.current?.abort();
    runsRequestControllerRef.current = null;
  };

  useEffect(() => {
    return () => {
      cancelPendingRunsRequest();
    };
  }, []);

  // Load experiments on mount
  useEffect(() => {
    fetchExperiments();
  }, []);

  const fetchExperiments = async () => {
    // Fix #4: removed console.error — fetch failure is non-critical,
    // the experiments list simply stays empty; no log pollution.
    try {
      const res = await fetch('/api/experiments', withClientAuth());
      if (res.ok) {
        const data = await res.json();
        setExperiments(data.experiments || []);
      }
    } catch {
      // silent: list stays empty; user can retry by reloading
    }
  };

  const handleSelectExperiment = async (exp) => {
    // Fix #7: clear runs immediately so previous experiment's list
    // is never briefly visible while the new fetch is in flight.
    selectedExperimentIdRef.current = exp.id;
    setRuns([]);
    setSelectedExperiment(exp);
    setIsEditing(false);
    setTemplateError(null);
    fetchRuns(exp.id);
  };

  const fetchRuns = async (expId) => {
    cancelPendingRunsRequest();
    const controller = new AbortController();
    runsRequestControllerRef.current = controller;

    // Fix #4: removed console.error — fetch failure leaves runs empty,
    // which the UI already handles gracefully with "No runs yet" copy.
    try {
      const res = await fetch(
        `/api/experiments/${expId}/runs`,
        withClientAuth({ signal: controller.signal }),
      );
      if (res.ok) {
        const data = await res.json();
        if (!controller.signal.aborted && selectedExperimentIdRef.current === expId) {
          setRuns(data.runs || []);
        }
      }
    } catch (e) {
      if (e.name === 'AbortError') return;
      // silent: runs stays []
    } finally {
      if (runsRequestControllerRef.current === controller) {
        runsRequestControllerRef.current = null;
      }
    }
  };

  // Fix #5: template load failures now surface a visible error message
  // instead of silently falling back to a blank template.
  const handleLoadTemplate = async (templateFile) => {
    setTemplateLoading(true);
    setTemplateError(null);
    try {
      const res = await fetch(`/api/experiment-templates/${templateFile}`, withClientAuth());
      if (res.ok) {
        const plan = await res.json();
        cancelPendingRunsRequest();
        selectedExperimentIdRef.current = null;
        setRuns([]);
        setEditForm(JSON.stringify(plan, null, 2));
        setSelectedExperiment(null);
        setIsEditing(true);
      } else {
        const err = await res.json().catch(() => ({}));
        setTemplateError(err.error || `Failed to load template (${res.status})`);
      }
    } catch (e) {
      setTemplateError(`Network error: ${e.message}`);
    } finally {
      setTemplateLoading(false);
    }
  };

  const handleNewExperiment = () => {
    cancelPendingRunsRequest();
    selectedExperimentIdRef.current = null;
    setRuns([]);
    setTemplateError(null);
    const template = {
      name: 'New Experiment',
      description: 'Describe your optimization goal here.',
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
      setSaveError('Invalid JSON — please check your syntax.');
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
        subscribeExperiment(data.runId, expId);
        fetchRuns(expId);
      }
    } catch {
      // Network failure — UI already shows empty state; no user action needed
    }
  };

  const handleAbort = async () => {
    if (!experimentRunId) return;
    try {
      await fetch(
        `/api/experiment-runs/${experimentRunId}/abort`,
        withClientAuth({ method: 'POST' }),
      );
    } catch {
      // Network failure — abort is best-effort; run will timeout naturally
    }
  };

  // Derive dashboard state from events
  const trialEvents = experimentEvents.filter((e) => e.subtype === 'trial_complete');
  let bestMetric = null;
  let trialCount = 0;
  let acceptedCount = 0;

  if (trialEvents.length > 0) {
    const lastEvent = trialEvents[trialEvents.length - 1];
    bestMetric = lastEvent.content?.bestMetric ?? null;
    trialCount = lastEvent.content?.totalTrials ?? 0;
    acceptedCount = lastEvent.content?.acceptedTrials ?? 0;
  }

  return (
    <div className={styles.container}>
      {/* ── Sidebar ── */}
      <div className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <h3>Experiments</h3>
          <button onClick={handleNewExperiment}>+ New</button>
        </div>

        {/* Template quick-pick */}
        <div className={styles.templateSection}>
          <div className={styles.templateLabel}>Start from template</div>
          <div className={styles.templateGrid}>
            {TEMPLATES.map((t) => (
              <button
                key={t.key}
                className={styles.templateBtn}
                onClick={() => handleLoadTemplate(t.file)}
                disabled={templateLoading}
                title={t.label}
              >
                {t.label}
              </button>
            ))}
          </div>
          {/* Fix #5: show template load error inline in the sidebar */}
          {templateError && <div className={styles.templateError}>{templateError}</div>}
        </div>

        <div className={styles.experimentList}>
          {experiments.map((exp) => (
            <div
              key={exp.id}
              className={`${styles.experimentItem} ${selectedExperiment?.id === exp.id ? styles.active : ''}`}
              onClick={() => handleSelectExperiment(exp)}
              title={exp.id}
            >
              <div>{exp.name}</div>
              <div className={styles.experimentId}>{exp.id.slice(0, 8)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Main Content ── */}
      <div className={styles.mainContent}>
        {isEditing ? (
          <div className={styles.editor}>
            <h2>Edit ResearchPlan (JSON)</h2>
            <textarea
              value={editForm}
              onChange={(e) => setEditForm(e.target.value)}
              className={styles.textarea}
              spellCheck={false}
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
              <button onClick={handleSave} className={styles.primaryButton}>
                Save
              </button>
            </div>
          </div>
        ) : selectedExperiment ? (
          <div className={styles.dashboard}>
            {/* Header */}
            <div className={styles.headerRow}>
              <h2>{selectedExperiment.name}</h2>
              <p className={styles.experimentId} style={{ cursor: 'pointer', userSelect: 'all' }}>
                ID: {selectedExperiment.id}
              </p>
              <p>{selectedExperiment.description}</p>
              <div className={styles.headerActions}>
                <button
                  onClick={() => handleRun(selectedExperiment.id)}
                  className={styles.primaryButton}
                >
                  ▶ Run Experiment
                </button>
                {runSwarm && (
                  <button
                    onClick={() => runSwarm(selectedExperiment.id)}
                    className={styles.swarmButton}
                    title="以 Swarm 模式并行探索多个优化方向"
                  >
                    ⚡ Run as Swarm
                  </button>
                )}
                <button
                  onClick={() => {
                    setEditForm(JSON.stringify(selectedExperiment.plan ?? {}, null, 2));
                    setIsEditing(true);
                  }}
                >
                  Edit Plan
                </button>
              </div>
            </div>

            {/* Recent Runs */}
            <div className={styles.runsCont}>
              <h3>Recent Runs</h3>
              {runs.length === 0 && (
                <div className={styles.runsEmpty}>
                  No runs yet. Click ▶ Run Experiment to start.
                </div>
              )}
              {runs.map((r) => (
                <div key={r.id} className={styles.runRow}>
                  <span className={`${styles.runStatus} ${styles[`status_${r.status}`]}`}>
                    {r.status}
                  </span>
                  <span>
                    Trials: {r.total_trials} ({r.accepted_trials} accepted)
                  </span>
                  <span>
                    Best: {r.best_metric !== null ? Number(r.best_metric).toFixed(4) : 'N/A'}
                  </span>
                  <div className={styles.runActions}>
                    {r.status === 'running' && experimentRunId !== r.id && (
                      <button onClick={() => subscribeExperiment(r.id, selectedExperiment.id)}>
                        👁 Watch
                      </button>
                    )}
                    {r.status !== 'running' && (
                      <button
                        onClick={() => {
                          loadExperimentRunsEvents(r.id, selectedExperiment.id);
                          if (loadSwarmBranches) loadSwarmBranches(r.id);
                        }}
                      >
                        View History
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Live Dashboard */}
            {experimentRunId && (
              <div className={styles.liveDashboard}>
                <div className={styles.liveHeader}>
                  <h3>
                    {swarmBranches.length > 0 ? 'Swarm Dashboard' : 'Live Dashboard'}
                    <span className={styles.statusBadge} data-status={experimentStatus}>
                      {swarmBranches.length > 0 ? swarmStatus : experimentStatus}
                    </span>
                  </h3>
                  <div className={styles.liveControls}>
                    {experimentStatus === 'running' &&
                      swarmBranches.length > 0 &&
                      abortSwarmRun && (
                        <button
                          onClick={() => abortSwarmRun(experimentRunId)}
                          className={styles.dangerButton}
                        >
                          ■ Abort Swarm
                        </button>
                      )}
                    {experimentStatus === 'running' && swarmBranches.length === 0 && (
                      <button onClick={handleAbort} className={styles.dangerButton}>
                        ■ Abort
                      </button>
                    )}
                    <button onClick={unsubscribeExperiment}>Close</button>
                  </div>
                </div>

                {/* ── P3 Swarm 看板 ─────────────────────────────── */}
                {swarmBranches.length > 0 && (
                  <div className={styles.swarmPanel}>
                    {/* Coordinator 状态行 */}
                    <div className={styles.swarmCoordinatorRow}>
                      <span className={styles.swarmCoordinatorLabel}>Coordinator</span>
                      <span className={styles.swarmCoordinatorStatus}>
                        {swarmStatus === 'decomposing' && '🔍 正在拆解研究方向…'}
                        {swarmStatus === 'running' && `🚀 ${swarmBranches.length} 个分支并行探索中`}
                        {swarmStatus === 'synthesizing' && '🧠 正在综合结果并选择最优方向…'}
                        {swarmStatus === 'completed' && '✅ 已选出最优分支'}
                        {swarmStatus === 'failed' && '❌ Swarm 异常终止'}
                      </span>
                    </div>

                    {/* 假说列表（Decompose 阶段展示） */}
                    {swarmHypotheses.length > 0 && swarmStatus === 'decomposing' && (
                      <div className={styles.swarmHypotheses}>
                        {swarmHypotheses.map((h) => (
                          <div key={h.id} className={styles.swarmHypothesisItem}>
                            <span className={styles.swarmHypothesisId}>Branch {h.id}</span>
                            <span>{h.text}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Branch 卡片网格 */}
                    <div className={styles.swarmBranchGrid}>
                      {swarmBranches.map((branch) => (
                        <SwarmBranchCard
                          key={branch.branchId ?? branch.branchIndex}
                          branch={branch}
                          index={branch.branchIndex}
                        />
                      ))}
                    </div>

                    {/* Coordinator 选择理由 */}
                    {swarmReasoning && (
                      <div className={styles.swarmReasoning}>
                        <span className={styles.swarmReasoningLabel}>选择理由</span>
                        <p>{swarmReasoning}</p>
                      </div>
                    )}
                  </div>
                )}
                {/* KPI Cards */}
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
                    <div className={styles.metricValue}>
                      {trialCount > 0
                        ? `${acceptedCount} (${Math.round((acceptedCount / trialCount) * 100)}%)`
                        : '--'}
                    </div>
                  </div>
                </div>

                {/* ── Metric Chart ── */}
                <div className={styles.chartWrapper}>
                  <div className={styles.chartTitle}>Metric Progression</div>
                  <MetricChart trialEvents={trialEvents} />
                </div>

                {/* Event Log */}
                {/* Fix #3: removed .reverse() + key={idx}.
                    Instead we iterate in original order and use CSS column-reverse
                    so the list appears newest-first without index shifting.
                    Key: use timestamp + subtype which is stable across re-renders. */}
                <div className={styles.eventsList}>
                  {experimentEvents.length === 0 && (
                    <div className={styles.eventsEmpty}>Waiting for events…</div>
                  )}
                  {experimentEvents.map((evt, idx) => (
                    <div
                      key={`${evt.timestamp}-${evt.subtype}-${idx}`}
                      className={`${styles.eventRow} ${
                        evt.subtype === 'trial_complete' && evt.content?.accepted
                          ? styles.eventAccepted
                          : evt.subtype === 'trial_rejected' ||
                              (evt.subtype === 'trial_complete' && !evt.content?.accepted)
                            ? styles.eventRejected
                            : ''
                      }`}
                    >
                      <span className={styles.time}>
                        {new Date(evt.timestamp).toLocaleTimeString()}
                      </span>
                      <span className={styles.type}>[{evt.subtype}]</span>
                      <span className={styles.info}>
                        {evt.subtype === 'trial_complete' &&
                          `Trial ${evt.content?.trialNumber}: ${evt.content?.metric ?? 'metric failed'} — ${evt.content?.accepted ? '✓ ACCEPTED' : '✗ REJECTED'}`}
                        {evt.subtype === 'trial_rejected' &&
                          `Trial ${evt.content?.trialNumber} rejected: ${evt.content?.reason}`}
                        {evt.subtype === 'trial_accepted' &&
                          `Trial ${evt.content?.trialNumber} accepted (↑${evt.content?.improvement?.toFixed(2) ?? '?'}%)`}
                        {evt.subtype === 'baseline' && `Baseline metric: ${evt.content?.metric}`}
                        {evt.subtype === 'experiment_start' &&
                          `Experiment started (max ${evt.content?.maxExperiments} trials)`}
                        {evt.subtype === 'experiment_done' &&
                          `✓ Finished — ${evt.content?.totalTrials} trials, best: ${evt.content?.bestMetric}`}
                        {evt.subtype === 'budget_exhausted' &&
                          `Budget exhausted: ${evt.content?.reason}`}
                        {evt.subtype === 'experiment_error' && `Error: ${evt.content?.error}`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>🔬</div>
            <div>Select an experiment or create one from a template.</div>
          </div>
        )}
      </div>
    </div>
  );
}
