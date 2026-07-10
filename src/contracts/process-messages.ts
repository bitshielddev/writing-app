import { Type, type Static } from "typebox";

import {
  AGENT_PROTOCOL_NAME,
  ContractErrorSchema,
  identifier,
  ProtocolVersionSchema,
  revision,
  STORAGE_PROTOCOL_NAME,
  strict,
  type ContractError,
  type OperationName,
  type OperationParams,
  type OperationRegistry,
  type OperationResult,
} from "./base";
import {
  AgentActivityInputSchema,
  AgentRuntimeUpdateSchema,
  DurableEventEnvelopeSchema,
} from "./events";
import { AgentOperations } from "./operations/agent";
import { StorageOperations } from "./operations/storage";

/**
 * What: performs the request schemas step for this file's workflow.
 *
 * Why: transport, persistence, and renderer boundaries need one shared contract shape.
 * Called when: used by process-messages when that path needs this behavior.
 */
function requestSchemas(registry: OperationRegistry) {
  return Object.entries(registry).map(([name, value]) => Type.Object({
    kind: Type.Literal("rpc"), protocolVersion: ProtocolVersionSchema,
    id: identifier, operation: Type.Literal(name), params: value.params,
  }, strict));
}
/**
 * What: performs the result schemas step for this file's workflow.
 *
 * Why: transport, persistence, and renderer boundaries need one shared contract shape.
 * Called when: used by process-messages when that path needs this behavior.
 */
function resultSchemas(registry: OperationRegistry) {
  return Object.entries(registry).flatMap(([name, value]) => [
    Type.Object({ kind: Type.Literal("rpc.success"), protocolVersion: ProtocolVersionSchema,
      id: identifier, operation: Type.Literal(name), result: value.result }, strict),
    Type.Object({ kind: Type.Literal("rpc.failure"), protocolVersion: ProtocolVersionSchema,
      id: identifier, operation: Type.Literal(name), error: ContractErrorSchema }, strict),
  ]);
}
export const StorageRpcRequestSchema = Type.Union(requestSchemas(StorageOperations));
export const StorageRpcResultSchema = Type.Union(resultSchemas(StorageOperations));
export const AgentRpcRequestSchema = Type.Union(requestSchemas(AgentOperations));
export const AgentRpcResultSchema = Type.Union(resultSchemas(AgentOperations));

export const ProjectChangedSchema = Type.Object({
  kind: Type.Literal("project.changed"), protocolVersion: ProtocolVersionSchema,
  streamId: Type.Optional(identifier), sequence: Type.Optional(Type.Integer({ minimum: 0 })),
  projectRevision: revision, documentRevision: revision,
}, strict);
export const ShutdownSchema = Type.Object({
  kind: Type.Literal("shutdown"), protocolVersion: ProtocolVersionSchema,
}, strict);
export const RpcCancelSchema = Type.Object({
  kind: Type.Literal("rpc.cancel"), protocolVersion: ProtocolVersionSchema,
  id: identifier, operation: identifier,
}, strict);
export const StorageForwardRequestSchema = Type.Union(requestSchemas(StorageOperations).map((schema) =>
  Type.Object({ ...schema.properties, kind: Type.Literal("storage.request") }, strict),
));
export const StorageForwardResultSchema = Type.Union(resultSchemas(StorageOperations).map((schema) =>
  Type.Object({ ...schema.properties, kind: Type.Literal(
    schema.properties.kind.const === "rpc.success" ? "storage.success" : "storage.failure",
  ) }, strict),
));

