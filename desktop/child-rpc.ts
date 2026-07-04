import {
  CHILD_MESSAGE_KINDS,
  type ChildMessage,
  type RpcRequest,
} from "../src/shared/contracts.js";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asChildMessage(value: unknown): ChildMessage | undefined {
  if (!isRecord(value) || typeof value.kind !== "string") return undefined;
  if (!(value.kind in CHILD_MESSAGE_KINDS)) return undefined;
  if (value.kind === "startup.error") {
    if (!isRecord(value.error)) return undefined;
    if (typeof value.error.code !== "string" || typeof value.error.message !== "string") {
      return undefined;
    }
    if (
      value.error.databasePath !== undefined &&
      typeof value.error.databasePath !== "string"
    ) return undefined;
  }
  return value as ChildMessage;
}

export class ChildRpc {
  private readonly pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private readyResolve!: () => void;
  private readyReject!: (error: Error) => void;
  private readySettled = false;
  private disposed = false;

  readonly ready = new Promise<void>((resolve, reject) => {
    this.readyResolve = resolve;
    this.readyReject = reject;
  });

  private readonly handleMessage = (value: unknown) => {
    const message = asChildMessage(value);
    if (!message || this.disposed) return;
    if (message.kind === "ready") {
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
        message.error.databasePath,
      ));
      return;
    }
    if (message.kind === "rpc.result") {
      if (typeof message.id !== "string") return;
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      if (typeof message.error === "string") request.reject(new Error(message.error));
      else request.resolve(message.result);
      return;
    }
    this.onMessage?.(message);
  };

  private readonly handleExit = (code: number | null) => {
    this.disposeWithError(
      new Error(
        this.readySettled
          ? `Utility process exited with code ${code}`
          : `Utility process exited before startup with code ${code}`,
      ),
    );
  };

  private readonly handleStderr = (chunk: unknown) => {
    this.onStderr(String(chunk).trimEnd());
  };

  constructor(
    private readonly child: UtilityProcessAdapter,
    private readonly createId: () => string,
    private readonly onMessage?: (message: ChildMessage) => void,
    private readonly onStderr: (message: string) => void = console.error,
  ) {
    child.on("message", this.handleMessage);
    child.on("exit", this.handleExit);
    child.stderr?.on("data", this.handleStderr);
  }

  async call<T>(method: string, params?: unknown): Promise<T> {
    await this.ready;
    if (this.disposed) throw new Error("Utility process is not available");
    const id = this.createId();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      const request: RpcRequest = { kind: "rpc", id, method, params };
      this.child.postMessage(request);
    });
  }

  post(message: unknown) {
    if (this.disposed) return;
    this.child.postMessage(message);
  }

  kill() {
    if (this.disposed) return;
    this.child.kill();
    this.disposeWithError(new Error("Utility process was stopped"));
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
    this.pending.clear();
    this.child.removeListener("message", this.handleMessage);
    this.child.removeListener("exit", this.handleExit);
    this.child.stderr?.removeListener("data", this.handleStderr);
  }
}
