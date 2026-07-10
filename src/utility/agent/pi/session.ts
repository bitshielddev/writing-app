import type { AgentSession } from "@earendil-works/pi-coding-agent";

import type {
  AgentActivityInput,
  AgentSessionPort,
} from "../application/session-port.js";
import { activitiesFromSessionEvent } from "./activity.js";

export class PiAgentSessionAdapter implements AgentSessionPort {
  constructor(private readonly session: AgentSession) {}

  get id() {
    return this.session.sessionId;
  }

  get isBusy() {
    return this.session.isStreaming;
  }

  /**
   * What: performs the prompt step for this file's workflow.
   *
   * Why: agent workflows need coordinated runtime, storage, and activity reporting behavior.
   * Called when: used by session-port, drain and session when that path needs this behavior.
   */
  async prompt(instruction: string) {
    await this.session.prompt(instruction);
  }

  /**
   * What: performs the abort step for this file's workflow.
   *
   * Why: agent workflows need coordinated runtime, storage, and activity reporting behavior.
   * Called when: used by session-port, stopAgent and session when that path needs this behavior.
   */
  async abort() {
    await this.session.abort();
  }

  /**
   * What: performs the dispose step for this file's workflow.
   *
   * Why: agent workflows need coordinated runtime, storage, and activity reporting behavior.
   * Called when: used by session-port, index and session when that path needs this behavior.
   */
  dispose() {
    this.session.dispose();
  }

  /**
   * What: subscribes to activity and returns the cleanup path.
   *
   * Why: agent workflows need coordinated runtime, storage, and activity reporting behavior.
   * Called when: used by session-port, initialize and session when that path needs this behavior.
   */
  subscribeActivity(listener: (activity: AgentActivityInput) => void) {
    this.session.subscribe((event) => {
      activitiesFromSessionEvent(event).forEach(listener);
    });
  }
}
