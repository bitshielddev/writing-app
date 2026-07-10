import type { DurableEventEnvelope } from "../../../contracts/desktop-bridge.js";
import type { EventDispatcher, EventOutbox } from "../application/ports.js";

export interface EventPublisher {
  publish(event: DurableEventEnvelope): void | Promise<void>;
}

export class OutboxDispatcher implements EventDispatcher {
  private activeDispatch: Promise<void> = Promise.resolve();

  constructor(
    private readonly repository: EventOutbox,
    private readonly publisher: EventPublisher,
  ) {}

  /**
   * What: performs the dispatch step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by ports, performDocumentSave, importSource and executeSuggestionCommand when that path needs this behavior.
   */
  dispatch() {
    const dispatch = this.activeDispatch.then(() => this.deliverPending());
    this.activeDispatch = dispatch.catch(() => undefined);
    return dispatch;
  }

  /**
   * What: performs the deliver pending step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by dispatch when that path needs this behavior.
   */
  private async deliverPending() {
    for (const row of this.repository.pending()) {
      await this.publisher.publish(row);
      this.repository.markDispatched(row.eventId);
    }
  }
}
