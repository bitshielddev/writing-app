import type { AgentActivity } from "../../contracts/desktop-bridge.js";
import { safeActivityPayload } from "../../domain/activity/payload.js";

const MAX_ITEMS = 500;

export class ActivityRing {
  private items: AgentActivity[] = [];

  /**
   * What: performs the add step for this file's workflow.
   *
   * Why: the Electron shell needs centralized startup, routing, and runtime coordination.
   * Called when: used by activity and start when that path needs this behavior.
   */
  add(input: Omit<AgentActivity, "updatedAt" | "payload"> & { payload?: unknown }) {
    const activity: AgentActivity = {
      ...input,
      updatedAt: Date.now(),
      ...(input.payload === undefined ? {} : { payload: safeActivityPayload(input.payload) }),
    };
    const existing = this.items.findIndex((item) => item.id === activity.id);
    if (existing >= 0) {
      this.items[existing] = {
        ...this.items[existing],
        ...activity,
        timestamp: this.items[existing].timestamp,
      };
    } else {
      this.items.push(activity);
      if (this.items.length > MAX_ITEMS) this.items.splice(0, this.items.length - MAX_ITEMS);
    }
    return existing >= 0 ? this.items[existing] : this.items.at(-1)!;
  }

  /**
   * What: returns the current snapshot for callers that need a stable view of state.
   *
   * Why: the Electron shell needs centralized startup, routing, and runtime coordination.
   * Called when: used by activity and registerIpc when that path needs this behavior.
   */
  snapshot() {
    return this.items.map((item) => ({ ...item }));
  }
}
