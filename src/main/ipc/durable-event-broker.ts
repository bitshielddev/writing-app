import type { DurableEventEnvelope } from "../../contracts/desktop-bridge.js";

type Sender = { id: number; send(channel: string, event: DurableEventEnvelope): void };
type Consumer = {
  consumerId: string;
  sender: Sender;
  live: boolean;
  overflowed: boolean;
  buffer: DurableEventEnvelope[];
};

/** Owns process-lifetime renderer identities and closes the subscribe/hydrate race. */
export class DurableEventBroker {
  private readonly consumers = new Map<number, Consumer>();

  constructor(
    private readonly channel: string,
    private readonly createId: () => string,
    private readonly maximumBufferedEvents = 256,
  ) {}

  /**
   * What: subscribes to events and returns the cleanup path.
   *
   * Why: Electron IPC needs a typed boundary between renderer calls and backend services.
   * Called when: used by registerIpc and durable-event-broker when that path needs this behavior.
   */
  subscribe(sender: Sender) {
    const consumerId = this.createId();
    this.consumers.set(sender.id, {
      consumerId,
      sender,
      live: false,
      overflowed: false,
      buffer: [],
    });
    return consumerId;
  }

  /**
   * What: performs the consumer id step for this file's workflow.
   *
   * Why: Electron IPC needs a typed boundary between renderer calls and backend services.
   * Called when: used by registerIpc and durable-event-broker when that path needs this behavior.
   */
  consumerId(senderId: number) {
    return this.consumers.get(senderId)?.consumerId;
  }

  /**
   * What: performs the begin hydration step for this file's workflow.
   *
   * Why: Electron IPC needs a typed boundary between renderer calls and backend services.
   * Called when: used by registerIpc and durable-event-broker when that path needs this behavior.
   */
  beginHydration(senderId: number, restart = false) {
    const consumer = this.require(senderId);
    consumer.live = false;
    if (restart) {
      consumer.buffer = [];
      consumer.overflowed = false;
    }
  }

  /**
   * What: performs the complete hydration step for this file's workflow.
   *
   * Why: Electron IPC needs a typed boundary between renderer calls and backend services.
   * Called when: used by registerIpc and durable-event-broker when that path needs this behavior.
   */
  completeHydration(senderId: number, streamId: string, coveredThroughSequence: number) {
    const consumer = this.require(senderId);
    if (consumer.overflowed) return false;
    const buffered = consumer.buffer
      .filter((event) => event.streamId !== streamId || event.sequence > coveredThroughSequence)
      .sort((left, right) => left.sequence - right.sequence);
    consumer.buffer = [];
    consumer.live = true;
    buffered.forEach((event) => consumer.sender.send(this.channel, event));
    return true;
  }

  /**
   * What: performs the publish step for this file's workflow.
   *
   * Why: Electron IPC needs a typed boundary between renderer calls and backend services.
   * Called when: used by start and durable-event-broker when that path needs this behavior.
   */
  publish(event: DurableEventEnvelope) {
    for (const consumer of this.consumers.values()) {
      if (consumer.live) {
        consumer.sender.send(this.channel, event);
        continue;
      }
      if (consumer.overflowed) continue;
      if (consumer.buffer.length >= this.maximumBufferedEvents) {
        consumer.buffer = [];
        consumer.overflowed = true;
        continue;
      }
      consumer.buffer.push(event);
    }
  }

  /**
   * What: performs the remove step for this file's workflow.
   *
   * Why: Electron IPC needs a typed boundary between renderer calls and backend services.
   * Called when: used by createWindow when that path needs this behavior.
   */
  remove(senderId: number) {
    this.consumers.delete(senderId);
  }

  /**
   * What: performs the require step for this file's workflow.
   *
   * Why: Electron IPC needs a typed boundary between renderer calls and backend services.
   * Called when: used by beginHydration and completeHydration when that path needs this behavior.
   */
  private require(senderId: number) {
    const consumer = this.consumers.get(senderId);
    if (!consumer) throw new Error("Renderer must subscribe before hydration or event access");
    return consumer;
  }
}
