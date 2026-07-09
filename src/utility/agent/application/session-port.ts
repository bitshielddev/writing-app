import type { AgentActivity } from "../../../contracts/desktop-bridge.js";

export type AgentActivityInput = Omit<AgentActivity, "updatedAt">;

export interface AgentSessionPort {
  readonly id: string;
  readonly isBusy: boolean;
  prompt(instruction: string): Promise<void>;
  abort(): Promise<void>;
  dispose(): void;
  subscribeActivity(listener: (activity: AgentActivityInput) => void): void;
}
