import type { ObservationSeed } from "../src/shared/desktop.js";

export type DesktopProcess = {
  ready: Promise<void>;
  call<T>(method: string, params?: unknown): Promise<T>;
  post(message: unknown): void;
  kill(): void;
};

export async function startDesktop({
  spawnStorage,
  spawnAgent,
  registerIpc,
  installMenu,
  createWindow,
}: {
  spawnStorage: () => DesktopProcess;
  spawnAgent: () => DesktopProcess;
  registerIpc: (storage: DesktopProcess, agent: DesktopProcess) => void;
  installMenu: () => void;
  createWindow: () => void;
}) {
  const storage = spawnStorage();
  await storage.ready;
  await storage.call("workspace.repair");

  const agent = spawnAgent();
  await agent.ready;

  registerIpc(storage, agent);
  installMenu();
  createWindow();

  const seed = await storage.call<ObservationSeed>("agent.seed");
  agent.post({
    kind: "project.changed",
    projectRevision: seed.projectRevision,
    documentRevision: seed.documentRevision,
  });
  return { storage, agent };
}

export async function runDesktopStartup(
  start: () => Promise<unknown>,
  onFailure: (error: unknown) => void,
) {
  try {
    await start();
  } catch (error) {
    onFailure(error);
  }
}
