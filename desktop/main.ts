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
  type WebPreferences,
} from "electron";

import { ActivityRing } from "./activity.js";
import { ChildRpc } from "./child-rpc.js";
import { ProcessSupervisor, type ProcessHealth } from "./process-supervisor.js";
import { DurableEventBroker } from "./durable-event-broker.js";
import { registerMainIpc } from "./ipc-routing.js";
import {
  createAgentMessageHandler,
  createStorageMessageHandler,
} from "./process-messages.js";
import {
  databaseStartupGuidance,
  runDesktopStartup,
} from "./startup.js";
import type {
  AgentRuntime,
  DesktopTransportEvent,
  ProcessHealthSnapshot,
} from "../src/contracts/desktop-bridge.js";
import {
  AgentChildMessageSchema,
  StorageChildMessageSchema,
  type AgentChildMessage,
  type StorageChildMessage,
} from "../src/contracts/process-messages.js";
import {
  AGENT_PROTOCOL_NAME,
  PROTOCOL_VERSION,
  STORAGE_PROTOCOL_NAME,
  type OperationArgs,
  type OperationName,
  type OperationRegistry,
} from "../src/contracts/base.js";
import { DesktopEventSchema } from "../src/contracts/events.js";
import { AgentOperations } from "../src/contracts/operations/agent.js";
import { StorageOperations } from "../src/contracts/operations/storage.js";
import { DESKTOP_EVENT_CHANNEL } from "../src/contracts/operations/renderer.js";
import {
  parseOrContractError,
} from "../src/contracts/validation.js";

const here = dirname(fileURLToPath(import.meta.url));
const developmentServerUrl = process.env.VITE_DEV_SERVER_URL;
const isDevelopment = import.meta.env.DEV;
const measureStartup = process.argv.includes("--measure-startup");
let storage: ChildRpc<typeof StorageOperations, StorageChildMessage>;
let agent: ChildRpc<typeof AgentOperations, AgentChildMessage>;
let workspaceWindow: BrowserWindow | undefined;
let runtime: AgentRuntime = {
  status: "offline",
  cycleCount: 0,
};
let agentShouldRun = false;
let health: ProcessHealthSnapshot = {
  storage: { state: "starting" },
  agent: { state: "starting" },
};
let quitting = false;
const activity = new ActivityRing();
const durableEvents = new DurableEventBroker(DESKTOP_EVENT_CHANNEL, randomUUID);

function spawnChild<Registry extends OperationRegistry, Message extends StorageChildMessage | AgentChildMessage>(
  modulePath: string,
  args: string[],
  registry: Registry,
  messageSchema: typeof StorageChildMessageSchema | typeof AgentChildMessageSchema,
  boundary: string,
  onMessage?: (message: Message) => void,
  onFailure?: (error: Error) => void,
) {
  const child = utilityProcess.fork(modulePath, args, {
    cwd: app.getPath("userData"),
    stdio: "pipe",
    serviceName: modulePath.endsWith("agent.js")
      ? "ScribeAI Agent"
      : "ScribeAI Storage",
  });
  return new ChildRpc<Registry, Message>(
    child,
    randomUUID,
    onMessage,
    console.error,
    registry,
    messageSchema,
    boundary,
    boundary === "storage-process" ? STORAGE_PROTOCOL_NAME : AGENT_PROTOCOL_NAME,
    undefined,
    undefined,
    onFailure,
  );
}

function broadcast(event: DesktopTransportEvent) {
  let validated: DesktopTransportEvent;
  try {
    validated = parseOrContractError(DesktopEventSchema, event, "main.desktop-event");
  } catch (error) {
    console.error("Discarded invalid desktop event", error);
    return;
  }
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(DESKTOP_EVENT_CHANNEL, validated);
  }
}

function setRuntime(update: Partial<AgentRuntime>) {
  runtime = { ...runtime, ...update };
  if (runtime.status === "working" || runtime.status === "waiting" || runtime.status === "capped") agentShouldRun = true;
  if (runtime.status === "stopped") agentShouldRun = false;
  broadcast({ type: "agent.runtime", runtime });
}

function setProcessHealth(process: "storage" | "agent", next: ProcessHealth) {
  health = { ...health, [process]: next };
  broadcast({ type: "process.health", health });
}

function secureWebPreferences(): WebPreferences {
  const additionalArguments = [];
  if (process.env.SCRIBE_E2E === "1") additionalArguments.push("--scribe-e2e");
  return {
    preload: join(here, "preload.cjs"),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    additionalArguments,
  };
}

