import { _electron as electron, test, type ElectronApplication } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("measures warmed renderer work", async () => {
  test.setTimeout(90_000);
  const profile = await mkdtemp(join(tmpdir(), "scribe-perf-"));
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ args: [resolve("."), `--user-data-dir=${profile}`],
      env: { ...process.env, SCRIBE_E2E: "1" } });
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.scribeTest?.readiness());
    await page.evaluate(() => {
      const durations: number[] = [];
      new PerformanceObserver((list) => durations.push(...list.getEntries().map((entry) => entry.duration)))
        .observe({ type: "longtask" });
      Object.assign(window, { __scribeLongTasks: durations });
    });
    const editor = page.locator(".bn-editor[contenteditable=true]").first();
    await editor.fill("Renderer performance fixture");
    await page.evaluate(() => window.scribeFlush?.());
    await page.evaluate(() => window.scribeTest!.injectActivity(500));
    await page.waitForTimeout(250);
    const durations = await page.evaluate(() => (window as unknown as { __scribeLongTasks: number[] }).__scribeLongTasks);
    const result = { longTasks: durations.length, maxLongTaskMs: Math.max(0, ...durations), durations };
    console.log(JSON.stringify(result));
    test.expect(result.longTasks).toBe(0);
  } finally {
    await app?.close().catch(() => undefined);
    await rm(profile, { recursive: true, force: true });
  }
});
