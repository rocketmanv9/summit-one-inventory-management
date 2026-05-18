/**
 * Friction Metrics — Tracks flow interaction counts for data-driven optimization.
 * Client-side only; no server persistence (yet).
 */

export interface FlowMetric {
  intent: string;
  startedAt: number;
  completedAt?: number;
  questionsAsked: number;
  correctionsDetected: number;
  autoFilledFields: number;
  totalFields: number;
  outcome: 'completed' | 'cancelled' | 'failed';
  wasAutoExecuted: boolean;
}

const metrics: FlowMetric[] = [];

export function startFlowMetric(intent: string, totalFields: number): FlowMetric {
  const m: FlowMetric = {
    intent,
    startedAt: Date.now(),
    questionsAsked: 0,
    correctionsDetected: 0,
    autoFilledFields: 0,
    totalFields,
    outcome: 'completed',
    wasAutoExecuted: false,
  };
  metrics.push(m);
  return m;
}

export function recordQuestion(m: FlowMetric): void {
  m.questionsAsked++;
}

export function recordAutoFill(m: FlowMetric): void {
  m.autoFilledFields++;
}

export function recordCorrection(m: FlowMetric): void {
  m.correctionsDetected++;
}

export function completeMetric(m: FlowMetric, outcome: FlowMetric['outcome']): void {
  m.completedAt = Date.now();
  m.outcome = outcome;
}

export function getMetrics(): FlowMetric[] {
  return [...metrics];
}

export function getMetricsSummary() {
  const completed = metrics.filter((m) => m.outcome === 'completed');
  return {
    totalFlows: metrics.length,
    completedFlows: completed.length,
    cancelRate: metrics.length
      ? metrics.filter((m) => m.outcome === 'cancelled').length / metrics.length
      : 0,
    avgQuestions: completed.length
      ? completed.reduce((s, m) => s + m.questionsAsked, 0) / completed.length
      : 0,
    autoExecRate: metrics.length
      ? metrics.filter((m) => m.wasAutoExecuted).length / metrics.length
      : 0,
    avgTimeMs: completed.length
      ? completed.reduce((s, m) => s + ((m.completedAt || m.startedAt) - m.startedAt), 0) /
        completed.length
      : 0,
  };
}

/**
 * Flush accumulated friction metrics to the server.
 * POSTs to /api/ai/usage with friction_metrics in the body.
 * Clears the local metrics array after successful flush.
 */
export async function flushMetrics(baseUrl?: string): Promise<void> {
  if (metrics.length === 0) return;

  const summary = getMetricsSummary();
  const payload = {
    friction_metrics: {
      summary,
      flows: metrics.map((m) => ({
        intent: m.intent,
        outcome: m.outcome,
        questionsAsked: m.questionsAsked,
        correctionsDetected: m.correctionsDetected,
        autoFilledFields: m.autoFilledFields,
        totalFields: m.totalFields,
        wasAutoExecuted: m.wasAutoExecuted,
        durationMs: m.completedAt ? m.completedAt - m.startedAt : null,
      })),
    },
  };

  try {
    const url = `${baseUrl || ''}/api/ai/usage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      metrics.length = 0; // Clear after successful flush
    }
  } catch {
    // Flush is non-critical — metrics will accumulate and retry on next flush
  }
}
