import type {
  DesktopBridge,
  DesktopEvent,
  DesktopTransportEvent,
  DurableEventEnvelope,
  WorkspaceSnapshot,
} from "../../../contracts/desktop-bridge";

type CoordinatorOptions = {
  desktop: DesktopBridge;
  scope?: { projectId: string; documentId: string };
  installSnapshot(snapshot: WorkspaceSnapshot): void;
  applyEvent(event: DesktopEvent): void | Promise<void>;
  onError?(error: unknown): void;
};

/**
 * What: returns whether the supplied value matches durable.
 *
 * Why: renderer platform adapters need to isolate Electron and browser runtime details.
 * Called when: used by durableEventCoordinator when that path needs this behavior.
 */
function isDurable(event: DesktopTransportEvent | DesktopEvent): event is DurableEventEnvelope {
  return typeof event === "object" && event !== null && "payload" in event && "sequence" in event;
}

/** Ordered at-least-once consumer for the renderer's durable stream. */
export class DurableEventCoordinator {
  private streamId: string | undefined;
  private appliedSequence = 0;
  private installed = false;
  private stopped = false;
  private queued = new Map<number, DurableEventEnvelope>();
  private work: Promise<void> = Promise.resolve();
  private scope: { projectId: string; documentId: string } | undefined;

  constructor(private readonly options: CoordinatorOptions) {}

  /**
   * What: performs the hydrate step for this file's workflow.
   *
   * Why: renderer platform adapters need to isolate Electron and browser runtime details.
   * Called when: used by useWorkspaceHydration and durableEventCoordinator when that path needs this behavior.
   */
  async hydrate() {
    if (this.options.desktop.subscribeEvents) {
      await this.options.desktop.subscribeEvents();
    }
    await this.installFreshSnapshot();
  }

  /**
   * What: performs the receive step for this file's workflow.
   *
   * Why: renderer platform adapters need to isolate Electron and browser runtime details.
   * Called when: used by useWorkspaceHydration and durableEventCoordinator when that path needs this behavior.
   */
  receive = (event: DesktopTransportEvent | DesktopEvent) => {
    if (this.stopped) return;
    if (!isDurable(event)) {
      void Promise.resolve(this.options.applyEvent(event)).catch(this.options.onError);
      return;
    }
    if (this.installed && event.streamId !== this.streamId) {
      // A completion from a previous document session must never rehydrate or
      // mutate the current session.
      return;
    }
    if (event.sequence <= this.appliedSequence) {
      this.schedule(() => this.acknowledge());
      return;
    }
    if (!this.queued.has(event.sequence)) this.queued.set(event.sequence, event);
    if (this.installed) this.schedule(() => this.drain());
  };

  /**
   * What: stops the runtime task and releases owned resources.
   *
   * Why: renderer platform adapters need to isolate Electron and browser runtime details.
   * Called when: used by useWorkspaceHydration when that path needs this behavior.
   */
  stop() {
    this.stopped = true;
    this.queued.clear();
  }

  /**
   * What: performs the schedule step for this file's workflow.
   *
   * Why: renderer platform adapters need to isolate Electron and browser runtime details.
   * Called when: used by durableEventCoordinator when that path needs this behavior.
   */
  private schedule(operation: () => Promise<void>) {
    this.work = this.work.then(operation).catch((error) => {
      this.options.onError?.(error);
    });
  }

  /**
   * What: performs the install fresh snapshot step for this file's workflow.
   *
   * Why: renderer platform adapters need to isolate Electron and browser runtime details.
   * Called when: used by hydrate and drain when that path needs this behavior.
   */
  private async installFreshSnapshot() {
    const scope = this.options.scope ?? (this.options.desktop.getWorkspaceCatalog
      ? (await this.options.desktop.getWorkspaceCatalog()).selection
      : { projectId: "default-project", documentId: "default-document" });
    this.scope = scope;
    const snapshot = await this.options.desktop.hydrate(scope);
    if (this.stopped) return;
    this.options.installSnapshot(snapshot);
    this.streamId = snapshot.streamId;
    this.appliedSequence = snapshot.coveredThroughSequence;
    this.installed = true;
    for (const [sequence, event] of this.queued) {
      if (event.streamId !== this.streamId || sequence <= this.appliedSequence) {
        this.queued.delete(sequence);
      }
    }
    await this.acknowledge();
    await this.drain();
  }

  /**
   * What: performs the drain step for this file's workflow.
   *
   * Why: renderer platform adapters need to isolate Electron and browser runtime details.
   * Called when: used by durableEventCoordinator and installFreshSnapshot when that path needs this behavior.
   */
  private async drain() {
    if (!this.installed || !this.streamId || this.stopped) return;
    while (this.queued.size > 0) {
      const nextSequence = Math.min(...this.queued.keys());
      if (nextSequence <= this.appliedSequence) {
        this.queued.delete(nextSequence);
        continue;
      }
      if (nextSequence > this.appliedSequence + 1) {
        if (!await this.replayToHead()) {
          await this.installFreshSnapshot();
          return;
        }
        continue;
      }
      const event = this.queued.get(nextSequence)!;
      await this.apply(event);
      this.queued.delete(nextSequence);
    }
  }

  /**
   * What: performs the replay to head step for this file's workflow.
   *
   * Why: renderer platform adapters need to isolate Electron and browser runtime details.
   * Called when: used by drain when that path needs this behavior.
   */
  private async replayToHead() {
    if (!this.options.desktop.replayEvents || !this.streamId) return false;
    let hasMore = true;
    while (hasMore) {
      const result = await this.options.desktop.replayEvents({
        ...this.requiredScope(),
        streamId: this.streamId,
        afterSequence: this.appliedSequence,
        limit: 100,
      });
      if (!result.historyAvailable || result.streamId !== this.streamId) return false;
      if (result.events.length === 0) return this.appliedSequence === result.headSequence;
      for (const event of result.events) {
        if (event.streamId !== this.streamId || event.sequence !== this.appliedSequence + 1) return false;
        await this.apply(event);
        this.queued.delete(event.sequence);
      }
      hasMore = result.hasMore;
    }
    return true;
  }

  /**
   * What: performs the apply step for this file's workflow.
   *
   * Why: renderer platform adapters need to isolate Electron and browser runtime details.
   * Called when: used by drain and replayToHead when that path needs this behavior.
   */
  private async apply(event: DurableEventEnvelope) {
    await this.options.applyEvent(event.payload);
    this.appliedSequence = event.sequence;
    await this.acknowledge();
  }

  /**
   * What: performs the acknowledge step for this file's workflow.
   *
   * Why: renderer platform adapters need to isolate Electron and browser runtime details.
   * Called when: used by durableEventCoordinator, installFreshSnapshot and apply when that path needs this behavior.
   */
  private async acknowledge() {
    if (!this.options.desktop.acknowledgeEvents || !this.streamId) return;
    await this.options.desktop.acknowledgeEvents({
      ...this.requiredScope(),
      streamId: this.streamId,
      sequence: this.appliedSequence,
    });
  }

  /**
   * What: performs the required scope step for this file's workflow.
   *
   * Why: renderer platform adapters need to isolate Electron and browser runtime details.
   * Called when: used by replayToHead and acknowledge when that path needs this behavior.
   */
  private requiredScope() {
    if (!this.scope) throw new Error("Document session scope is unavailable");
    return this.scope;
  }
}