export const ReadyMessageSchema = Type.Object({
  kind: Type.Literal("ready"),
  protocolName: Type.Union([
    Type.Literal(STORAGE_PROTOCOL_NAME),
    Type.Literal(AGENT_PROTOCOL_NAME),
  ]),
  protocolVersion: ProtocolVersionSchema,
  buildIdentifier: Type.String({ minLength: 1, maxLength: 100 }),
  operations: Type.Array(identifier, { uniqueItems: true, maxItems: 100 }),
}, strict);
export const HealthMessageSchema = Type.Object({
  kind: Type.Literal("health"),
  protocolVersion: ProtocolVersionSchema,
  status: Type.Union([Type.Literal("healthy"), Type.Literal("degraded")]),
  details: Type.Optional(Type.Record(Type.String({ maxLength: 100 }), Type.String({ maxLength: 200 }))),
}, strict);
export const StartupErrorMessageSchema = Type.Object({
  kind: Type.Literal("startup.error"), protocolVersion: ProtocolVersionSchema,
  error: ContractErrorSchema,
}, strict);
export const DomainEventMessageSchema = Type.Object({
  kind: Type.Literal("domain.event"), protocolVersion: ProtocolVersionSchema, event: DurableEventEnvelopeSchema,
}, strict);
export const AgentRuntimeMessageSchema = Type.Object({
  kind: Type.Literal("agent.runtime"), protocolVersion: ProtocolVersionSchema, runtime: AgentRuntimeUpdateSchema,
}, strict);
export const AgentActivityMessageSchema = Type.Object({
  kind: Type.Literal("agent.activity"), protocolVersion: ProtocolVersionSchema, activity: AgentActivityInputSchema,
}, strict);
export const StorageChildMessageSchema = Type.Union([
  ReadyMessageSchema, HealthMessageSchema, StartupErrorMessageSchema, StorageRpcResultSchema, DomainEventMessageSchema,
]);
export const AgentChildMessageSchema = Type.Union([
  ReadyMessageSchema, HealthMessageSchema, StartupErrorMessageSchema, AgentRpcResultSchema, StorageForwardRequestSchema,
  AgentRuntimeMessageSchema, AgentActivityMessageSchema,
]);
export const AgentParentMessageSchema = Type.Union([
  AgentRpcRequestSchema, StorageForwardResultSchema, ProjectChangedSchema, ShutdownSchema, RpcCancelSchema,
]);

type RpcRequestFor<Registry extends OperationRegistry> = {
  [Name in OperationName<Registry>]: { kind: "rpc"; protocolVersion: 1; id: string; operation: Name; params: OperationParams<Registry, Name> }
}[OperationName<Registry>];
type RpcResultFor<Registry extends OperationRegistry> = {
  [Name in OperationName<Registry>]:
    | { kind: "rpc.success"; protocolVersion: 1; id: string; operation: Name; result: OperationResult<Registry, Name> }
    | { kind: "rpc.failure"; protocolVersion: 1; id: string; operation: Name; error: ContractError }
}[OperationName<Registry>];
export type StorageRpcRequest = RpcRequestFor<typeof StorageOperations>;
export type StorageRpcResult = RpcResultFor<typeof StorageOperations>;
export type AgentRpcRequest = RpcRequestFor<typeof AgentOperations>;
export type AgentRpcResult = RpcResultFor<typeof AgentOperations>;
export type StorageForwardRequest = {
  [Name in OperationName<typeof StorageOperations>]: {
    kind: "storage.request"; protocolVersion: 1; id: string; operation: Name;
    params: OperationParams<typeof StorageOperations, Name>;
  }
}[OperationName<typeof StorageOperations>];
export type StorageForwardResult = {
  [Name in OperationName<typeof StorageOperations>]:
    | { kind: "storage.success"; protocolVersion: 1; id: string; operation: Name; result: OperationResult<typeof StorageOperations, Name> }
    | { kind: "storage.failure"; protocolVersion: 1; id: string; operation: Name; error: ContractError }
}[OperationName<typeof StorageOperations>];
type ReadyMessage = Static<typeof ReadyMessageSchema>;
type HealthMessage = Static<typeof HealthMessageSchema>;
type StartupErrorMessage = Static<typeof StartupErrorMessageSchema>;
type DomainEventMessage = Static<typeof DomainEventMessageSchema>;
export type StorageChildMessage = ReadyMessage | HealthMessage | StartupErrorMessage | StorageRpcResult | DomainEventMessage;
export type AgentChildMessage = ReadyMessage | HealthMessage | StartupErrorMessage | AgentRpcResult | StorageForwardRequest |
  Static<typeof AgentRuntimeMessageSchema> | Static<typeof AgentActivityMessageSchema>;
export type ChildMessage = StorageChildMessage | AgentChildMessage;
export type AgentParentMessage = AgentRpcRequest | StorageForwardResult |
  Static<typeof ProjectChangedSchema> | Static<typeof ShutdownSchema> | Static<typeof RpcCancelSchema>;

export const CHILD_MESSAGE_KINDS = {
  ready: true, health: true, "startup.error": true, "rpc.success": true, "rpc.failure": true,
  "domain.event": true, "storage.request": true, "agent.runtime": true, "agent.activity": true,
} as const;
export const AGENT_PARENT_MESSAGE_KINDS = {
  rpc: true, "storage.success": true, "storage.failure": true,
  "project.changed": true, shutdown: true, "rpc.cancel": true,
} as const;
