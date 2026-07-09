import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(root, "src");
const agentRoot = join(sourceRoot, "utility", "agent");
const rendererRoot = join(sourceRoot, "renderer");
const storageRoot = join(sourceRoot, "utility", "storage");
const forbiddenRuntimeImports = /^(electron|node:|@earendil-works\/pi-coding-agent)/;
const forbiddenRendererExternalImports = /^(electron|node:|fs|path|crypto|os|url|events|child_process|worker_threads|node:sqlite|better-sqlite3|@earendil-works\/pi-coding-agent(?:\/|$))/;

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) &&
      !/\.test\.(ts|tsx)$/.test(entry.name)
      ? [path]
      : [];
  });
}

export function importSpecifiers(source) {
  return [...source.matchAll(/(?:\bfrom\s+|^\s*import\s*)["']([^"']+)["']/gm)]
    .map((match) => match[1]);
}

export function prohibitedImports(layer, source) {
  return importSpecifiers(source).filter((specifier) => {
    if (forbiddenRuntimeImports.test(specifier)) return true;
    if (layer === "domain") {
      return specifier.includes("/application/") ||
        specifier.includes("/infrastructure/") ||
        specifier.includes("/storage/");
    }
    return specifier.includes("/infrastructure/") || specifier.includes("/storage/");
  });
}

export function prohibitedStorageApplicationImports(source) {
  return importSpecifiers(source).filter((specifier) =>
    forbiddenRuntimeImports.test(specifier) ||
    specifier.includes("/persistence/") ||
    specifier.includes("/workspace/") ||
    specifier.includes("/main/") ||
    specifier.includes("/preload/") ||
    specifier.includes("/renderer/") ||
    specifier.includes("/utility/agent/") ||
    specifier.includes("/desktop/"),
  );
}

export function prohibitedStorageUtilityImports(file, source) {
  return importSpecifiers(source).filter((specifier) => {
    if (specifier === "electron" ||
      specifier.startsWith("@earendil-works/pi-coding-agent")) {
      return true;
    }
    const resolved = resolvedRelativeImport(file, specifier);
    if (!resolved) return false;
    const relativeResolved = relativePath(resolved);
    return relativeResolved.startsWith("desktop/") ||
      relativeResolved.startsWith("src/renderer/") ||
      relativeResolved.startsWith("src/main/") ||
      relativeResolved.startsWith("src/preload/") ||
      relativeResolved.startsWith("src/utility/agent/");
  });
}

export function prohibitedStoragePersistenceImports(file, source) {
  return importSpecifiers(source).filter((specifier) => {
    if (specifier === "electron" ||
      specifier.startsWith("@earendil-works/pi-coding-agent")) {
      return true;
    }
    const resolved = resolvedRelativeImport(file, specifier);
    if (!resolved) return false;
    const relativeResolved = relativePath(resolved);
    return relativeResolved === "src/utility/storage/index" ||
      relativeResolved === "src/utility/storage/index.ts" ||
      relativeResolved === "src/utility/storage/service" ||
      relativeResolved === "src/utility/storage/service.ts" ||
      relativeResolved === "src/utility/storage/transport" ||
      relativeResolved === "src/utility/storage/transport.ts" ||
      relativeResolved.startsWith("desktop/") ||
      relativeResolved.startsWith("src/renderer/") ||
      relativeResolved.startsWith("src/main/") ||
      relativeResolved.startsWith("src/preload/") ||
      relativeResolved.startsWith("src/utility/agent/");
  });
}

export function prohibitedRuntimeNeutralImports(owner, source) {
  return importSpecifiers(source).filter((specifier) => {
    if (forbiddenRuntimeImports.test(specifier)) return true;
    const runtimePaths = ["/renderer/", "/main/", "/preload/", "/utility/", "/desktop/"];
    if (runtimePaths.some((segment) => specifier.includes(segment))) return true;
    if (owner === "domain") {
      return specifier.includes("/contracts/") ||
        specifier.includes("/application/") ||
        specifier.includes("/infrastructure/") ||
        specifier.includes("/storage/");
    }
    return specifier.includes("/application/") ||
      specifier.includes("/infrastructure/") ||
      specifier.includes("/storage/");
  });
}

export function prohibitedPreloadImports(source) {
  return importSpecifiers(source).filter((specifier) =>
    specifier !== "electron" &&
    !specifier.startsWith("./") &&
    !specifier.startsWith("../contracts/"),
  );
}

