#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const RUNS = 5;
const electron = resolve("node_modules/.bin/electron");

async function measureRun() {
  const profile = await mkdtemp(resolve(tmpdir(), "scribe-startup-"));
  try {
    return await new Promise((resolveRun, reject) => {
      const child = spawn(
        electron,
        [".", "--measure-startup", `--user-data-dir=${profile}`],
        { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
      );
      let output = "";
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("Electron startup measurement exceeded 45 seconds"));
      }, 45_000);
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        output += chunk;
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        clearTimeout(timeout);
        const match = output.match(/^SCRIBE_STARTUP (.+)$/m);
        if (code !== 0 || !match) {
          reject(new Error(`Startup measurement failed (${code ?? "signal"})\n${output}`));
          return;
        }
        resolveRun(JSON.parse(match[1]));
      });
    });
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

const results = [];
for (let run = 1; run <= RUNS; run += 1) {
  const marks = await measureRun();
  const bootstrap = marks["scribe:bootstrap"];
  const result = {
    run,
    workspaceShellMs: marks["scribe:react-mounted"] - bootstrap,
    hydrationMs: marks["scribe:hydration-complete"] - bootstrap,
    editorReadyMs: marks["scribe:editor-ready"] - bootstrap,
  };
  results.push(result);
  console.log(JSON.stringify(result));
}

console.log(
  JSON.stringify({
    median: {
      workspaceShellMs: median(results.map((result) => result.workspaceShellMs)),
      hydrationMs: median(results.map((result) => result.hydrationMs)),
      editorReadyMs: median(results.map((result) => result.editorReadyMs)),
    },
  }),
);
