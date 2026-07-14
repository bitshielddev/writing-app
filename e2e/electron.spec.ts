import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test.describe.configure({ mode: "serial" });

async function launch(profile: string) {
  const app = await electron.launch({
    args: [resolve("."), `--user-data-dir=${profile}`],
    env: { ...process.env, SCRIBE_E2E: "1" },
  });
  const page = await app.firstWindow();
  await page.waitForFunction(() => window.scribeTest?.readiness());
  return { app, page };
}

async function waitForHealth(page: Page, process: "storage" | "agent", state: string) {
  await expect.poll(() => page.evaluate(async ({ process, state }) =>
    (await window.scribeTest!.readiness()).health[process].state === state,
  { process, state })).toBe(true);
}

async function editableEditor(page: Page) {
  const editor = page.locator(".bn-editor[contenteditable=true]").first();
  await expect(editor).toBeEditable();
  return editor;
}

test("built app starts, persists edits, and recovers utility processes", async () => {
  test.setTimeout(90_000);
  const profile = await mkdtemp(join(tmpdir(), "scribe-e2e-"));
  let app: ElectronApplication | undefined;
  try {
    ({ app } = await launch(profile));
    let page = await app.firstWindow();
    await waitForHealth(page, "storage", "healthy");
    await waitForHealth(page, "agent", "healthy");
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("radio", { name: /Nord/ }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("nord");
    await page.getByRole("button", { name: "Close settings" }).click();
    const editor = await editableEditor(page);
    await editor.fill("Persistent e2e draft");
    await page.evaluate(() => window.scribeFlush?.());

    await page.evaluate(() => window.scribeTest!.terminateAgent());
    await expect.poll(() => page.evaluate(async () =>
      (await window.scribeTest!.readiness()).health.agent.state,
    )).toMatch(/degraded|restarting|healthy/);
    await waitForHealth(page, "agent", "healthy");
    await expect(editor).toBeEditable();

    await page.evaluate(() => window.scribeTest!.terminateStorage());
    await expect(page.getByRole("alert")).toContainText("Storage is unavailable");
    await waitForHealth(page, "storage", "healthy");

    await app.close();
    app = undefined;
    ({ app, page } = await launch(profile));
    await waitForHealth(page, "storage", "healthy");
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("nord");
    await expect(await editableEditor(page)).toContainText("Persistent e2e draft", { timeout: 15_000 });
  } finally {
    await app?.close().catch(() => undefined);
    if (!test.info().errors.length) await rm(profile, { recursive: true, force: true });
    else console.error(`Retained failed E2E profile: ${profile}`);
  }
});
