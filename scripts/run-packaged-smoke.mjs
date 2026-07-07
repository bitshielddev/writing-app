import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const unpacked = resolve("release", process.platform === "darwin" ? "mac-arm64" : process.platform === "win32" ? "win-unpacked" : "linux-unpacked");
const entries = await readdir(unpacked);
const appBundle = entries.find((name) => name.endsWith(".app"));
const candidate = entries.find((name) => process.platform === "win32" ? name === "ScribeAI.exe" : name === "scribe-ai-writing-app");
if (process.platform === "darwin" && !appBundle) throw new Error("Packaged .app was not found");
if (process.platform !== "darwin" && !candidate) throw new Error("Packaged executable was not found");
const executable = process.platform === "darwin"
  ? join(unpacked, appBundle, "Contents", "MacOS", "ScribeAI")
  : join(unpacked, candidate);
const profile = await mkdtemp(join(tmpdir(), "scribe-packaged-smoke-"));
const args = [`--user-data-dir=${profile}`];
if (process.platform === "linux") args.push("--no-sandbox");
const child = spawn(executable, args, {
  env: { ...process.env, SCRIBE_E2E: "1" }, stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { output += chunk; });
const deadline = Date.now() + 30_000;
while (!output.includes("SCRIBE_E2E_READY") && Date.now() < deadline && child.exitCode === null) {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
}
if (child.exitCode === null) {
  const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
  child.kill("SIGKILL");
  await exited;
}
if (!output.includes("SCRIBE_E2E_READY")) throw new Error(`Packaged application did not become ready:\n${output}`);
await rm(profile, { recursive: true, force: true });
console.log("Packaged application created and loaded its workspace window.");
