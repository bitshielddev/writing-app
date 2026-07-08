import type { TSchema } from "typebox";

import {
  AgentChildMessageSchema,
  type ChildMessage,
  StorageChildMessageSchema,
} from "../src/contracts/process-messages.js";
import {
  BUILD_IDENTIFIER,
  type ContractError,
  type OperationArgs,
  type OperationName,
  type OperationRegistry,
  type OperationResult,
  PROTOCOL_VERSION,
} from "../src/contracts/base.js";
import {
  RemoteContractError,
  parseOrContractError,
} from "../src/contracts/validation.js";
import { AgentOperations } from "../src/contracts/operations/agent.js";
import { StorageOperations } from "../src/contracts/operations/storage.js";

type MessageListener = (message: unknown) => void;
type ExitListener = (code: number | null) => void;
type DataListener = (chunk: unknown) => void;

export type UtilityProcessAdapter = {
  on(event: "message", listener: MessageListener): unknown;
  on(event: "exit", listener: ExitListener): unknown;
  removeListener(event: "message", listener: MessageListener): unknown;
  removeListener(event: "exit", listener: ExitListener): unknown;
  postMessage(message: unknown): void;
  kill(): boolean;
  stderr?: {
    on(event: "data", listener: DataListener): unknown;
    removeListener(event: "data", listener: DataListener): unknown;
  } | null;
};

export class ChildStartupError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly databasePath?: string,
  ) {
    super(message);
    this.name = "ChildStartupError";
  }
}

export class OperationTimeoutError extends Error {
  readonly code = "OPERATION_TIMEOUT";
  constructor(readonly operation: string, readonly deadlineMs: number) {
    super(`${operation} did not complete within ${deadlineMs}ms`);
    this.name = "OperationTimeoutError";
  }
}

export class OperationCancelledError extends Error {
  readonly code = "OPERATION_CANCELLED";
  constructor(readonly operation: string) {
    super(`${operation} was cancelled`);
    this.name = "AbortError";
  }
}

export const RPC_DEADLINES_MS = {
  read: 10_000,
  mutation: 15_000,
  agentControl: 30_000,
  startup: 60_000,
  shutdown: 10_000,
} as const;

function deadlineFor(operation: string) {
  if (operation === "agent.start" || operation === "agent.stop") return RPC_DEADLINES_MS.agentControl;
  if (operation === "hydrate" || operation === "events.replay" || operation === "health.ping") return RPC_DEADLINES_MS.read;
  if (operation === "workspace.repair") return RPC_DEADLINES_MS.startup;
  return RPC_DEADLINES_MS.mutation;
}

export type RpcCallOptions = { deadlineMs?: number; signal?: AbortSignal };

const defaultRegistry = { ...StorageOperations, ...AgentOperations };
const defaultChildSchema = { ...StorageChildMessageSchema, anyOf: [
  ...(StorageChildMessageSchema.anyOf ?? []),
  ...(AgentChildMessageSchema.anyOf ?? []),
] } as TSchema;

function malformedReadyError(value: unknown) {
  if (typeof value !== "object" || value === null || !("kind" in value) || value.kind !== "ready") {
    return undefined;
  }
  const version = "protocolVersion" in value ? value.protocolVersion : undefined;
  return new ChildStartupError(
    version !== PROTOCOL_VERSION ? "PROTOCOL_VERSION_MISMATCH" : "MALFORMED_READY_HANDSHAKE",
    version !== PROTOCOL_VERSION
      ? `Protocol version mismatch: expected ${PROTOCOL_VERSION}, received ${String(version)}`
      : "Utility process sent a malformed ready handshake",
  );
}

export class ChildRpc<
  Registry extends OperationRegistry = typeof defaultRegistry,
  Message extends ChildMessage = ChildMessage,
