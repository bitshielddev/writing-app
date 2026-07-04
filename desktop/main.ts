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
import { registerMainIpc } from "./ipc-routing.js";
import {
  createAgentMessageHandler,
  createStorageMessageHandler,
} from "./process-messages.js";
import { runDesktopStartup, startDesktop } from "./startup.js";
import type {
  AgentRuntime,
  DesktopEvent,
} from "../src/shared/desktop.js";
import {
  DESKTOP_EVENT_CHANNEL,
  type ChildMessage,
} from "../src/shared/contracts.js";

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

function spawnChild(
  modulePath: string,
  args: string[],
  onMessage?: (message: ChildMessage) => void,
) {
  const child = utilityProcess.fork(modulePath, args, {
    cwd: app.getPath("userData"),
    stdio: "pipe",
    serviceName: modulePath.endsWith("agent.js")
      ? "ScribeAI Agent"
      : "ScribeAI Storage",
  });
  return new ChildRpc(child, randomUUID, onMessage);
}

function broadcast(event: DesktopEvent) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(DESKTOP_EVENT_CHANNEL, event);
  }
}

function setRuntime(update: Partial<AgentRuntime>) {
  runtime = { ...runtime, ...update };
  broadcast({ type: "agent.runtime", runtime });
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
    agent,
    development: isDevelopment,
    getRuntime: () => runtime,
    setRuntime: (nextRuntime) => {
      runtime = nextRuntime;
    },
    activitySnapshot: () => activity.snapshot(),
  });
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
  const handleStorageMessage = createStorageMessageHandler({
    storage: {
      call: <T,>(method: string, params?: unknown) =>
        storage.call<T>(method, params),
      post: (message) => storage.post(message),
    },
    getAgent: () => agent,
    broadcast,
  });
  const handleAgentMessage = createAgentMessageHandler({
    storage: {
      call: <T,>(method: string, params?: unknown) =>
        storage.call<T>(method, params),
      post: (message) => storage.post(message),
    },
    getAgent: () => agent,
    setRuntime,
    addActivity: (item) => activity.add(item),
    broadcast,
  });
  await startDesktop({
    spawnStorage: () => {
      storage = spawnChild(
        join(here, "storage.js"),
        [dbPath, projectWorkspace],
        (message) => void handleStorageMessage(message),
      );
      return storage;
    },
    spawnAgent: () => {
      agent = spawnChild(
        join(here, "agent.js"),
        [projectWorkspace, agentDir, sessionDirectory],
        (message) => void handleAgentMessage(message),
      );
      return agent;
    },
    registerIpc: () => registerIpc(),
    installMenu: installDevelopmentMenu,
    createWindow,
  });
}

void runDesktopStartup(
  async () => {
    await app.whenReady();
    await start();
  },
  (error) => {
    console.error("Desktop startup failed", error);
    app.quit();
  },
);

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
