import type { AgentStatus } from "../src/shared/desktop.js";

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

export type PersistedScribeLoopState = Pick<
  ScribeLoopSnapshot,
  | "latestRevision"
  | "latestDocumentRevision"
  | "activeRevision"
  | "activeDocumentRevision"
  | "yieldedRevision"
  | "cycleCount"
  | "status"
>;

export class ScribeLoopState {
  private state: ScribeLoopSnapshot;
  private yieldedInCycle = false;

  constructor(restored?: Partial<PersistedScribeLoopState>) {
    this.state = {
      latestRevision: restored?.latestRevision ?? -1,
      latestDocumentRevision: restored?.latestDocumentRevision ?? -1,
      activeRevision: restored?.activeRevision,
      activeDocumentRevision: restored?.activeDocumentRevision,
      yieldedRevision: restored?.yieldedRevision,
      cycleCount: restored?.cycleCount ?? 0,
      status: restored?.status ?? "waiting",
    };
  }

  snapshot(): ScribeLoopSnapshot {
    return { ...this.state };
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
      this.state.status = "working";
    }
    return isNewWork;
  }

  beginCycle() {
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
    return {
      projectRevision: this.state.activeRevision,
      documentRevision: this.state.activeDocumentRevision,
      cycleCount: this.state.cycleCount,
    };
  }

  requestYield() {
    if (this.state.activeRevision === undefined) return false;
    if (this.state.latestRevision > this.state.activeRevision) return false;
    this.state.yieldedRevision = this.state.activeRevision;
    this.yieldedInCycle = true;
    return true;
  }

  finishCycle() {
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
      status: this.state.status,
    };
  }
}
