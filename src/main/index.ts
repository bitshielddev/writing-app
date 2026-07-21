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

import { ActivityRing } from "./diagnostics/activity.js";
import { DurableEventBroker } from "./ipc/durable-event-broker.js";
import { registerMainIpc } from "./ipc/routing.js";
import { ThemeService } from "./themes/catalog.js";
import { ChildRpc } from "./processes/child-rpc.js";
import { ProcessSupervisor, type ProcessHealth } from "./processes/process-supervisor.js";
import {
  createAgentMessageHandler,
  createStorageMessageHandler,
} from "./processes/message-handlers.js";
import {
  databaseStartupGuidance,
  runDesktopStartup,
} from "./processes/startup.js";
import type {
  AgentRuntime,
  DesktopTransportEvent,
  ProcessHealthSnapshot,
} from "../contracts/desktop-bridge.js";
import {
  AgentChildMessageSchema,
  StorageChildMessageSchema,
  type AgentChildMessage,
  type StorageChildMessage,
} from "../contracts/process-messages.js";
import {
  AGENT_PROTOCOL_NAME,
  PROTOCOL_VERSION,
  STORAGE_PROTOCOL_NAME,
  type OperationArgs,
  type OperationName,
  type OperationRegistry,
} from "../contracts/base.js";
import { DesktopEventSchema } from "../contracts/events.js";
import { AgentOperations } from "../contracts/operations/agent.js";
import { StorageOperations } from "../contracts/operations/storage.js";
import { DESKTOP_EVENT_CHANNEL } from "../contracts/operations/renderer.js";
import {
  parseOrContractError,
} from "../contracts/validation.js";
import { writeAgentPromptBootstrap } from "../utility/agent/prompt-config.js";

const here = dirname(fileURLToPath(import.meta.url));
const developmentServerUrl = process.env.VITE_DEV_SERVER_URL;
const isDevelopment = import.meta.env.DEV;
const measureStartup = process.argv.includes("--measure-startup");
const RENDERER_SHUTDOWN_FLUSH_TIMEOUT_MS = 5_000;
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
let themeService: ThemeService;
const activity = new ActivityRing();
const durableEvents = new DurableEventBroker(DESKTOP_EVENT_CHANNEL, randomUUID);

/**
 * What: performs the spawn child step for this file's workflow.
 *
 * Why: the Electron shell needs centralized startup, routing, and runtime coordination.
 * Called when: used by start and createAgentSupervisor when that path needs this behavior.
 */
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

/**
 * What: performs the broadcast step for this file's workflow.
 *
 * Why: the Electron shell needs centralized startup, routing, and runtime coordination.
 * Called when: used by setRuntime, setProcessHealth and start when that path needs this behavior.
 */
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

/**
 * What: updates runtime in the active runtime state.
 *
 * Why: the Electron shell needs centralized startup, routing, and runtime coordination.
 * Called when: used by start when that path needs this behavior.
 */
function setRuntime(update: Partial<AgentRuntime>) {
  runtime = { ...runtime, ...update };
  if (runtime.status === "working" || runtime.status === "waiting" || runtime.status === "capped") agentShouldRun = true;
  if (runtime.status === "stopped") agentShouldRun = false;
  broadcast({ type: "agent.runtime", runtime });
}

/**
 * What: updates process health in the active runtime state.
 *
 * Why: the Electron shell needs centralized startup, routing, and runtime coordination.
 * Called when: used by start and createAgentSupervisor when that path needs this behavior.
 */
function setProcessHealth(process: "storage" | "agent", next: ProcessHealth) {
  health = { ...health, [process]: next };
  broadcast({ type: "process.health", health });
}

/**
 * What: performs the secure web preferences step for this file's workflow.
 *
 * Why: the Electron shell needs centralized startup, routing, and runtime coordination.
 * Called when: used by createWindow when that path needs this behavior.
 */
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
  /**
   * What: performs the call step for this file's workflow.
   *
   * Why: the Electron shell needs centralized startup, routing, and runtime coordination.
   * Called when: used by the enclosing workflow at the point this named step is required.
   */
  call<Name extends OperationName<typeof AgentOperations>>(
    operation: Name,
    ...args: OperationArgs<typeof AgentOperations, Name>
  ) {
    return agent.call(operation, ...args);
  },
};

/**
 * What: registers ipc with the host runtime.
 *
 * Why: the Electron shell needs centralized startup, routing, and runtime coordination.
 * Called when: used by start when that path needs this behavior.
 */
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
    getThemeCatalog: () => themeService.catalog(),
    selectTheme: (themeId) => themeService.select(themeId),
  });
}

/**
 * What: creates window with the dependencies and defaults this workflow expects.
 *
 * Why: the Electron shell needs centralized startup, routing, and runtime coordination.
 * Called when: used by start and index when that path needs this behavior.
 */
