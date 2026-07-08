import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktopRoot = join(root, "desktop");
const sourceRoot = join(root, "src");
const forbiddenRuntimeImports = /^(electron|node:|@earendil-works\/pi-coding-agent)/;

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
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

describe("desktop dependency direction", () => {
  it.each(["domain", "application"])(
    "%s modules do not import runtime infrastructure",
    (layer) => {
      const directory = join(desktopRoot, layer);
      const violations = sourceFiles(directory).flatMap((file) =>
        prohibitedImports(layer, readFileSync(file, "utf8"))
          .map((specifier) => `${relative(root, file)} -> ${specifier}`),
      );
      expect(violations).toEqual([]);
    },
  );

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
      import { PiSession } from "../infrastructure/agent/pi-agent-session.js";
    `)).toEqual(["../infrastructure/agent/pi-agent-session.js"]);
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
});
