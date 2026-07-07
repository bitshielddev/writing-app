import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { outputFolder: "test-results/report", open: "never" }]],
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
  outputDir: "test-results/artifacts",
});
