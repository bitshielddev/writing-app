import type { AgentStatus } from "../src/shared/desktop.js";
import { Type, type Static } from "typebox";
import { AgentStatusSchema } from "../src/shared/contracts.js";

export type ScribeLoopSnapshot = {
  latestRevision: number;
  latestDocumentRevision: number;
  activeRevision?: number;
  activeDocumentRevision?: number;
  yieldedRevision?: number;
  cycleCount: number;
  status: AgentStatus;
  error?: string;
};

const loopRevision = Type.Integer({ minimum: -1 });
export const PersistedScribeLoopStateSchema = Type.Object({
  latestRevision: loopRevision,
  latestDocumentRevision: loopRevision,
  activeRevision: Type.Optional(loopRevision),
  activeDocumentRevision: Type.Optional(loopRevision),
  yieldedRevision: Type.Optional(loopRevision),
  cycleCount: Type.Integer({ minimum: 0, maximum: 5 }),
  status: AgentStatusSchema,
}, { additionalProperties: false });
export type PersistedScribeLoopState = Static<typeof PersistedScribeLoopStateSchema>;

export class ScribeLoopState {
  private state: ScribeLoopSnapshot;
  private yieldedInCycle = false;
  private enabled = false;
  private cycleInProgress = false;

  constructor(restored?: Partial<PersistedScribeLoopState>) {
    this.state = {
      latestRevision: restored?.latestRevision ?? -1,
      latestDocumentRevision: restored?.latestDocumentRevision ?? -1,
      activeRevision: undefined,
      activeDocumentRevision: undefined,
      yieldedRevision: restored?.yieldedRevision,
      cycleCount: restored?.cycleCount ?? 0,
      status: "stopped",
    };
  }

  snapshot(): ScribeLoopSnapshot {
    return { ...this.state };
  }

  isEnabled() {
    return this.enabled;
  }

  start() {
    if (this.enabled) return false;
    this.enabled = true;
    this.cycleInProgress = false;
    this.state.activeRevision = undefined;
    this.state.activeDocumentRevision = undefined;
    this.state.cycleCount = 0;
    this.state.error = undefined;
    this.state.status =
      this.state.latestRevision > (this.state.yieldedRevision ?? -1)
        ? "working"
        : "waiting";
    return true;
  }

  stop() {
    if (!this.enabled) return false;
    this.enabled = false;
    if (this.cycleInProgress) {
      this.state.cycleCount = Math.max(0, this.state.cycleCount - 1);
    }
    this.cycleInProgress = false;
    this.yieldedInCycle = false;
    this.state.activeRevision = undefined;
    this.state.activeDocumentRevision = undefined;
    this.state.error = undefined;
    this.state.status = "stopped";
    return true;
  }

  revision(projectRevision: number, documentRevision: number) {
    if (projectRevision < this.state.latestRevision) return false;
    if (projectRevision === this.state.latestRevision) {
      return this.state.status === "working";
    }
    const isNewWork = projectRevision > (this.state.yieldedRevision ?? -1);
    this.state.latestRevision = projectRevision;
    this.state.latestDocumentRevision = documentRevision;
    if (isNewWork) {
      this.state.cycleCount = 0;
      this.state.error = undefined;
      this.yieldedInCycle = false;
      this.state.status = this.enabled ? "working" : "stopped";
    }
    return isNewWork;
  }

  beginCycle() {
    if (!this.enabled) return undefined;
    if (this.state.latestRevision < 0) return undefined;
    if (this.state.latestRevision <= (this.state.yieldedRevision ?? -1)) {
      this.state.status = "waiting";
      return undefined;
    }
    if (this.state.cycleCount >= 5) {
      this.state.status = "capped";
      return undefined;
    }
    this.state.activeRevision = this.state.latestRevision;
    this.state.activeDocumentRevision = this.state.latestDocumentRevision;
    this.state.cycleCount += 1;
    this.state.status = "working";
    this.yieldedInCycle = false;
    this.cycleInProgress = true;
    return {
      projectRevision: this.state.activeRevision,
      documentRevision: this.state.activeDocumentRevision,
      cycleCount: this.state.cycleCount,
    };
  }

  requestYield() {
    if (
      !this.enabled ||
      !this.cycleInProgress ||
      this.state.activeRevision === undefined
    ) {
      return false;
    }
    if (this.state.latestRevision > this.state.activeRevision) return false;
    this.state.yieldedRevision = this.state.activeRevision;
    this.yieldedInCycle = true;
    return true;
  }

  finishCycle() {
    if (!this.enabled || !this.cycleInProgress) return false;
    this.cycleInProgress = false;
    if (
      this.yieldedInCycle &&
      this.state.activeRevision === this.state.latestRevision
    ) {
      this.state.status = "waiting";
      return false;
    }
    if (this.state.latestRevision > (this.state.activeRevision ?? -1)) {
      this.state.cycleCount = 0;
      this.state.status = "working";
      return true;
    }
    if (this.state.cycleCount >= 5) {
      this.state.status = "capped";
      return false;
    }
    this.state.status = "working";
    return true;
  }

  fail(error: string) {
    this.cycleInProgress = false;
    if (!this.enabled) return;
    this.state.status = "error";
    this.state.error = error;
  }

  persisted(): PersistedScribeLoopState {
    return {
      yieldedRevision: this.state.yieldedRevision,
      latestRevision: this.state.latestRevision,
      latestDocumentRevision: this.state.latestDocumentRevision,
      activeRevision: this.state.activeRevision,
      activeDocumentRevision: this.state.activeDocumentRevision,
      cycleCount: this.state.cycleCount,
      status:
        this.state.status === "stopped"
          ? this.state.latestRevision > (this.state.yieldedRevision ?? -1)
            ? "working"
            : "waiting"
          : this.state.status,
    };
  }
}
