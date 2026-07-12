import { describe, expect, it, vi } from "vitest";

import type { DurableEventEnvelope } from "../../contracts/desktop-bridge";
import { createDocumentSaveReceipt } from "../../test/desktopBridgeHarness";
import { DurableEventBroker } from "./durable-event-broker";

/**
 * What: performs the envelope step for this file's workflow.
 *
 * Why: the test needs a focused helper so assertions stay about the behavior under test.
 * Called when: used by durable-event-broker when that path needs this behavior.
 */
function envelope(sequence: number): DurableEventEnvelope {
  return { eventId: `event-${sequence}`, streamId: "document:default-document",
    sequence, occurredAt: sequence, payload: { type: "document.saved",
      ...createDocumentSaveReceipt({ documentRevision: sequence, projectRevision: sequence }) } };
}

describe("main durable event broker", () => {
  it("assigns a new consumer identity when the same web contents reloads", () => {
    let nextId = 0;
    const broker = new DurableEventBroker("events", () => `consumer-${++nextId}`);
    const sender = { id: 1, send: vi.fn() };
    expect(broker.subscribe(sender)).toBe("consumer-1");
    expect(broker.subscribe(sender)).toBe("consumer-2");
    expect(broker.consumerId(1)).toBe("consumer-2");
  });

  it("buffers subscription events through hydration and discards snapshot-covered duplicates", () => {
    const send = vi.fn();
    const broker = new DurableEventBroker("events", () => "consumer", 4);
    broker.subscribe({ id: 1, send });
    broker.publish(envelope(1));
    broker.publish(envelope(2));

    expect(broker.completeHydration(1, "document:default-document", 1)).toBe(true);
    expect(send).toHaveBeenCalledWith("events", envelope(2));
    broker.publish(envelope(3));
    expect(send).toHaveBeenLastCalledWith("events", envelope(3));
  });

  it("forces a new snapshot after bounded hydration buffer overflow", () => {
    const send = vi.fn();
    const broker = new DurableEventBroker("events", () => "consumer", 1);
    broker.subscribe({ id: 1, send });
    broker.publish(envelope(1));
    broker.publish(envelope(2));
    expect(broker.completeHydration(1, "document:default-document", 0)).toBe(false);

    broker.beginHydration(1, true);
    broker.publish(envelope(3));
    expect(broker.completeHydration(1, "document:default-document", 2)).toBe(true);
    expect(send).toHaveBeenCalledWith("events", envelope(3));
  });
});
