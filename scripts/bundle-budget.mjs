#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const MODULE_PATH = import.meta.url.startsWith("file:")
  ? fileURLToPath(import.meta.url)
  : undefined;
const ROOT = MODULE_PATH ? resolve(dirname(MODULE_PATH), "..") : process.cwd();
const DEFAULT_DIST = resolve(ROOT, "dist");
const DEFAULT_BUDGET = resolve(ROOT, "bundle-budget.json");

function unique(values) {
  return [...new Set(values)];
}

export function findInitialFiles(manifest) {
  const entries = Object.entries(manifest).filter(([, item]) => item.isEntry);
  const initialKeys = new Set();

  function visit(key) {
    if (initialKeys.has(key)) return;
    const item = manifest[key];
    if (!item) throw new Error(`Manifest import ${key} is missing`);
    initialKeys.add(key);
    for (const importedKey of item.imports ?? []) visit(importedKey);
  }

  for (const [key] of entries) visit(key);
  return new Set([...initialKeys].map((key) => manifest[key].file));
}

function sumSizes(items) {
  return items.reduce(
    (total, item) => ({
      rawBytes: total.rawBytes + item.rawBytes,
      gzipBytes: total.gzipBytes + item.gzipBytes,
      brotliBytes: total.brotliBytes + item.brotliBytes,
    }),
    { rawBytes: 0, gzipBytes: 0, brotliBytes: 0 },
  );
}

async function sizeFile(distDir, file) {
  const contents = await readFile(resolve(distDir, file));
  return {
    file,
    rawBytes: contents.byteLength,
    gzipBytes: gzipSync(contents, { level: 9 }).byteLength,
    brotliBytes: brotliCompressSync(contents).byteLength,
  };
}

export async function collectBundleStats(distDir = DEFAULT_DIST) {
  const [manifestText, metadataText] = await Promise.all([
    readFile(resolve(distDir, ".vite/manifest.json"), "utf8"),
    readFile(resolve(distDir, ".vite/bundle-metadata.json"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);
  const metadata = JSON.parse(metadataText);
  const initialFiles = findInitialFiles(manifest);
  const desktopMain =
    resolve(distDir) === DEFAULT_DIST
      ? await readFile(resolve(ROOT, "dist-electron/main.js"), "utf8")
      : undefined;
  const entryFiles = new Set(
    Object.values(manifest)
      .filter((item) => item.isEntry)
      .map((item) => item.file),
  );
  const javascriptFiles = unique(
    metadata.chunks.map((chunk) => chunk.file).filter((file) => file.endsWith(".js")),
  );
  const chunks = await Promise.all(
    javascriptFiles.map((file) => sizeFile(distDir, file)),
  );
  const initialChunks = chunks.filter((chunk) => initialFiles.has(chunk.file));
  const lazyChunks = chunks.filter((chunk) => !initialFiles.has(chunk.file));
  const entryChunks = chunks.filter((chunk) => entryFiles.has(chunk.file));

  return {
    entry: sumSizes(entryChunks),
    initial: sumSizes(initialChunks),
    lazy: sumSizes(lazyChunks),
    largest: [...chunks]
      .sort((left, right) => right.rawBytes - left.rawBytes)
      .slice(0, 5),
    chunks,
    metadata,
    initialFiles: [...initialFiles].sort(),
    desktopMain,
  };
}

export function budgetViolations(stats, budget) {
  const checks = [
    ["entry raw", stats.entry.rawBytes, budget.entry.rawBytes],
    ["entry gzip", stats.entry.gzipBytes, budget.entry.gzipBytes],
    ["initial raw", stats.initial.rawBytes, budget.initial.rawBytes],
    ["initial gzip", stats.initial.gzipBytes, budget.initial.gzipBytes],
  ];
  return checks
    .filter(([, actual, limit]) => actual > limit)
    .map(([label, actual, limit]) => ({ label, actual, limit }));
}

export function productionViolations(stats) {
  const initialFiles = new Set(stats.initialFiles);
  const initialMermaidModules = stats.metadata.chunks
    .filter((chunk) => initialFiles.has(chunk.file))
    .flatMap((chunk) =>
      chunk.modules
        .filter((module) => /\/node_modules\/mermaid\//.test(module.id))
        .map((module) => module.id),
    );
  return [
    ...initialMermaidModules.map((module) =>
      `Mermaid module present in initial graph: ${module}`,
    ),
  ];
}

function kib(bytes) {
  return `${(bytes / 1024).toFixed(2)} KiB`;
}

function printSummary(stats, budget) {
  const rows = [
    { scope: "Entry", ...stats.entry },
    { scope: "Initial", ...stats.initial },
    { scope: "Lazy", ...stats.lazy },
  ];
  console.table(
    rows.map((row) => ({
      scope: row.scope,
      raw: kib(row.rawBytes),
      gzip: kib(row.gzipBytes),
      brotli: kib(row.brotliBytes),
    })),
  );
  console.log("Largest JavaScript chunks:");
  console.table(
    stats.largest.map((chunk) => ({
      file: chunk.file,
      raw: kib(chunk.rawBytes),
      gzip: kib(chunk.gzipBytes),
      initial: findChunkIsInitial(stats, chunk.file),
    })),
  );
  if (budget) {
    console.log(
      `Initial budget: ${kib(budget.initial.rawBytes)} raw / ${kib(budget.initial.gzipBytes)} gzip`,
    );
  }
}

function findChunkIsInitial(stats, file) {
  const entryFiles = stats.metadata.chunks
    .filter((chunk) => chunk.entry)
    .map((chunk) => chunk.file);
  const byFile = new Map(stats.metadata.chunks.map((chunk) => [chunk.file, chunk]));
  const visited = new Set();
  const visit = (candidate) => {
    if (visited.has(candidate)) return;
    visited.add(candidate);
    for (const imported of byFile.get(candidate)?.imports ?? []) visit(imported);
  };
  for (const entry of entryFiles) visit(entry);
  return visited.has(file);
}

function printAttribution(stats) {
  console.log("Largest modules in the five largest chunks:");
  const metadataByFile = new Map(
    stats.metadata.chunks.map((chunk) => [chunk.file, chunk]),
  );
  for (const chunk of stats.largest) {
    console.log(`\n${chunk.file}`);
    console.table(
      (metadataByFile.get(chunk.file)?.modules ?? []).slice(0, 10).map((module) => ({
        module: module.id.replace(`${ROOT}/`, ""),
        rendered: kib(module.renderedBytes),
      })),
    );
  }
}

async function main() {
  const report = process.argv.includes("--report");
  const check = process.argv.includes("--check");
  if (!report && !check) {
    throw new Error("Use --check or --report");
  }
  const stats = await collectBundleStats();
  const budget = JSON.parse(await readFile(DEFAULT_BUDGET, "utf8"));
  printSummary(stats, budget);
  if (report) printAttribution(stats);

  if (check) {
    const violations = budgetViolations(stats, budget);
    const policyViolations = productionViolations(stats);
    if (violations.length || policyViolations.length) {
      for (const violation of violations) {
        console.error(
          `Budget exceeded: ${violation.label} is ${violation.actual} bytes (limit ${violation.limit})`,
        );
      }
      for (const violation of policyViolations) console.error(violation);
      process.exitCode = 1;
    } else {
      console.log("Renderer bundle is within budget.");
    }
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === MODULE_PATH) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
