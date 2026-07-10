import type { AgentStatus } from "../../../contracts/desktop-bridge.js";
import { Type, type Static } from "typebox";
import { AgentStatusSchema } from "../../../contracts/events.js";

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

  /**
   * What: returns the current snapshot for callers that need a stable view of state.
   *
   * Why: agent workflows need coordinated runtime, storage, and activity reporting behavior.
   * Called when: used by loop, executeSuggestionMutation, runtime and reportLoopPause when that path needs this behavior.
   */
  snapshot(): ScribeLoopSnapshot {
    return { ...this.state };
  }

  /**
   * What: returns whether the supplied value matches enabled.
   *
   * Why: agent workflows need coordinated runtime, storage, and activity reporting behavior.
   * Called when: used by canDrain, scheduleWorkingCycle and drain when that path needs this behavior.
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * What: starts the runtime task and wires the dependencies it needs.
   *
   * Why: agent workflows need coordinated runtime, storage, and activity reporting behavior.
   * Called when: used by loop, extension and startAgent when that path needs this behavior.
   */
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

  /**
   * What: stops the runtime task and releases owned resources.
   *
   * Why: agent workflows need coordinated runtime, storage, and activity reporting behavior.
   * Called when: used by loop and stopAgent when that path needs this behavior.
   */
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

  /**
   * What: performs the revision step for this file's workflow.
   *
   * Why: agent workflows need coordinated runtime, storage, and activity reporting behavior.
   * Called when: used by loop, createScribeExtension, extension and startAgent when that path needs this behavior.
   */
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

  /**
   * What: performs the begin cycle step for this file's workflow.
   *
   * Why: agent workflows need coordinated runtime, storage, and activity reporting behavior.
   * Called when: used by loop, extension and drain when that path needs this behavior.
   */
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

  /**
   * What: performs the request yield step for this file's workflow.
   *
   * Why: agent workflows need coordinated runtime, storage, and activity reporting behavior.
   * Called when: used by loop and createScribeExtension when that path needs this behavior.
   */
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

  /**
   * What: performs the finish cycle step for this file's workflow.
   *
   * Why: agent workflows need coordinated runtime, storage, and activity reporting behavior.
   * Called when: used by loop and drain when that path needs this behavior.
   */
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

  /**
   * What: performs the fail step for this file's workflow.
   *
   * Why: agent workflows need coordinated runtime, storage, and activity reporting behavior.
   * Called when: used by loop and drain when that path needs this behavior.
   */
  fail(error: string) {
    this.cycleInProgress = false;
    if (!this.enabled) return;
    this.state.status = "error";
    this.state.error = error;
  }

  /**
   * What: performs the persisted step for this file's workflow.
   *
   * Why: agent workflows need coordinated runtime, storage, and activity reporting behavior.
   * Called when: used by loop and encodeScribeLoopEntry when that path needs this behavior.
   */
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
