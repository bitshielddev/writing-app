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

/**
 * What: performs the error message step for this file's workflow.
 *
 * Why: desktop child-process lifecycle and RPC behavior need one predictable implementation.
 * Called when: used by processFailed, runCycle and prepareAttempt when that path needs this behavior.
 */
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

  /**
   * What: starts the runtime task and wires the dependencies it needs.
   *
   * Why: desktop child-process lifecycle and RPC behavior need one predictable implementation.
   * Called when: used by switchDocumentAgent and process-supervisor when that path needs this behavior.
   */
  start() {
    this.stopped = false;
    return this.beginCycle(false);
  }

  /**
   * What: performs the process failed step for this file's workflow.
   *
   * Why: desktop child-process lifecycle and RPC behavior need one predictable implementation.
   * Called when: used by start and createAgentSupervisor when that path needs this behavior.
   */
  processFailed(error: unknown) {
    if (this.stopped) return Promise.reject(error);
    this.publish({ state: "degraded", reason: errorMessage(error) });
    return this.beginCycle(false, error);
  }

  /**
   * What: performs the retry step for this file's workflow.
   *
   * Why: desktop child-process lifecycle and RPC behavior need one predictable implementation.
   * Called when: used by start and process-supervisor when that path needs this behavior.
   */
  retry() {
    this.attempts = [];
    this.healthySince = undefined;
    this.stopped = false;
    return this.beginCycle(true);
  }

  /**
   * What: stops the runtime task and releases owned resources.
   *
   * Why: desktop child-process lifecycle and RPC behavior need one predictable implementation.
   * Called when: used by switchDocumentAgent when that path needs this behavior.
   */
  stop() {
    this.stopped = true;
    this.process?.kill();
    this.process = undefined;
  }

  /**
   * What: performs the begin cycle step for this file's workflow.
   *
   * Why: desktop child-process lifecycle and RPC behavior need one predictable implementation.
   * Called when: used by start, processFailed and retry when that path needs this behavior.
   */
  private beginCycle(manual: boolean, initialError?: unknown): Promise<Process> {
    if (this.cycle) return this.cycle;
    this.cycle = this.runCycle(manual, initialError).finally(() => { this.cycle = undefined; });
    return this.cycle;
  }

  /**
   * What: runs cycle as a complete operation.
   *
   * Why: desktop child-process lifecycle and RPC behavior need one predictable implementation.
   * Called when: used by beginCycle when that path needs this behavior.
   */
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

  /**
   * What: performs the prepare attempt step for this file's workflow.
   *
   * Why: desktop child-process lifecycle and RPC behavior need one predictable implementation.
   * Called when: used by runCycle when that path needs this behavior.
   */
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

  /**
   * What: performs the publish step for this file's workflow.
   *
   * Why: desktop child-process lifecycle and RPC behavior need one predictable implementation.
   * Called when: used by processFailed, runCycle and prepareAttempt when that path needs this behavior.
   */
  private publish(health: ProcessHealth) {
    this.currentHealth = health;
    this.options.onHealth?.(health);
  }
}