> {
  private readonly pending = new Map<string, {
    operation: string;
    resultSchema: TSchema;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    signal?: AbortSignal;
    abort?: () => void;
  }>();
  private readyResolve!: () => void;
  private readyReject!: (error: Error) => void;
  private readySettled = false;
  private disposed = false;
  private readonly disposeWaiters: Array<() => void> = [];
  private readonly readyTimer: ReturnType<typeof setTimeout>;

  readonly ready = new Promise<void>((resolve, reject) => {
    this.readyResolve = resolve;
    this.readyReject = reject;
  });

  private readonly handleMessage = (value: unknown) => {
    let message: Message;
    try {
      message = parseOrContractError(this.childMessageSchema, value, `${this.boundary}.incoming`) as Message;
    } catch (error) {
      const readyError = malformedReadyError(value);
      if (readyError) {
        this.disposeWithError(readyError);
        return;
      }
      this.onStderr(error instanceof Error ? error.message : "Invalid child message");
      return;
    }
    if (this.disposed) return;
    if (message.kind === "ready") {
      if (!this.isCompatibleReadyMessage(message)) {
        this.disposeWithError(new ChildStartupError(
          "PROTOCOL_VERSION_MISMATCH",
          `Utility process compatibility mismatch for ${this.boundary}`,
        ));
        return;
      }
      if (!this.readySettled) {
        this.readySettled = true;
        this.readyResolve();
      }
      return;
    }
    if (message.kind === "startup.error") {
      this.disposeWithError(new ChildStartupError(
        message.error.code,
        message.error.message,
        typeof message.error.details?.databasePath === "string"
          ? message.error.details.databasePath
          : undefined,
      ));
      return;
    }
    if (message.kind === "rpc.success" || message.kind === "rpc.failure") {
      this.handleRpcResult(message);
      return;
    }
    this.onMessage?.(message);
  };

  private readonly handleExit = (code: number | null) => {
    this.disposeWithError(new Error(
      this.readySettled
        ? `Utility process exited with code ${code}`
        : `Utility process exited before startup with code ${code}`,
    ));
  };

  private readonly handleStderr = (chunk: unknown) => this.onStderr(String(chunk).trimEnd());

  private handleRpcResult(message: Extract<ChildMessage, { kind: "rpc.success" | "rpc.failure" }>) {
    const request = this.pending.get(message.id);
    if (!request || request.operation !== message.operation) return;
    this.pending.delete(message.id);
    clearTimeout(request.timer);
    if (request.signal && request.abort) request.signal.removeEventListener("abort", request.abort);
    if (message.kind === "rpc.failure") {
      request.reject(new RemoteContractError(message.error));
      return;
    }
    try {
      request.resolve(parseOrContractError(
        request.resultSchema,
        message.result,
        `${this.boundary}.${request.operation}.result`,
      ));
    } catch (error) {
      request.reject(error instanceof Error ? error : new Error("Invalid RPC result"));
    }
  }

  private isCompatibleReadyMessage(message: Extract<ChildMessage, { kind: "ready" }>) {
    if (message.protocolName !== this.expectedProtocolName) return false;
    if (message.protocolVersion !== PROTOCOL_VERSION) return false;
    if (message.buildIdentifier !== this.expectedBuildIdentifier) return false;
    return JSON.stringify([...message.operations].sort()) ===
      JSON.stringify(Object.keys(this.registry).sort());
  }

  constructor(
    private readonly child: UtilityProcessAdapter,
    private readonly createId: () => string,
    private readonly onMessage?: (message: Message) => void,
    private readonly onStderr: (message: string) => void = console.error,
    private readonly registry: Registry = defaultRegistry as unknown as Registry,
    private readonly childMessageSchema: TSchema = defaultChildSchema,
    private readonly boundary = "utility-process",
    private readonly expectedProtocolName = "scribe.agent",
    private readonly expectedBuildIdentifier = BUILD_IDENTIFIER,
    private readonly startupDeadlineMs = RPC_DEADLINES_MS.startup,
    private readonly onDisposed?: (error: Error) => void,
  ) {
    child.on("message", this.handleMessage);
    child.on("exit", this.handleExit);
    child.stderr?.on("data", this.handleStderr);
    this.readyTimer = setTimeout(() => {
      this.disposeWithError(new OperationTimeoutError(`${this.boundary}.startup`, this.startupDeadlineMs));
    }, this.startupDeadlineMs);
    void this.ready.finally(() => clearTimeout(this.readyTimer)).catch(() => undefined);
  }

  async call<Name extends OperationName<Registry>>(
    operation: Name,
    ...args: OperationArgs<Registry, Name>
  ): Promise<OperationResult<Registry, Name>> {
    return this.callWithOptions(operation, {}, ...args);
  }

  async callWithOptions<Name extends OperationName<Registry>>(
    operation: Name,
    options: RpcCallOptions,
    ...args: OperationArgs<Registry, Name>
  ): Promise<OperationResult<Registry, Name>> {
    await this.ready;
    if (this.disposed) throw new Error("Utility process is not available");
    const definition = this.registry[operation];
    const params = parseOrContractError(
      definition.params,
      args[0],
      `${this.boundary}.${operation}.params`,
    );
    const id = this.createId();
    const deadlineMs = options.deadlineMs ?? deadlineFor(operation);
    return new Promise((resolve, reject) => {
      const finishFailure = (error: Error) => {
        const request = this.pending.get(id);
        if (!request) return;
        this.pending.delete(id);
        clearTimeout(request.timer);
        if (request.signal && request.abort) request.signal.removeEventListener("abort", request.abort);
        this.child.postMessage({
          kind: "rpc.cancel",
          protocolVersion: PROTOCOL_VERSION,
          id,
          operation,
        });
        reject(error);
      };
      const timer = setTimeout(
        () => finishFailure(new OperationTimeoutError(operation, deadlineMs)),
        deadlineMs,
      );
      const abort = () => finishFailure(new OperationCancelledError(operation));
      this.pending.set(id, {
        operation,
        resultSchema: definition.result,
        resolve: (value) => resolve(value as OperationResult<Registry, Name>),
        reject,
        timer,
        signal: options.signal,
        abort,
      });
      if (options.signal?.aborted) {
        abort();
        return;
      }
      options.signal?.addEventListener("abort", abort, { once: true });
      this.child.postMessage({
        kind: "rpc",
        protocolVersion: PROTOCOL_VERSION,
        id,
        operation,
        params,
      });
    });
  }

  get pendingCount() { return this.pending.size; }

  post(message: unknown) {
    if (!this.disposed) this.child.postMessage(message);
  }

  kill() {
    if (this.disposed) return;
    this.child.kill();
    this.disposeWithError(new Error("Utility process was stopped"));
  }

  shutdown(graceMs = RPC_DEADLINES_MS.shutdown) {
    if (this.disposed) return Promise.resolve();
    const completion = new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.child.kill();
        this.disposeWithError(new Error("Utility process exceeded shutdown grace period"));
      }, graceMs);
      const done = () => { clearTimeout(timer); resolve(); };
      this.disposeWaiters.push(done);
    });
    this.post({ kind: "shutdown", protocolVersion: PROTOCOL_VERSION });
    return completion;
  }

  dispose() {
    this.disposeWithError(new Error("Utility process was disposed"));
  }

  private disposeWithError(error: Error) {
    if (this.disposed) return;
    this.disposed = true;
    if (!this.readySettled) {
      this.readySettled = true;
      this.readyReject(error);
    }
    for (const request of this.pending.values()) request.reject(error);
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      if (request.signal && request.abort) request.signal.removeEventListener("abort", request.abort);
    }
    this.pending.clear();
    this.child.removeListener("message", this.handleMessage);
    this.child.removeListener("exit", this.handleExit);
    this.child.stderr?.removeListener("data", this.handleStderr);
    for (const resolve of this.disposeWaiters.splice(0)) resolve();
    this.onDisposed?.(error);
  }
}

export function contractErrorFrom(error: unknown): ContractError | undefined {
  return error instanceof RemoteContractError ? error.contract : undefined;
}
