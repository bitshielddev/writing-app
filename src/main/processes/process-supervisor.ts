export type ProcessHealth =
  | { state: "starting" }
  | { state: "healthy"; since: number }
  | { state: "degraded"; reason: string }
  | { state: "restarting"; attempt: number; nextAttemptAt: number }
  | { state: "failed"; reason: string };

export const RESTART_DELAYS_MS = [500, 2_000, 5_000] as const;
export const RESTART_WINDOW_MS = 5 * 60_000;
export const HEALTHY_RESET_MS = 5 * 60_000;

export type SupervisedProcess = {
  ready: Promise<void>;
  kill(): void;
};

export type ProcessSupervisorOptions<Process extends SupervisedProcess> = {
  spawn: () => Process;
  validate?: (process: Process) => Promise<void>;
  recover?: (process: Process) => Promise<void>;
  now?: () => number;
  delay?: (milliseconds: number) => Promise<void>;
  onHealth?: (health: ProcessHealth) => void;
  classifyRetryable?: (error: unknown) => boolean;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** Bounded utility-process lifecycle. The owner reports exits through `processFailed`. */
export class ProcessSupervisor<Process extends SupervisedProcess> {
  private process?: Process;
  private attempts: number[] = [];
  private cycle?: Promise<Process>;
  private healthySince?: number;
  private stopped = false;
  private currentHealth: ProcessHealth = { state: "starting" };

  constructor(private readonly options: ProcessSupervisorOptions<Process>) {}

  get health() { return this.currentHealth; }
  get current() { return this.process; }

  start() {
    this.stopped = false;
    return this.beginCycle(false);
  }

  processFailed(error: unknown) {
    if (this.stopped) return Promise.reject(error);
    this.publish({ state: "degraded", reason: errorMessage(error) });
    return this.beginCycle(false, error);
  }

  retry() {
    this.attempts = [];
    this.healthySince = undefined;
    this.stopped = false;
    return this.beginCycle(true);
  }

  stop() {
    this.stopped = true;
    this.process?.kill();
    this.process = undefined;
  }

  private beginCycle(manual: boolean, initialError?: unknown): Promise<Process> {
    if (this.cycle) return this.cycle;
    this.cycle = this.runCycle(manual, initialError).finally(() => { this.cycle = undefined; });
    return this.cycle;
  }

  private async runCycle(manual: boolean, initialError?: unknown) {
    let error = initialError;
    while (!this.stopped) {
      const { restarting, attempt, now } = this.prepareAttempt(error, manual);
      if (restarting) {
        const wait = RESTART_DELAYS_MS[this.attempts.length];
        this.publish({ state: "restarting", attempt, nextAttemptAt: now + wait });
        await (this.options.delay?.(wait) ?? new Promise((resolve) => setTimeout(resolve, wait)));
      } else {
        this.publish({ state: "starting" });
      }
      if (restarting) this.attempts.push(this.options.now?.() ?? Date.now());
      try {
        this.process?.kill();
        const process = this.options.spawn();
        this.process = process;
        await process.ready;
        await this.options.validate?.(process);
        await this.options.recover?.(process);
        const since = this.options.now?.() ?? Date.now();
        this.healthySince = since;
        this.publish({ state: "healthy", since });
        return process;
      } catch (cause) {
        error = cause;
        this.process?.kill();
        this.process = undefined;
        this.publish({ state: "degraded", reason: errorMessage(cause) });
      }
    }
    throw new Error("Process supervisor stopped");
  }

  private prepareAttempt(error: unknown, manual: boolean) {
    const now = this.options.now?.() ?? Date.now();
    if (this.healthySince !== undefined && now - this.healthySince >= HEALTHY_RESET_MS) this.attempts = [];
    this.attempts = this.attempts.filter((time) => now - time < RESTART_WINDOW_MS);
    if (error && this.options.classifyRetryable?.(error) === false) {
      this.publish({ state: "failed", reason: errorMessage(error) });
      throw error;
    }
    if (this.attempts.length >= RESTART_DELAYS_MS.length) {
      const reason = error ? errorMessage(error) : "Automatic restart limit reached";
      this.publish({ state: "failed", reason });
      throw error instanceof Error ? error : new Error(reason);
    }
    return { restarting: Boolean(error || manual), attempt: this.attempts.length + 1, now };
  }

  private publish(health: ProcessHealth) {
    this.currentHealth = health;
    this.options.onHealth?.(health);
  }
}
