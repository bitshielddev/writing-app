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

  consumerId(senderId: number) {
    return this.consumers.get(senderId)?.consumerId;
  }

  beginHydration(senderId: number, restart = false) {
    const consumer = this.require(senderId);
    consumer.live = false;
    if (restart) {
      consumer.buffer = [];
      consumer.overflowed = false;
    }
  }

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

  remove(senderId: number) {
    this.consumers.delete(senderId);
  }

  private require(senderId: number) {
    const consumer = this.consumers.get(senderId);
    if (!consumer) throw new Error("Renderer must subscribe before hydration or event access");
    return consumer;
  }
}