const agentEndpoint = {
  call<Name extends OperationName<typeof AgentOperations>>(
    operation: Name,
    ...args: OperationArgs<typeof AgentOperations, Name>
  ) {
    return agent.call(operation, ...args);
  },
};

function registerIpc(
  onScopeSelected?: (scope: { projectId: string; documentId: string }) => Promise<void>,
  retryProcess?: (process: "storage" | "agent") => Promise<void>,
) {
  registerMainIpc({
    ipcMain,
    validateSender: (sender) =>
      BrowserWindow.getAllWindows().some(
        (window) => window.webContents.id === sender.id,
      ),
    ownerForSender: (sender) =>
      BrowserWindow.getAllWindows().find(
        (window) => window.webContents.id === sender.id,
      ),
    dialog: {
      show: (owner, options) =>
        owner
          ? dialog.showOpenDialog(
              owner as BrowserWindow,
              options as Electron.OpenDialogOptions,
            )
          : dialog.showOpenDialog(options as Electron.OpenDialogOptions),
    },
    storage,
    agent: agentEndpoint,
    getRuntime: () => runtime,
    setRuntime: (nextRuntime) => {
      runtime = nextRuntime;
    },
    activitySnapshot: () => activity.snapshot(),
    eventConsumers: {
      subscribe: (sender) => durableEvents.subscribe(sender as Electron.WebContents),
      consumerId: (senderId) => durableEvents.consumerId(senderId),
      beginHydration: (senderId, restart) => durableEvents.beginHydration(senderId, restart),
      completeHydration: (senderId, streamId, sequence) =>
        durableEvents.completeHydration(senderId, streamId, sequence),
    },
    onScopeSelected,
    getHealth: () => health,
    retryProcess,
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: "#ffffff",
    webPreferences: secureWebPreferences(),
  });
  workspaceWindow = window;
  if (process.env.SCRIBE_E2E === "1") {
    window.webContents.once("did-finish-load", () => console.log("SCRIBE_E2E_READY"));
  }
  if (measureStartup) {
    window.webContents.once("did-finish-load", () => {
      const deadline = Date.now() + 30_000;
      const collect = async () => {
        const marks = await window.webContents.executeJavaScript(
          `Object.fromEntries(performance.getEntriesByType("mark").map(({ name, startTime }) => [name, startTime]))`,
        ) as Record<string, number>;
        if (
          marks["scribe:react-mounted"] !== undefined &&
          marks["scribe:hydration-complete"] !== undefined &&
          marks["scribe:editor-ready"] !== undefined
        ) {
          console.log(`SCRIBE_STARTUP ${JSON.stringify(marks)}`);
          app.quit();
          return;
        }
        if (Date.now() >= deadline) {
          console.error("Startup measurement timed out", marks);
          app.exit(1);
          return;
        }
        setTimeout(() => void collect(), 25);
      };
      void collect();
    });
  }
  window.on("closed", () => {
    durableEvents.remove(window.webContents.id);
    if (workspaceWindow === window) workspaceWindow = undefined;
  });
  if (developmentServerUrl) void window.loadURL(developmentServerUrl);
  else void window.loadFile(join(here, "../dist/index.html"));
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
  const agentDir = join(userDataPath, "pi");
  const storageEndpoint = {
    call<Name extends OperationName<typeof StorageOperations>>(
      operation: Name,
      ...args: OperationArgs<typeof StorageOperations, Name>
    ) {
      return storage.call(operation, ...args);
    },
  };
  const handleStorageMessage = createStorageMessageHandler({
    storage: storageEndpoint,
    getAgent: () => agent,
    broadcast: (event) => durableEvents.publish(event),
  });
  const handleAgentMessage = createAgentMessageHandler({
    storage: storageEndpoint,
    getAgent: () => agent,
    setRuntime,
    addActivity: (item) => activity.add(item),
    broadcast,
  });
  let selectedScope: { projectId: string; documentId: string };
  let agentGeneration = 0;
  let agentSupervisor: ProcessSupervisor<ChildRpc<typeof AgentOperations, AgentChildMessage>>;
  const retryable = (error: unknown) => !(error instanceof Error && (
    error.message.includes("compatibility mismatch") ||
    ("code" in error && typeof error.code === "string" && (
      error.code.includes("PROTOCOL") || error.code.includes("UNSUPPORTED") ||
      error.code.includes("MIGRATION") || error.code.includes("DATABASE_CORRUPT")
    ))
  ));
  const storageSupervisor = new ProcessSupervisor({
    spawn: () => storage = spawnChild(
      join(here, "storage.js"),
      [dbPath, userDataPath],
      StorageOperations,
      StorageChildMessageSchema,
      "storage-process",
      (message) => void handleStorageMessage(message),
      (error) => {
        if (!quitting) void storageSupervisor.processFailed(error).catch(console.error);
      },
    ),
    validate: async (process) => { await process.call("health.ping"); },
    recover: async (process) => {
      const catalog = await process.call("workspace.catalog");
      selectedScope = catalog.selection;
      await process.call("workspace.repair", selectedScope);
      await process.call("hydrate", selectedScope);
    },
    classifyRetryable: retryable,
    onHealth: (next) => setProcessHealth("storage", next),
  });

  const createAgentSupervisor = (scope: { projectId: string; documentId: string }) => new ProcessSupervisor({
    spawn: () => {
    const generation = ++agentGeneration;
    const documentWorkspace = join(
      userDataPath, "projects", scope.projectId, "documents", scope.documentId,
    );
    const sessionDirectory = join(documentWorkspace, ".pi", "sessions");
    return agent = spawnChild(
      join(here, "agent.js"),
      [documentWorkspace, agentDir, sessionDirectory],
      AgentOperations,
      AgentChildMessageSchema,
      "agent-process",
      (message) => {
        if (generation === agentGeneration) void handleAgentMessage(message);
      },
      (error) => {
        if (!quitting && generation === agentGeneration) {
          void agentSupervisor.processFailed(error).catch(console.error);
        }
      },
    );
    },
    validate: async (process) => { await process.call("health.ping"); },
    recover: async (process) => {
      const seed = await storage.call("agent.seed", scope);
      process.post({
        kind: "project.changed", protocolVersion: PROTOCOL_VERSION,
        streamId: seed.streamId, sequence: seed.coveredThroughSequence,
        projectRevision: seed.projectRevision, documentRevision: seed.documentRevision,
      });
      if (agentShouldRun) {
        await process.call("agent.start", {
          ...scope,
          projectRevision: seed.projectRevision,
          documentRevision: seed.documentRevision,
        });
      }
    },
    classifyRetryable: retryable,
    onHealth: (next: ProcessHealth) => setProcessHealth("agent", next),
  });
  const switchDocumentAgent = async (scope: { projectId: string; documentId: string }) => {
    try { await agent.call("agent.stop", scope); } catch { /* process may already be unavailable */ }
    agent?.post({ kind: "shutdown", protocolVersion: PROTOCOL_VERSION });
    agentSupervisor.stop();
    runtime = { status: "offline", cycleCount: 0 };
    selectedScope = scope;
    agentSupervisor = createAgentSupervisor(scope);
    await agentSupervisor.start();
  };
  await storageSupervisor.start();
  agentSupervisor = createAgentSupervisor(selectedScope!);
  await agentSupervisor.start();
  registerIpc(switchDocumentAgent, async (process) => {
    if (process === "storage") await storageSupervisor.retry();
    else await agentSupervisor.retry();
  });
  if (process.env.SCRIBE_E2E === "1") {
    ipcMain.handle("scribe:test:control", (event, command: unknown) => {
      const knownSender = BrowserWindow.getAllWindows().some((window) => window.webContents.id === event.sender.id);
      if (!knownSender) throw new Error("Unknown renderer");
      if (command === "readiness") return { ready: true, health, userDataPath };
      if (command === "terminate-storage") { storage.kill(); return { accepted: true }; }
      if (command === "terminate-agent") { agent.kill(); return { accepted: true }; }
      throw new Error("Unknown test command");
    });
  }
  installDevelopmentMenu();
  createWindow();
}

void runDesktopStartup(
  async () => {
    await app.whenReady();
    await start();
  },
  (error) => {
    console.error("Desktop startup failed", error);
    const guidance = databaseStartupGuidance(error);
    if (guidance) dialog.showErrorBox("Workspace database could not be opened", guidance);
    app.quit();
  },
);

app.on("activate", () => {
  if (!workspaceWindow) createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void (async () => {
    await Promise.allSettled(BrowserWindow.getAllWindows().map((window) =>
      window.webContents.executeJavaScript("window.scribeFlush?.()")));
    await Promise.allSettled([agent?.shutdown(), storage?.shutdown()]);
    app.exit(0);
  })();
});
