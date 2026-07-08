import { Type } from "typebox";

import { identifier, operation, revision, strict, type OperationName } from "../base";
import { AgentRuntimeSchema } from "../events";
import { documentScope, healthResult, noParams } from "./common";

const agentStartParams = Type.Object(
  { projectId: identifier, documentId: identifier, projectRevision: revision, documentRevision: revision },
  strict,
);

export const AgentOperations = {
  "health.ping": operation(noParams, healthResult),
  "agent.start": operation(agentStartParams, AgentRuntimeSchema),
  "agent.stop": operation(documentScope, AgentRuntimeSchema),
} as const;

export const AGENT_RPC_METHODS = Object.keys(AgentOperations) as OperationName<typeof AgentOperations>[];
export type AgentRpcMethod = OperationName<typeof AgentOperations>;