export function prohibitedRendererImports(file, source) {
  return importSpecifiers(source).filter((specifier) => {
    if (forbiddenRendererExternalImports.test(specifier)) return true;
    const resolved = resolvedRelativeImport(file, specifier);
    if (!resolved) return false;
    const relativeResolved = relativePath(resolved);
    return relativeResolved.startsWith("desktop/") ||
      relativeResolved.startsWith("src/main/") ||
      relativeResolved.startsWith("src/preload/") ||
      relativeResolved.startsWith("src/utility/") ||
      relativeResolved.startsWith("src/test/");
  });
}

function relativePath(path) {
  return relative(root, path).replaceAll("\\", "/");
}

function resolvedRelativeImport(file, specifier) {
  if (!specifier.startsWith(".")) return undefined;
  return resolve(dirname(file), specifier);
}

export function prohibitedAgentImports(file, source) {
  const relativeFile = relativePath(file);
  return importSpecifiers(source).filter((specifier) => {
    if (specifier === "@earendil-works/pi-coding-agent") {
      return !relativeFile.startsWith("src/utility/agent/pi/") &&
        relativeFile !== "src/utility/agent/extension.ts";
    }
    if (specifier === "electron") return true;
    if (specifier.startsWith("@earendil-works/pi-coding-agent/")) return true;
    const resolved = resolvedRelativeImport(file, specifier);
    if (!resolved) return false;
    const relativeResolved = relativePath(resolved);
    if (relativeResolved.startsWith("desktop/")) return true;
    if (relativeResolved.startsWith("src/renderer/")) return true;
    if (relativeResolved.startsWith("src/utility/") &&
      !relativeResolved.startsWith("src/utility/agent/")) return true;
    return false;
  });
}

