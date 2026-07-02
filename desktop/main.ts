import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  utilityProcess,
  type MenuItemConstructorOptions,
  type IpcMainInvokeEvent,
  type UtilityProcess,
  type WebContents,
  type WebPreferences,
} from "electron";

import { ActivityRing } from "./activity.js";
import type {
  AgentActivity,
  AgentRuntime,
  DesktopEvent,
  ObservationSeed,
  SourceSnapshot,
  WorkspaceSnapshot,
} from "../src/shared/desktop.js";
import { isSuggestionItem } from "../src/suggestions/validation.js";

type ChildMessage =
  | { kind: "ready" }
  | { kind: "rpc.result"; id: string; result?: unknown; error?: string }
  | { kind: "domain.event"; event: DesktopEvent }
  | { kind: "storage.request"; id: string; method: string; params?: unknown }
  | { kind: "agent.runtime"; runtime: Partial<AgentRuntime> }
  | { kind: "agent.activity"; activity: Omit<AgentActivity, "updatedAt"> };

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
const developmentServerUrl = process.env.VITE_DEV_SERVER_URL;
const isDevelopment = Boolean(developmentServerUrl);
let storage: ChildRpc;
let agent: ChildRpc;
let workspaceWindow: BrowserWindow | undefined;
let mockSuggestionWindow: BrowserWindow | undefined;
let runtime: AgentRuntime = {
  status: "offline",
  cycleCount: 0,
};
const activity = new ActivityRing();

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

function registerValidatedIpc<Args extends unknown[], Result>(
  channel: string,
  handler: (
    event: IpcMainInvokeEvent,
    ...args: Args
  ) => Result | Promise<Result>,
) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!validateSender(event.sender)) throw new Error("Unknown renderer");
    return handler(event, ...(args as Args));
  });
}

function secureWebPreferences(developmentTools: boolean): WebPreferences {
  return {
    preload: join(here, "preload.cjs"),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    additionalArguments: developmentTools ? ["--scribe-development"] : [],
  };
}

function registerIpc() {
  registerValidatedIpc("scribe:hydrate", async () => {
    const snapshot = await storage.call<WorkspaceSnapshot>("hydrate");
    runtime = {
      ...snapshot.agent,
      ...runtime,
    };
    return { ...snapshot, agent: runtime, activity: activity.snapshot() };
  });

  registerValidatedIpc("scribe:agent.start", async () => {
    const seed = await storage.call<ObservationSeed>("agent.seed");
    return agent.call<AgentRuntime>("agent.start", {
      projectRevision: seed.projectRevision,
      documentRevision: seed.documentRevision,
    });
  });

  registerValidatedIpc("scribe:agent.stop", () => {
    return agent.call<AgentRuntime>("agent.stop");
  });

  registerValidatedIpc("scribe:document.save", (_event, input) => {
    return storage.call("document.save", input);
  });

  registerValidatedIpc("scribe:suggestions.save", (_event, state) => {
    return storage.call("suggestions.save", state);
  });

  registerValidatedIpc("scribe:source.import", async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      properties: ["openFile"],
      filters: [
        {
          name: "Writing sources",
          extensions: ["md", "markdown"],
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

  if (isDevelopment) {
    registerValidatedIpc(
      "scribe:development.suggestion.create",
      async (_event, item: unknown) => {
        if (!isSuggestionItem(item)) {
          throw new Error("Invalid development suggestion");
        }
        return storage.call("development.suggestion.create", { item });
      },
    );
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: "#ffffff",
    webPreferences: secureWebPreferences(isDevelopment),
  });
  workspaceWindow = window;
  window.on("closed", () => {
    if (workspaceWindow === window) workspaceWindow = undefined;
  });
  if (developmentServerUrl) void window.loadURL(developmentServerUrl);
  else void window.loadFile(join(here, "../dist/index.html"));
}

function openMockSuggestionWindow() {
  if (!developmentServerUrl) return;
  if (mockSuggestionWindow && !mockSuggestionWindow.isDestroyed()) {
    mockSuggestionWindow.focus();
    return;
  }

  const window = new BrowserWindow({
    width: 760,
    height: 900,
    minWidth: 600,
    minHeight: 600,
    title: "ScribeAI Mock Suggestions",
    webPreferences: secureWebPreferences(true),
  });
  mockSuggestionWindow = window;
  window.on("closed", () => {
    if (mockSuggestionWindow === window) mockSuggestionWindow = undefined;
  });
  void window.loadURL(new URL("/mock-suggestions", developmentServerUrl).toString());
}

function installDevelopmentMenu() {
  if (!isDevelopment) return;
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin"
      ? ([{ role: "appMenu" }] satisfies MenuItemConstructorOptions[])
      : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    {
      label: "Development",
      submenu: [
        {
          label: "Mock suggestions",
          accelerator: "CmdOrCtrl+Shift+M",
          click: openMockSuggestionWindow,
        },
        { role: "toggleDevTools" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function start() {
  const userDataPath = app.getPath("userData");
  const dbPath = join(userDataPath, "scribe.sqlite3");
  const projectWorkspace = join(userDataPath, "projects", "default-project");
  const agentDir = join(userDataPath, "pi");
  const sessionDirectory = join(projectWorkspace, ".pi", "sessions");
  storage = new ChildRpc(join(here, "storage.js"), [dbPath, projectWorkspace], (message) => {
    if (message.kind !== "domain.event") return;
    broadcast(message.event);
    if (message.event.type === "document.saved") {
      agent?.post({
        kind: "project.changed",
        projectRevision: message.event.projectRevision,
        documentRevision: message.event.document.revision,
      });
    } else if (message.event.type === "source.imported") {
      void storage.call<ObservationSeed>("agent.seed").then((seed) => {
        agent?.post({
          kind: "project.changed",
          projectRevision: seed.projectRevision,
          documentRevision: seed.documentRevision,
        });
      });
    }
  });
  await storage.ready;
  await storage.call("workspace.repair");
  agent = new ChildRpc(
    join(here, "agent.js"),
    [projectWorkspace, agentDir, sessionDirectory],
    (message) => {
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
      } else if (message.kind === "agent.activity") {
        const item = activity.add(message.activity);
        broadcast({ type: "agent.activity", activity: item });
      }
    },
  );
  await agent.ready;
  registerIpc();
  installDevelopmentMenu();
  createWindow();
  const seed = await storage.call<ObservationSeed>("agent.seed");
  agent.post({
    kind: "project.changed",
    projectRevision: seed.projectRevision,
    documentRevision: seed.documentRevision,
  });
}

app.whenReady().then(start).catch((error: unknown) => {
  console.error("Desktop startup failed", error);
  app.quit();
});

app.on("activate", () => {
  if (!workspaceWindow) createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  agent?.post({ kind: "shutdown" });
  agent?.kill();
  storage?.kill();
});
