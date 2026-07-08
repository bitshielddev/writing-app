import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
function discoverModules(directory = sourceRoot) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return discoverModules(path);
    if (!/\.(?:ts|tsx)$/.test(entry.name) || /\.test\.(?:ts|tsx)$/.test(entry.name)) return [];
    return [relative(sourceRoot, path).replaceAll("\\", "/")];
  });
}

const targetModules = discoverModules();

function resolveImport(importer, specifier) {
  if (!specifier.startsWith(".")) return undefined;
  const base = resolve(sourceRoot, dirname(importer), specifier);
  const candidates = extname(base)
    ? [base]
    : [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")];
  const match = candidates.find((candidate) => {
    try {
      readFileSync(candidate);
      return true;
    } catch {
      return false;
    }
  });
  return match ? relative(sourceRoot, match).replaceAll("\\", "/") : undefined;
}

function importsFor(module) {
  const source = readFileSync(join(sourceRoot, module), "utf8");
  return [...source.matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/g)].flatMap(
    (match) => {
      const dependency = resolveImport(module, match[1]);
      return dependency && targetModules.includes(dependency) ? [dependency] : [];
    },
  );
}

function findCycle() {
  const visiting = new Set();
  const visited = new Set();
  const path = [];
  const visit = (module) => {
    if (visiting.has(module)) return [...path.slice(path.indexOf(module)), module];
    if (visited.has(module)) return undefined;
    visiting.add(module);
    path.push(module);
    for (const dependency of importsFor(module)) {
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    path.pop();
    visiting.delete(module);
    visited.add(module);
    return undefined;
  };
  for (const module of targetModules) {
    const cycle = visit(module);
    if (cycle) return cycle;
  }
  return undefined;
}

describe("source module boundaries", () => {
  it("discovers the src tree and contains no import cycles", () => {
    expect(targetModules).toContain("contracts/process-messages.ts");
    expect(targetModules).toContain("domain/suggestions/aggregate.ts");
    expect(findCycle()).toBeUndefined();
  });
});
