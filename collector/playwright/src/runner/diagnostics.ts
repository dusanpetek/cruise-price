export interface DiagnosticStep {
  name: string;
  startedAt: string;
  durationMs: number;
  ok: boolean;
  error?: string;
}

export interface FailureEvidence {
  id: string;
  screenshot?: string;
  html?: string;
  log: string;
}

export interface CollectionDiagnostics {
  routeId: string;
  provider: string | null;
  url: string;
  startedAt: string;
  durationMs: number;
  status: 'success' | 'failed';
  error?: string;
  steps: DiagnosticStep[];
  /** Paths of the saved screenshot / HTML dump / log when the run failed. */
  failure?: FailureEvidence;
}

/** Records timed steps so a failed run can be explained after the fact. */
export class Diagnostics {
  readonly steps: DiagnosticStep[] = [];

  async step<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const startedAt = new Date();
    const t0 = performance.now();
    try {
      const result = await fn();
      this.steps.push({ name, startedAt: startedAt.toISOString(), durationMs: performance.now() - t0, ok: true });
      return result;
    } catch (e) {
      this.steps.push({
        name,
        startedAt: startedAt.toISOString(),
        durationMs: performance.now() - t0,
        ok: false,
        error: (e as Error).message,
      });
      throw e;
    }
  }
}
