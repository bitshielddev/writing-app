import type { DesktopEvent } from "../../src/shared/desktop.js";
import type { EventOutbox } from "./repositories.js";

export interface EventPublisher {
  publish(event: DesktopEvent): void | Promise<void>;
}

export class OutboxDispatcher {
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
      await this.publisher.publish(row.event);
      this.repository.markDispatched(row.sequence);
    }
  }
}
