import { describe, expect, it, vi } from "vitest";

import type { DesktopBridge, DurableEventEnvelope } from "../shared/desktop";
import { deferred, createDocumentSnapshot, createWorkspaceSnapshot } from "../test/desktopBridgeHarness";
import { DurableEventCoordinator } from "./durableEventCoordinator";

const streamId = "document:default-document";

function event(sequence: number): DurableEventEnvelope {
  return {
    eventId: `event-${sequence}`,
    streamId,
    sequence,
    occurredAt: sequence,
    payload: {
      type: "document.saved",
      document: createDocumentSnapshot({ revision: sequence }),
      projectRevision: sequence,
    },
  };
}

function bridge(overrides: Partial<DesktopBridge> = {}): DesktopBridge {
  return {
    hydrate: vi.fn().mockResolvedValue(createWorkspaceSnapshot()),
    replayEvents: vi.fn().mockResolvedValue({ streamId, events: [], headSequence: 0,
      hasMore: false, historyAvailable: true }),
    acknowledgeEvents: vi.fn(async ({ sequence }) => ({ streamId, acknowledgedSequence: sequence })),
    startAgent: vi.fn(), stopAgent: vi.fn(), saveDocument: vi.fn(),
    executeSuggestionCommand: vi.fn(), importSource: vi.fn(), subscribe: vi.fn(() => () => undefined),
    ...overrides,
  } as DesktopBridge;
}

describe("durable renderer event coordination", () => {
  it("hands off hydration events once and acknowledges duplicate delivery", async () => {
    const hydration = deferred<ReturnType<typeof createWorkspaceSnapshot>>();
    const desktop = bridge({ hydrate: vi.fn(() => hydration.promise) });
    const applied: number[] = [];
    const coordinator = new DurableEventCoordinator({ desktop, installSnapshot: vi.fn(),
      applyEvent: (item) => {
        if (item.type === "document.saved") applied.push(item.document.revision);
      } });

    const pending = coordinator.hydrate();
    coordinator.receive(event(1));
    hydration.resolve(createWorkspaceSnapshot({ coveredThroughSequence: 0 }));
    await pending;
    coordinator.receive(event(1));

    await vi.waitFor(() => expect(desktop.acknowledgeEvents).toHaveBeenLastCalledWith({ streamId, sequence: 1 }));
    expect(applied).toEqual([1]);
  });

  it("replays a gap across pages before resuming queued live delivery", async () => {
    const replay = vi.fn()
      .mockResolvedValueOnce({ streamId, events: [event(1), event(2)], headSequence: 4,
        hasMore: true, historyAvailable: true })
      .mockResolvedValueOnce({ streamId, events: [event(3), event(4)], headSequence: 4,
        hasMore: false, historyAvailable: true });
    const desktop = bridge({ replayEvents: replay });
    const applied: number[] = [];
    const coordinator = new DurableEventCoordinator({ desktop, installSnapshot: vi.fn(),
      applyEvent: (item) => {
        if (item.type === "document.saved") applied.push(item.document.revision);
      } });
    await coordinator.hydrate();

    coordinator.receive(event(4));

    await vi.waitFor(() => expect(applied).toEqual([1, 2, 3, 4]));
    expect(replay).toHaveBeenCalledTimes(2);
    expect(desktop.acknowledgeEvents).toHaveBeenLastCalledWith({ streamId, sequence: 4 });
  });

  it("installs a fresh snapshot when replay history is unavailable", async () => {
    const hydrate = vi.fn()
      .mockResolvedValueOnce(createWorkspaceSnapshot({ coveredThroughSequence: 0 }))
      .mockResolvedValueOnce(createWorkspaceSnapshot({ coveredThroughSequence: 3,
        document: createDocumentSnapshot({ revision: 3 }) }));
    const desktop = bridge({ hydrate, replayEvents: vi.fn().mockResolvedValue({
      streamId, events: [], headSequence: 3, hasMore: false, historyAvailable: false,
    }) });
    const installSnapshot = vi.fn();
    const coordinator = new DurableEventCoordinator({ desktop, installSnapshot, applyEvent: vi.fn() });
    await coordinator.hydrate();
    coordinator.receive(event(3));

    await vi.waitFor(() => expect(installSnapshot).toHaveBeenCalledTimes(2));
    expect(hydrate).toHaveBeenCalledTimes(2);
  });

  it("never acknowledges an event whose application failed", async () => {
    const desktop = bridge();
    const coordinator = new DurableEventCoordinator({ desktop, installSnapshot: vi.fn(),
      applyEvent: () => { throw new Error("reducer failed"); }, onError: vi.fn() });
    await coordinator.hydrate();
    coordinator.receive(event(1));

    await vi.waitFor(() => expect(desktop.acknowledgeEvents).toHaveBeenCalled());
    expect(vi.mocked(desktop.acknowledgeEvents!).mock.calls.map(([value]) => value.sequence))
      .toEqual([0]);
  });

  it("keeps ephemeral activity outside replay and acknowledgement", async () => {
    const desktop = bridge();
    const applyEvent = vi.fn();
    const coordinator = new DurableEventCoordinator({ desktop, installSnapshot: vi.fn(), applyEvent });
    await coordinator.hydrate();
    coordinator.receive({ type: "agent.runtime", runtime: { status: "waiting", cycleCount: 1 } });

    await vi.waitFor(() => expect(applyEvent).toHaveBeenCalledOnce());
    expect(desktop.replayEvents).not.toHaveBeenCalled();
    expect(desktop.acknowledgeEvents).toHaveBeenCalledTimes(1);
  });
});