function createWindow() {
  const activeTheme = themeService.catalog().themes.find(
    (theme) => theme.id === themeService.catalog().activeThemeId,
  );
  if (!activeTheme) throw new Error("Canonical selected theme is missing");
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: activeTheme.colors.background,
    webPreferences: secureWebPreferences(),
  });
  const webContentsId = window.webContents.id;
  workspaceWindow = window;
  if (process.env.SCRIBE_E2E === "1") {
    window.webContents.once("did-finish-load", () => console.log("SCRIBE_E2E_READY"));
  }
  if (measureStartup) {
    window.webContents.once("did-finish-load", () => {
      const deadline = Date.now() + 30_000;
      /**
       * What: performs the collect step for this file's workflow.
       *
       * Why: the Electron shell needs centralized startup, routing, and runtime coordination.
       * Called when: used by createWindow when that path needs this behavior.
       */
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
    durableEvents.remove(webContentsId);
    if (workspaceWindow === window) workspaceWindow = undefined;
  });
  if (developmentServerUrl) void window.loadURL(developmentServerUrl);
  else void window.loadFile(join(here, "../dist/index.html"));
}

/**
 * What: performs the install development menu step for this file's workflow.
 *
 * Why: the Electron shell needs centralized startup, routing, and runtime coordination.
 * Called when: used by start when that path needs this behavior.
 */
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

/**
 * What: performs the flush renderer for shutdown step for this file's workflow.
 *
 * Why: the Electron shell needs centralized startup, routing, and runtime coordination.
 * Called when: used by index when that path needs this behavior.
 */
async function flushRendererForShutdown(window: BrowserWindow) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      window.webContents.executeJavaScript("window.scribeFlush?.()"),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Renderer shutdown flush timed out")),
          RENDERER_SHUTDOWN_FLUSH_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (error) {
    console.error("Renderer shutdown flush failed", error);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * What: starts the runtime task and wires the dependencies it needs.
 *
 * Why: the Electron shell needs centralized startup, routing, and runtime coordination.
 * Called when: used by index when that path needs this behavior.
 */
async function start() {
  themeService = new ThemeService(app.getPath("userData"));
  await themeService.initialize();
  const userDataPath = app.getPath("userData");
  const promptSnapshotPath = join(userDataPath, "agent-prompts-launch.json");
  await writeAgentPromptBootstrap(
    join(app.getAppPath(), "experience"),
    promptSnapshotPath,
  );
  const dbPath = join(userDataPath, "scribe.sqlite3");
  const agentDir = join(userDataPath, "pi");
  const storageEndpoint = {
    /**
     * What: performs the call step for this file's workflow.
     *
     * Why: the Electron shell needs centralized startup, routing, and runtime coordination.
     * Called when: used by the enclosing workflow at the point this named step is required.
     */
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
  /**
   * What: performs the retryable step for this file's workflow.
   *
   * Why: the Electron shell needs centralized startup, routing, and runtime coordination.
   * Called when: used by start and createAgentSupervisor when that path needs this behavior.
   */
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
      await process.call("hydrate", selectedScope);
    },
    classifyRetryable: retryable,
    onHealth: (next) => setProcessHealth("storage", next),
  });

  /**
   * What: creates agent supervisor with the dependencies and defaults this workflow expects.
   *
   * Why: the Electron shell needs centralized startup, routing, and runtime coordination.
   * Called when: used by switchDocumentAgent and start when that path needs this behavior.
   */
  const createAgentSupervisor = (scope: { projectId: string; documentId: string }) => new ProcessSupervisor({
    spawn: () => {
    const generation = ++agentGeneration;
    const documentWorkspace = join(
      userDataPath, "projects", scope.projectId, "documents", scope.documentId,
    );
    const sessionDirectory = join(documentWorkspace, ".pi", "sessions");
    return agent = spawnChild(
      join(here, "agent.js"),
      [documentWorkspace, agentDir, sessionDirectory, promptSnapshotPath],
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
  /**
   * What: performs the switch document agent step for this file's workflow.
   *
   * Why: the Electron shell needs centralized startup, routing, and runtime coordination.
   * Called when: used by start when that path needs this behavior.
   */
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
      if (typeof command === "object" && command !== null && "type" in command &&
        command.type === "inject-activity" && "count" in command &&
        Number.isInteger(command.count) && Number(command.count) >= 0 && Number(command.count) <= 500) {
        const now = Date.now();
        for (let index = 0; index < Number(command.count); index += 1) {
          const item = activity.add({ id: `e2e-activity-${index}`, kind: "message", timestamp: now + index,
            title: `Synthetic activity ${index}`, text: `Performance fixture ${index}` });
          broadcast({ type: "agent.activity", activity: item });
        }
        return { accepted: true };
      }
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
    else dialog.showErrorBox("ScribeAI could not start", error instanceof Error ? error.message : String(error));
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
    await Promise.allSettled(BrowserWindow.getAllWindows().map(flushRendererForShutdown));
    await Promise.allSettled([agent?.shutdown(), storage?.shutdown()]);
    app.exit(0);
  })();
});
