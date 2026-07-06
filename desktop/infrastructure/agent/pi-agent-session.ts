import type { AgentSession } from "@earendil-works/pi-coding-agent";

import type {
  AgentActivityInput,
  AgentSessionPort,
} from "../../application/agent-session-port.js";
import { activitiesFromSessionEvent } from "./pi-activity.js";

export class PiAgentSessionAdapter implements AgentSessionPort {
  constructor(private readonly session: AgentSession) {}

  get id() {
    return this.session.sessionId;
  }

  get isBusy() {
    return this.session.isStreaming;
  }

  async prompt(instruction: string) {
    await this.session.prompt(instruction);
  }

  async abort() {
    await this.session.abort();
  }

  dispose() {
    this.session.dispose();
  }

  subscribeActivity(listener: (activity: AgentActivityInput) => void) {
    this.session.subscribe((event) => {
      activitiesFromSessionEvent(event).forEach(listener);
    });
  }
}
