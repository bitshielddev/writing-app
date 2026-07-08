import type { AgentActivity } from "../../contracts/desktop-bridge.js";
import { safeActivityPayload } from "../../domain/activity/payload.js";

const MAX_ITEMS = 500;

export class ActivityRing {
  private items: AgentActivity[] = [];

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

  snapshot() {
    return this.items.map((item) => ({ ...item }));
  }
}
