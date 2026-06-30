import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  utilityProcess,
  type UtilityProcess,
  type WebContents,
} from "electron";

import type {
  AgentRuntime,
  DesktopEvent,
  ObservationSeed,
  ProviderSettings,
  SourceSnapshot,
  WorkspaceSnapshot,
} from "../src/shared/desktop.js";

type ChildMessage =
  | { kind: "ready" }
  | { kind: "rpc.result"; id: string; result?: unknown; error?: string }
  | { kind: "domain.event"; event: DesktopEvent }
  | { kind: "storage.request"; id: string; method: string; params?: unknown }
  | { kind: "agent.runtime"; runtime: Partial<AgentRuntime> }
  | { kind: "agent.complete"; projectRevision: number };

class ChildRpc {
  private readonly child: UtilityProcess;
  private readonly pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private readyResolve!: () => void;
  private readyReject!: (error: Error) => void;
  private readySettled = false;
  readonly ready = new Promise<void>((resolve, reject) => {
    this.readyResolve = resolve;
    this.readyReject = reject;
  });

  constructor(
    modulePath: string,
    args: string[],
    onMessage?: (message: ChildMessage) => void,
  ) {
    this.child = utilityProcess.fork(modulePath, args, {
      cwd: app.getPath("userData"),
      stdio: "pipe",
      serviceName: modulePath.endsWith("agent.js")
        ? "ScribeAI Agent"
        : "ScribeAI Storage",
    });
    this.child.on("message", (message: ChildMessage) => {
      if (message.kind === "ready") {
        this.readySettled = true;
        this.readyResolve();
        return;
      }
      if (message.kind === "rpc.result") {
        const request = this.pending.get(message.id);
        if (!request) return;
        this.pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error));
        else request.resolve(message.result);
        return;
      }
      onMessage?.(message);
    });
    this.child.stderr?.on("data", (chunk) =>
      console.error(String(chunk).trimEnd()),
    );
    this.child.on("exit", (code) => {
      if (!this.readySettled) {
        this.readySettled = true;
        this.readyReject(
          new Error(`Utility process exited before startup with code ${code}`),
        );
      }
      for (const request of this.pending.values()) {
        request.reject(new Error(`Utility process exited with code ${code}`));
      }
      this.pending.clear();
    });
  }

  async call<T>(method: string, params?: unknown): Promise<T> {
    await this.ready;
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.child.postMessage({ kind: "rpc", id, method, params });
    });
  }

  post(message: unknown) {
    this.child.postMessage(message);
  }

  kill() {
    this.child.kill();
  }
}

const here = dirname(fileURLToPath(import.meta.url));
let storage: ChildRpc;
let agent: ChildRpc;
let apiKey = "";
let lastCompletedProjectRevision = -1;
let runtime: AgentRuntime = {
  paused: false,
  running: false,
  configured: false,
};
let scheduler: ReturnType<typeof setInterval> | undefined;

function broadcast(event: DesktopEvent) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("scribe:event", event);
  }
}

function setRuntime(update: Partial<AgentRuntime>) {
  runtime = { ...runtime, ...update };
  broadcast({ type: "agent.runtime", runtime });
}

function validateSender(contents: WebContents) {
  return BrowserWindow.getAllWindows().some(
    (window) => window.webContents.id === contents.id,
  );
}

async function observe(force = false) {
  const seed = await storage.call<ObservationSeed>("agent.seed");
  if (!seed.provider.enabled || seed.paused) {
    setRuntime({
      configured: seed.provider.enabled,
      paused: seed.paused,
      running: false,
    });
    return;
  }
  if (!force && seed.projectRevision === lastCompletedProjectRevision) return;
  agent.post({ kind: "observe", seed, apiKey, force });
}

function registerIpc() {
  ipcMain.handle("scribe:hydrate", async (event) => {
    if (!validateSender(event.sender)) throw new Error("Unknown renderer");
    const snapshot = await storage.call<WorkspaceSnapshot>("hydrate");
    runtime = {
      ...snapshot.agent,
      configured: snapshot.provider.enabled,
    };
    agent.post({ kind: "configure", provider: snapshot.provider, apiKey });
    return { ...snapshot, agent: runtime };
  });

  ipcMain.handle("scribe:document.save", (event, input) => {
    if (!validateSender(event.sender)) throw new Error("Unknown renderer");
    return storage.call("document.save", input);
  });

  ipcMain.handle("scribe:suggestions.save", (event, state) => {
    if (!validateSender(event.sender)) throw new Error("Unknown renderer");
    return storage.call("suggestions.save", state);
  });

  ipcMain.handle("scribe:source.import", async (event) => {
    if (!validateSender(event.sender)) throw new Error("Unknown renderer");
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      properties: ["openFile"],
      filters: [
        {
          name: "Writing sources",
          extensions: ["txt", "md", "markdown", "json", "pdf", "docx"],
        },
      ],
    };
    const selection = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    const path = selection.filePaths[0];
    if (selection.canceled || !path) return undefined;
    return storage.call<SourceSnapshot>("source.import", { path });
  });

  ipcMain.handle("scribe:provider.set", async (event, input) => {
    if (!validateSender(event.sender)) throw new Error("Unknown renderer");
    const providerInput = input as ProviderSettings & { apiKey?: string };
    apiKey = providerInput.apiKey ?? "";
    const provider = await storage.call<ProviderSettings>("provider.set", {
      provider: providerInput.provider,
      model: providerInput.model,
      baseUrl: providerInput.baseUrl,
      enabled: providerInput.enabled,
    });
    setRuntime({ configured: provider.enabled, lastError: undefined });
    agent.post({ kind: "configure", provider, apiKey });
    void observe(true);
    return provider;
  });

  ipcMain.handle("scribe:agent.pause", async (event, paused: boolean) => {
    if (!validateSender(event.sender)) throw new Error("Unknown renderer");
    await storage.call("agent.pause", { paused });
    setRuntime({ paused });
    agent.post({ kind: paused ? "abort" : "resume" });
    if (!paused) void observe(true);
    return runtime;
  });

  ipcMain.handle("scribe:agent.consider-now", async (event) => {
    if (!validateSender(event.sender)) throw new Error("Unknown renderer");
    await observe(true);
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const devUrl = process.env.SCRIBE_DEV_SERVER_URL;
  if (devUrl) void window.loadURL(devUrl);
  else void window.loadFile(join(here, "../dist/index.html"));
}

async function start() {
  const dbPath = join(app.getPath("userData"), "scribe.sqlite3");
  storage = new ChildRpc(join(here, "storage.js"), [dbPath], (message) => {
    if (message.kind === "domain.event") broadcast(message.event);
  });
  agent = new ChildRpc(join(here, "agent.js"), [], (message) => {
    if (message.kind === "storage.request") {
      void storage
        .call(message.method, message.params)
        .then((result) =>
          agent.post({ kind: "storage.result", id: message.id, result }),
        )
        .catch((error: unknown) =>
          agent.post({
            kind: "storage.result",
            id: message.id,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
    } else if (message.kind === "agent.runtime") {
      setRuntime(message.runtime);
    } else if (message.kind === "agent.complete") {
      lastCompletedProjectRevision = message.projectRevision;
    }
  });
  await Promise.all([storage.ready, agent.ready]);
  registerIpc();
  createWindow();
  scheduler = setInterval(() => void observe(), 10_000);
  void observe();
}

app.whenReady().then(start).catch((error: unknown) => {
  console.error("Desktop startup failed", error);
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (scheduler) clearInterval(scheduler);
  agent?.kill();
  storage?.kill();
});
