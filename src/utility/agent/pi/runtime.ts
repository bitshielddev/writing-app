import { join } from "node:path";

import {
  AuthStorage,
  createAgentSession,
  createEventBus,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";

import type { AgentSessionPort } from "../application/session-port.js";
import { PiAgentSessionAdapter } from "./session.js";

export type PiEventBus = ReturnType<typeof createEventBus>;

/**
 * What: creates pi event bus with the dependencies and defaults this workflow expects.
 *
 * Why: agent workflows need coordinated runtime, storage, and activity reporting behavior.
 * Called when: used by index when that path needs this behavior.
 */
export function createPiEventBus(): PiEventBus {
  return createEventBus();
}

/**
 * What: creates pi agent runtime with the dependencies and defaults this workflow expects.
 *
 * Why: agent workflows need coordinated runtime, storage, and activity reporting behavior.
 * Called when: used by index and initialize when that path needs this behavior.
 */
export async function createPiAgentRuntime({
  workspaceRoot,
  agentDir,
  sessionDirectory,
  eventBus,
  extensionFactory,
  scribeToolNames,
  systemAppendPrompt,
}: {
  workspaceRoot: string;
  agentDir: string;
  sessionDirectory: string;
  eventBus: PiEventBus;
  extensionFactory: ExtensionFactory;
  scribeToolNames: readonly string[];
  systemAppendPrompt: string;
}): Promise<{
  session: AgentSessionPort;
  diagnostics: string[];
}> {
  const settingsManager = SettingsManager.create(workspaceRoot, agentDir, {
    projectTrusted: true,
  });
  const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
  const modelRegistry = ModelRegistry.create(authStorage, join(agentDir, "models.json"));
  const resourceLoader = new DefaultResourceLoader({
    cwd: workspaceRoot,
    agentDir,
    settingsManager,
    eventBus,
    extensionFactories: [extensionFactory],
    noExtensions: true,
    appendSystemPrompt: [systemAppendPrompt],
  });
  await resourceLoader.reload({ resolveProjectTrust: async () => true });
  const sessionManager = SessionManager.continueRecent(workspaceRoot, sessionDirectory);
  const created = await createAgentSession({
    cwd: workspaceRoot,
    agentDir,
    authStorage,
    modelRegistry,
    settingsManager,
    resourceLoader,
    sessionManager,
    tools: ["read", "grep", "find", "ls", ...scribeToolNames],
    excludeTools: ["bash", "write", "edit"],
  });
  const diagnostics = [
    ...settingsManager.drainErrors().map((item) => item.error.message),
    ...authStorage.drainErrors().map((error) => error.message),
    modelRegistry.getError(),
    ...created.extensionsResult.errors.map((item) => item.error),
  ].filter((item): item is string => Boolean(item));
  const activeTools = created.session.getActiveToolNames().sort();
  const expectedTools = ["find", "grep", "ls", "read", ...scribeToolNames].sort();
  if (JSON.stringify(activeTools) !== JSON.stringify(expectedTools)) {
    diagnostics.push(`Unsafe or incomplete Pi tool set: ${activeTools.join(", ")}`);
  }
  if (!created.session.model) diagnostics.push("No Pi model is configured in settings.json or models.json");
  else if (!modelRegistry.hasConfiguredAuth(created.session.model)) {
    diagnostics.push(`No credentials are configured for ${created.session.model.provider}`);
  }

  return {
    session: new PiAgentSessionAdapter(created.session),
    diagnostics,
  };
}
