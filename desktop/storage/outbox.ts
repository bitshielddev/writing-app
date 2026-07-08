import type { DurableEventEnvelope } from "../../src/contracts/desktop-bridge.js";
import type { EventDispatcher, EventOutbox } from "../application/storage-ports.js";

export interface EventPublisher {
  publish(event: DurableEventEnvelope): void | Promise<void>;
}

export class OutboxDispatcher implements EventDispatcher {
  private activeDispatch: Promise<void> = Promise.resolve();

  constructor(
    private readonly repository: EventOutbox,
    private readonly publisher: EventPublisher,
  ) {}

  dispatch() {
    const dispatch = this.activeDispatch.then(() => this.deliverPending());
    this.activeDispatch = dispatch.catch(() => undefined);
    return dispatch;
  }

  private async deliverPending() {
    for (const row of this.repository.pending()) {
      await this.publisher.publish(row);
      this.repository.markDispatched(row.eventId);
    }
  }
}
