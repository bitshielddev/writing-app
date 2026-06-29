import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createMockSuggestionPublisher,
  type MockSuggestionPublisher,
} from "../dev/mockSuggestions/mockSuggestionChannel";
import { createAgentContextSource } from "./contextSource";
import { createMockSuggestionFeed } from "./mockSuggestionFeed";
import type { SuggestionEvent, TextSuggestion } from "./types";

class FakeBroadcastChannel {
  static instances = new Set<FakeBroadcastChannel>();

  readonly name: string;
  readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();
  closed = false;

  constructor(name: string) {
    this.name = name;
    FakeBroadcastChannel.instances.add(this);
  }

  addEventListener(
    _type: string,
    listener: (event: MessageEvent<unknown>) => void,
  ) {
    this.listeners.add(listener);
  }

  removeEventListener(
    _type: string,
    listener: (event: MessageEvent<unknown>) => void,
  ) {
    this.listeners.delete(listener);
  }

  postMessage(data: unknown) {
    FakeBroadcastChannel.instances.forEach((instance) => {
      if (instance !== this && !instance.closed && instance.name === this.name) {
        instance.listeners.forEach((listener) =>
          listener({ data } as MessageEvent<unknown>),
        );
      }
    });
  }

  close() {
    this.closed = true;
    this.listeners.clear();
    FakeBroadcastChannel.instances.delete(this);
  }

  static reset() {
    FakeBroadcastChannel.instances.clear();
  }
}

const item: TextSuggestion = {
  id: "manual-suggestion",
  dedupeKey: "manual-suggestion",
  kind: "snippet",
  title: "Manually injected",
  summary: "A suggestion from the controller tab.",
  body: "This suggestion should pass through the mock feed unchanged.",
  insertText: "Injected preview text.",
  sourceLabels: ["Controller"],
  createdAt: 10,
};

describe("mock suggestion feed", () => {
  let publisher: MockSuggestionPublisher;

  beforeEach(() => {
    FakeBroadcastChannel.reset();
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    const createdPublisher = createMockSuggestionPublisher();
    if (!createdPublisher) {
      throw new Error("Expected the fake BroadcastChannel to be available");
    }
    publisher = createdPublisher;
  });

  afterEach(() => {
    publisher.close();
    vi.unstubAllGlobals();
  });

  it("emits manually injected suggestions without generating other events", async () => {
    const context = createAgentContextSource([
      { id: "source", title: "Source.pdf", kind: "pdf" },
    ]);
    const feed = createMockSuggestionFeed(context);
    const events: SuggestionEvent[] = [];
    const unsubscribe = feed.subscribe((event) => events.push(event));

    context.updateDocument([{ id: "p", type: "paragraph", text: "New text" }]);
    await feed.sendSteering("Emphasise trust");
    await feed.retry();
    expect(events).toEqual([]);

    publisher.publish(item);
    expect(events).toEqual([{ type: "suggestion.added", item }]);

    unsubscribe();
    publisher.publish({ ...item, id: "after-stop", dedupeKey: "after-stop" });
    expect(events).toHaveLength(1);
  });

  it("ignores malformed channel messages", () => {
    const context = createAgentContextSource([]);
    const feed = createMockSuggestionFeed(context);
    const events: SuggestionEvent[] = [];
    const unsubscribe = feed.subscribe((event) => events.push(event));
    const rogueChannel = new FakeBroadcastChannel(
      "scribe-mock-suggestion-injection",
    );

    rogueChannel.postMessage({ type: "suggestion.added", item: { title: "Bad" } });
    expect(events).toEqual([]);

    rogueChannel.close();
    unsubscribe();
  });
});
