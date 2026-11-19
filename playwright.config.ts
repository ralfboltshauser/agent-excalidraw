import { defineConfig } from "@playwright/test";

// Real Electron integration. Build first; on Linux run under xvfb-run.
export default defineConfig({
  testDir: "./tests",
  testMatch: "electron.e2e.ts",
  outputDir: "./artifacts/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "artifacts/e2e-report", open: "never" }],
  ],
  use: { trace: "retain-on-failure" },
});
