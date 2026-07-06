import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktopRoot = join(root, "desktop");
const forbiddenRuntimeImports = /^(electron|node:|@earendil-works\/pi-coding-agent)/;

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

export function importSpecifiers(source) {
  return [...source.matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/g)]
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
});
