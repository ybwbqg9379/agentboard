import { useState, useEffect, useMemo, useId, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch, ApiFetchError } from '../lib/apiFetch.js';
import { SwarmBranchCard } from './SwarmBranchCard.jsx';
import styles from './ExperimentView.module.css';

const TEMPLATE_DEFS = [
  { key: 'ml-training', labelKey: 'experiment.templates.mlTraining', file: 'ml-training.json' },
  {
    key: 'performance-optimization',
    labelKey: 'experiment.templates.apiPerformance',
    file: 'performance-optimization.json',
  },
  { key: 'bundle-size', labelKey: 'experiment.templates.bundleSize', file: 'bundle-size.json' },
  { key: 'ci-quality', labelKey: 'experiment.templates.ciQuality', file: 'ci-quality.json' },
  {
    key: 'security-fuzz',
    labelKey: 'experiment.templates.securityFuzz',
    file: 'security-fuzz.json',
  },
];

// ─── SVG Metric Chart ─────────────────────────────────────────────────────────
// Fix #1: useId() generates a per-instance unique ID, preventing SVG gradient
// id="areaGrad" from colliding when multiple MetricChart instances exist in DOM.
function MetricChart({ trialEvents, t }) {
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
    return <div className={styles.chartEmpty}>{t('experiment.chartNotEnough')}</div>;
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
  const yTicks = [0, 0.33, 0.67, 1].map((ratio) => ({
    val: minY + ratio * rangeY,
    y: PAD.top + (1 - ratio) * chartH,
  }));

  // X-axis ticks — show subset to avoid crowding
  const xStep = Math.max(1, Math.ceil(points.length / 6));
  const xTicks = points.filter((_, i) => i % xStep === 0 || i === points.length - 1);

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className={styles.chart}
      aria-label={t('experiment.chartAria')}
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
            {t('experiment.chartTrialTitle', {
              trial: p.trial,
              metric: p.metric.toFixed(4),
              verdict: p.accepted ? t('common.accepted') : t('common.rejected'),
            })}
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
        {t('experiment.axisTrial')}
      </text>
      <text
        x={10}
        y={PAD.top + chartH / 2}
        textAnchor="middle"
        fontSize="11"
        fill="var(--text-secondary)"
        transform={`rotate(-90, 10, ${PAD.top + chartH / 2})`}
      >
        {t('experiment.axisMetric')}
      </text>

      {/* Legend */}
      <circle cx={PAD.left + chartW - 90} cy={PAD.top + 8} r={4} fill="var(--bg-accent)" />
      <text x={PAD.left + chartW - 82} y={PAD.top + 12} fontSize="10" fill="var(--text-secondary)">
        {t('experiment.legendAccepted')}
      </text>
      <circle
        cx={PAD.left + chartW - 30}
        cy={PAD.top + 8}
        r={4}
        fill="var(--status-error, #e53935)"
      />
      <text x={PAD.left + chartW - 22} y={PAD.top + 12} fontSize="10" fill="var(--text-secondary)">
        {t('experiment.legendRejected')}
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
  const { t } = useTranslation();
  const templates = useMemo(() => TEMPLATE_DEFS.map((d) => ({ ...d, label: t(d.labelKey) })), [t]);
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

  const fetchExperiments = useCallback(async (signal) => {
    try {
      const res = await apiFetch('/api/experiments', { signal });
      if (res.ok && !signal?.aborted) {
        const data = await res.json();
        setExperiments(data.experiments || []);
      }
    } catch (e) {
      if (e instanceof ApiFetchError && (e.isUserAbort || e.isTimeout)) return;
      // silent: list stays empty; user can retry by reloading
    }
  }, []);

  // Load experiments on mount
  useEffect(() => {
    const controller = new AbortController();
    fetchExperiments(controller.signal);
    return () => controller.abort();
  }, [fetchExperiments]);

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
      const res = await apiFetch(`/api/experiments/${expId}/runs`, {
        signal: controller.signal,
      });
      if (res.ok) {
        const data = await res.json();
        if (!controller.signal.aborted && selectedExperimentIdRef.current === expId) {
          setRuns(data.runs || []);
        }
      }
    } catch (e) {
      if (e instanceof ApiFetchError && (e.isUserAbort || e.isTimeout)) return;
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
      const res = await apiFetch(`/api/experiment-templates/${templateFile}`);
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
        setTemplateError(err.error || t('experiment.templateLoadFailed', { status: res.status }));
      }
    } catch (e) {
      setTemplateError(t('experiment.networkError', { message: e.message }));
    } finally {
      setTemplateLoading(false);
    }
  };

  const handleNewExperiment = useCallback(() => {
    cancelPendingRunsRequest();
    selectedExperimentIdRef.current = null;
    setRuns([]);
    setTemplateError(null);
    const template = {
      name: t('experiment.newExperimentName'),
      description: t('experiment.newExperimentDesc'),
      target: { files: [] },
      metrics: {
        primary: { command: 'npm test', type: 'exit_code', direction: 'maximize' },
      },
      budget: { max_experiments: 10 },
    };
    setEditForm(JSON.stringify(template, null, 2));
    setSelectedExperiment(null);
    setIsEditing(true);
  }, [t]);

  const handleSave = async () => {
    setSaveError(null);
    let plan;
    try {
      plan = JSON.parse(editForm);
    } catch {
      setSaveError(t('experiment.invalidJson'));
      return;
    }
    const url = selectedExperiment
      ? `/api/experiments/${selectedExperiment.id}`
      : '/api/experiments';
    const method = selectedExperiment ? 'PUT' : 'POST';

    try {
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: plan.name || t('experiment.untitled'),
          description: plan.description || '',
          plan,
        }),
      });

      if (res.ok) {
        setIsEditing(false);
        setSaveError(null);
        fetchExperiments();
      } else {
        const errData = await res.json().catch(() => ({}));
        setSaveError(errData.error || t('experiment.validationFailed'));
      }
    } catch (e) {
      setSaveError(t('experiment.saveFailed', { message: e.message }));
    }
  };

  const handleRun = async (expId) => {
    try {
      const res = await apiFetch(`/api/experiments/${expId}/run`, { method: 'POST' });
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
      await apiFetch(`/api/experiment-runs/${experimentRunId}/abort`, { method: 'POST' });
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
          <h3>{t('experiment.sidebarTitle')}</h3>
          <button type="button" onClick={handleNewExperiment}>
            {t('experiment.new')}
          </button>
        </div>

        {/* Template quick-pick */}
        <div className={styles.templateSection}>
          <div className={styles.templateLabel}>{t('experiment.fromTemplate')}</div>
          <div className={styles.templateGrid}>
            {templates.map((tpl) => (
              <button
                key={tpl.key}
                type="button"
                className={styles.templateBtn}
                onClick={() => handleLoadTemplate(tpl.file)}
                disabled={templateLoading}
                title={tpl.label}
              >
                {tpl.label}
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
            <h2>{t('experiment.editTitle')}</h2>
            <textarea
              value={editForm}
              onChange={(e) => setEditForm(e.target.value)}
              className={styles.textarea}
              spellCheck={false}
            />
            {saveError && <div className={styles.saveError}>{saveError}</div>}
            <div className={styles.actions}>
              <button
                type="button"
                onClick={() => {
                  setIsEditing(false);
                  setSaveError(null);
                }}
              >
                {t('experiment.cancel')}
              </button>
              <button type="button" onClick={handleSave} className={styles.primaryButton}>
                {t('experiment.save')}
              </button>
            </div>
          </div>
        ) : selectedExperiment ? (
          <div className={styles.dashboard}>
            {/* Header */}
            <div className={styles.headerRow}>
              <h2>{selectedExperiment.name}</h2>
              <p className={styles.experimentId} style={{ cursor: 'pointer', userSelect: 'all' }}>
                {t('experiment.idPrefix')} {selectedExperiment.id}
              </p>
              <p>{selectedExperiment.description}</p>
              <div className={styles.headerActions}>
                <button
                  type="button"
                  onClick={() => handleRun(selectedExperiment.id)}
                  className={styles.primaryButton}
                >
                  {t('experiment.runExperiment')}
                </button>
                {runSwarm && (
                  <button
                    type="button"
                    onClick={() => runSwarm(selectedExperiment.id)}
                    className={styles.swarmButton}
                    title={t('experiment.runSwarmTitle')}
                  >
                    {t('experiment.runSwarm')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setEditForm(JSON.stringify(selectedExperiment.plan ?? {}, null, 2));
                    setIsEditing(true);
                  }}
                >
                  {t('experiment.editPlan')}
                </button>
              </div>
            </div>

            {/* Recent Runs */}
            <div className={styles.runsCont}>
              <h3>{t('experiment.recentRuns')}</h3>
              {runs.length === 0 && (
                <div className={styles.runsEmpty}>{t('experiment.noRuns')}</div>
              )}
              {runs.map((r) => (
                <div key={r.id} className={styles.runRow}>
                  <span className={`${styles.runStatus} ${styles[`status_${r.status}`]}`}>
                    {t(`experiment.runStatus.${r.status}`, { defaultValue: r.status })}
                  </span>
                  <span>
                    {t('experiment.trialsLine', {
                      total: r.total_trials,
                      accepted: r.accepted_trials,
                    })}
                  </span>
                  <span>
                    {t('experiment.bestLine', {
                      value:
                        r.best_metric !== null ? Number(r.best_metric).toFixed(4) : t('common.na'),
                    })}
                  </span>
                  <div className={styles.runActions}>
                    {r.status === 'running' && experimentRunId !== r.id && (
                      <button
                        type="button"
                        onClick={() => subscribeExperiment(r.id, selectedExperiment.id)}
                      >
                        {t('experiment.watch')}
                      </button>
                    )}
                    {r.status !== 'running' && (
                      <button
                        type="button"
                        onClick={() => {
                          loadExperimentRunsEvents(r.id, selectedExperiment.id);
                          if (loadSwarmBranches) loadSwarmBranches(r.id);
                        }}
                      >
                        {t('experiment.viewHistory')}
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
                    {swarmBranches.length > 0
                      ? t('experiment.swarmDashboard')
                      : t('experiment.liveDashboard')}
                    <span className={styles.statusBadge} data-status={experimentStatus}>
                      {swarmBranches.length > 0 ? swarmStatus : experimentStatus}
                    </span>
                  </h3>
                  <div className={styles.liveControls}>
                    {experimentStatus === 'running' &&
                      swarmBranches.length > 0 &&
                      abortSwarmRun && (
                        <button
                          type="button"
                          onClick={() => abortSwarmRun(experimentRunId)}
                          className={styles.dangerButton}
                        >
                          {t('experiment.abortSwarm')}
                        </button>
                      )}
                    {experimentStatus === 'running' && swarmBranches.length === 0 && (
                      <button type="button" onClick={handleAbort} className={styles.dangerButton}>
                        {t('experiment.abort')}
                      </button>
                    )}
                    <button type="button" onClick={unsubscribeExperiment}>
                      {t('experiment.close')}
                    </button>
                  </div>
                </div>

                {/* ── P3 Swarm 看板 ─────────────────────────────── */}
                {swarmBranches.length > 0 && (
                  <div className={styles.swarmPanel}>
                    {/* Coordinator 状态行 */}
                    <div className={styles.swarmCoordinatorRow}>
                      <span className={styles.swarmCoordinatorLabel}>
                        {t('experiment.coordinator')}
                      </span>
                      <span className={styles.swarmCoordinatorStatus}>
                        {swarmStatus === 'decomposing' && t('experiment.swarmDecomposing')}
                        {swarmStatus === 'running' &&
                          t('experiment.swarmRunning', { count: swarmBranches.length })}
                        {swarmStatus === 'synthesizing' && t('experiment.swarmSynthesizing')}
                        {swarmStatus === 'completed' && t('experiment.swarmCompleted')}
                        {swarmStatus === 'failed' && t('experiment.swarmFailed')}
                      </span>
                    </div>

                    {/* 假说列表（Decompose 阶段展示） */}
                    {swarmHypotheses.length > 0 && swarmStatus === 'decomposing' && (
                      <div className={styles.swarmHypotheses}>
                        {swarmHypotheses.map((h) => (
                          <div key={h.id} className={styles.swarmHypothesisItem}>
                            <span className={styles.swarmHypothesisId}>
                              {t('experiment.branchId', { id: h.id })}
                            </span>
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
                        <span className={styles.swarmReasoningLabel}>
                          {t('experiment.selectionReason')}
                        </span>
                        <p>{swarmReasoning}</p>
                      </div>
                    )}
                  </div>
                )}
                {/* KPI Cards */}
                <div className={styles.metricsBar}>
                  <div className={styles.metricCard}>
                    <label>{t('experiment.bestMetric')}</label>
                    <div className={styles.metricValue}>
                      {bestMetric !== null ? Number(bestMetric).toFixed(4) : '--'}
                    </div>
                  </div>
                  <div className={styles.metricCard}>
                    <label>{t('experiment.trials')}</label>
                    <div className={styles.metricValue}>{trialCount}</div>
                  </div>
                  <div className={styles.metricCard}>
                    <label>{t('experiment.accepted')}</label>
                    <div className={styles.metricValue}>
                      {trialCount > 0
                        ? `${acceptedCount} (${Math.round((acceptedCount / trialCount) * 100)}%)`
                        : '--'}
                    </div>
                  </div>
                </div>

                {/* ── Metric Chart ── */}
                <div className={styles.chartWrapper}>
                  <div className={styles.chartTitle}>{t('experiment.metricProgression')}</div>
                  <MetricChart trialEvents={trialEvents} t={t} />
                </div>

                {/* Event Log */}
                {/* Fix #3: removed .reverse() + key={idx}.
                    Instead we iterate in original order and use CSS column-reverse
                    so the list appears newest-first without index shifting.
                    Key: use timestamp + subtype which is stable across re-renders. */}
                <div className={styles.eventsList}>
                  {experimentEvents.length === 0 && (
                    <div className={styles.eventsEmpty}>{t('experiment.waitingEvents')}</div>
                  )}
                  {experimentEvents.map((evt) => (
                    <div
                      key={`${evt.timestamp}-${evt.subtype}-${evt.content?.trialNumber ?? evt.content?.metric ?? ''}`}
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
                          t('experiment.evtTrialComplete', {
                            n: evt.content?.trialNumber,
                            metric: evt.content?.metric ?? t('experiment.metricFailed'),
                            verdict: evt.content?.accepted
                              ? t('common.accepted')
                              : t('common.rejected'),
                          })}
                        {evt.subtype === 'trial_rejected' &&
                          t('experiment.evtTrialRejected', {
                            n: evt.content?.trialNumber,
                            reason: evt.content?.reason ?? '',
                          })}
                        {evt.subtype === 'trial_accepted' &&
                          t('experiment.evtTrialAccepted', {
                            n: evt.content?.trialNumber,
                            pct: evt.content?.improvement?.toFixed(2) ?? '?',
                          })}
                        {evt.subtype === 'baseline' &&
                          t('experiment.evtBaseline', { metric: evt.content?.metric })}
                        {evt.subtype === 'experiment_start' &&
                          t('experiment.evtExperimentStart', {
                            max: evt.content?.maxExperiments,
                          })}
                        {evt.subtype === 'experiment_done' &&
                          t('experiment.evtExperimentDone', {
                            trials: evt.content?.totalTrials,
                            best: evt.content?.bestMetric,
                          })}
                        {evt.subtype === 'budget_exhausted' &&
                          t('experiment.evtBudget', { reason: evt.content?.reason ?? '' })}
                        {evt.subtype === 'experiment_error' &&
                          t('experiment.evtError', { error: evt.content?.error ?? '' })}
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
            <div>{t('experiment.emptySelect')}</div>
          </div>
        )}
      </div>
    </div>
  );
}