describe("source dependency direction", () => {
  it("does not recreate obsolete source roots or duplicate canonical modules", () => {
    const obsoletePaths = [
      "desktop",
      "src/components",
      "src/workspace",
      "src/editor",
      "src/keybindings",
      "src/suggestions",
      "src/desktop",
      "src/shared",
      "src/performance",
      "src/architecture",
      "src/dev",
      "src/renderer/features/suggestions/WorkspacePins.tsx",
    ];
    const violations = obsoletePaths.filter((obsoletePath) =>
      existsSync(join(root, obsoletePath)),
    );
    expect(violations).toEqual([]);
  });

  it("renderer modules do not import Electron, Node, utility, main, or preload implementations", () => {
    const violations = sourceFiles(rendererRoot).flatMap((file) =>
      prohibitedRendererImports(file, readFileSync(file, "utf8"))
        .map((specifier) => `${relativePath(file)} -> ${specifier}`),
    );
    expect(violations).toEqual([]);
  });

  it("storage application modules do not import persistence, workspace, or runtime infrastructure", () => {
    const directory = join(storageRoot, "application");
    const violations = sourceFiles(directory).flatMap((file) =>
      prohibitedStorageApplicationImports(readFileSync(file, "utf8"))
        .map((specifier) => `${relative(root, file)} -> ${specifier}`),
    );
    expect(violations).toEqual([]);
  });

  it("storage utility modules do not import renderer, main, preload, agent, or desktop implementations", () => {
    const violations = sourceFiles(storageRoot).flatMap((file) =>
      prohibitedStorageUtilityImports(file, readFileSync(file, "utf8"))
        .map((specifier) => `${relativePath(file)} -> ${specifier}`),
    );
    expect(violations).toEqual([]);
  });

  it("storage persistence modules do not import storage composition roots or foreign runtimes", () => {
    const directory = join(storageRoot, "persistence");
    const violations = sourceFiles(directory).flatMap((file) =>
      prohibitedStoragePersistenceImports(file, readFileSync(file, "utf8"))
        .map((specifier) => `${relativePath(file)} -> ${specifier}`),
    );
    expect(violations).toEqual([]);
  });

  it("detects prohibited dependency examples", () => {
    expect(prohibitedImports("domain", `
      import { app } from "electron";
      import { readFile } from "node:fs/promises";
      import { SqliteRepository } from "../storage/repositories.js";
    `)).toEqual([
      "electron",
      "node:fs/promises",
      "../storage/repositories.js",
    ]);
    expect(prohibitedImports("application", `
      import { StorageService } from "../storage/service.js";
    `)).toEqual(["../storage/service.js"]);
    expect(prohibitedStorageApplicationImports(`
      import { DocumentRepository } from "../persistence/repositories.js";
      import { NodeWorkspaceFiles } from "../workspace/files.js";
    `)).toEqual([
      "../persistence/repositories.js",
      "../workspace/files.js",
    ]);
  });

  it.each(["domain", "contracts"])(
    "src/%s modules do not import runtime implementations",
    (owner) => {
      const directory = join(sourceRoot, owner);
      const violations = sourceFiles(directory).flatMap((file) =>
        prohibitedRuntimeNeutralImports(owner, readFileSync(file, "utf8"))
          .map((specifier) => `${relative(root, file)} -> ${specifier}`),
      );
      expect(violations).toEqual([]);
    },
  );

  it("detects prohibited runtime-neutral dependency examples", () => {
    expect(prohibitedRuntimeNeutralImports("domain", `
      import { app } from "electron";
      import { DesktopBridge } from "../../contracts/desktop-bridge.js";
      import { RendererController } from "../../renderer/features/workspace/controller.js";
    `)).toEqual([
      "electron",
      "../../contracts/desktop-bridge.js",
      "../../renderer/features/workspace/controller.js",
    ]);
    expect(prohibitedRuntimeNeutralImports("contracts", `
      import { readFile } from "node:fs/promises";
      import { StorageService } from "../../utility/storage/service.js";
    `)).toEqual([
      "node:fs/promises",
      "../../utility/storage/service.js",
    ]);
  });

  it("preload modules import only Electron, preload peers, and contracts", () => {
    const directory = join(sourceRoot, "preload");
    const violations = sourceFiles(directory).flatMap((file) =>
      prohibitedPreloadImports(readFileSync(file, "utf8"))
        .map((specifier) => `${relative(root, file)} -> ${specifier}`),
    );
    expect(violations).toEqual([]);
  });

  it("detects prohibited preload dependency examples", () => {
    expect(prohibitedPreloadImports(`
      import { ipcRenderer } from "electron";
      import { DesktopBridge } from "../contracts/desktop-bridge.js";
      import { WorkspaceController } from "../renderer/features/workspace/controller.js";
      import { ProcessSupervisor } from "../main/processes/process-supervisor.js";
    `)).toEqual([
      "../renderer/features/workspace/controller.js",
      "../main/processes/process-supervisor.js",
    ]);
  });

  it("detects prohibited renderer dependency examples", () => {
    expect(prohibitedRendererImports(join(rendererRoot, "app", "App.tsx"), `
      import { app } from "electron";
      import { readFile } from "node:fs/promises";
      import { MainProcess } from "../../main/index.js";
      import { StorageService } from "../../utility/storage/service.js";
      import { preload } from "../../preload/index.js";
    `)).toEqual([
      "electron",
      "node:fs/promises",
      "../../main/index.js",
      "../../utility/storage/service.js",
      "../../preload/index.js",
    ]);
  });

  it("agent utility modules do not import renderer, desktop, or foreign utility modules", () => {
    const violations = sourceFiles(agentRoot).flatMap((file) =>
      prohibitedAgentImports(file, readFileSync(file, "utf8"))
        .map((specifier) => `${relativePath(file)} -> ${specifier}`),
    );
    expect(violations).toEqual([]);
  });

  it("detects prohibited agent dependency examples", () => {
    expect(prohibitedAgentImports(join(agentRoot, "index.ts"), `
      import { app } from "electron";
      import { RendererController } from "../../renderer/features/workspace/controller.js";
      import { StorageService } from "../storage/service.js";
      import { LegacyPolicy } from "../../../desktop/domain/revisions.js";
      import { createAgentSession } from "@earendil-works/pi-coding-agent";
    `)).toEqual([
      "electron",
      "../../renderer/features/workspace/controller.js",
      "../storage/service.js",
      "../../../desktop/domain/revisions.js",
      "@earendil-works/pi-coding-agent",
    ]);
    expect(prohibitedAgentImports(join(agentRoot, "extension.ts"), `
      import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
    `)).toEqual([]);
    expect(prohibitedAgentImports(join(agentRoot, "pi", "runtime.ts"), `
      import { createAgentSession } from "@earendil-works/pi-coding-agent";
    `)).toEqual([]);
  });
});
