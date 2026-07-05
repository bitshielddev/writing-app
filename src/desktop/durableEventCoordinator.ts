import type {
  DesktopBridge,
  DesktopEvent,
  DesktopTransportEvent,
  DurableEventEnvelope,
  WorkspaceSnapshot,
} from "../shared/desktop";

type CoordinatorOptions = {
  desktop: DesktopBridge;
  installSnapshot(snapshot: WorkspaceSnapshot): void;
  applyEvent(event: DesktopEvent): void | Promise<void>;
  onError?(error: unknown): void;
};

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

  constructor(private readonly options: CoordinatorOptions) {}

  async hydrate() {
    if (this.options.desktop.subscribeEvents) {
      await this.options.desktop.subscribeEvents();
    }
    await this.installFreshSnapshot();
  }

  receive = (event: DesktopTransportEvent | DesktopEvent) => {
    if (this.stopped) return;
    if (!isDurable(event)) {
      void Promise.resolve(this.options.applyEvent(event)).catch(this.options.onError);
      return;
    }
    if (this.installed && event.streamId !== this.streamId) {
      this.schedule(() => this.installFreshSnapshot());
      return;
    }
    if (event.sequence <= this.appliedSequence) {
      this.schedule(() => this.acknowledge());
      return;
    }
    if (!this.queued.has(event.sequence)) this.queued.set(event.sequence, event);
    if (this.installed) this.schedule(() => this.drain());
  };

  stop() {
    this.stopped = true;
    this.queued.clear();
  }

  private schedule(operation: () => Promise<void>) {
    this.work = this.work.then(operation).catch((error) => {
      this.options.onError?.(error);
    });
  }

  private async installFreshSnapshot() {
    const snapshot = await this.options.desktop.hydrate();
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

  private async replayToHead() {
    if (!this.options.desktop.replayEvents || !this.streamId) return false;
    let hasMore = true;
    while (hasMore) {
      const result = await this.options.desktop.replayEvents({
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

  private async apply(event: DurableEventEnvelope) {
    await this.options.applyEvent(event.payload);
    this.appliedSequence = event.sequence;
    await this.acknowledge();
  }

  private async acknowledge() {
    if (!this.options.desktop.acknowledgeEvents || !this.streamId) return;
    await this.options.desktop.acknowledgeEvents({
      streamId: this.streamId,
      sequence: this.appliedSequence,
    });
  }
}
