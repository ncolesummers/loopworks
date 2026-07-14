import { defineConfig, devices } from "@playwright/test";

import baseConfig from "./playwright.config";
import { validationScreenshotViewports } from "./src/lib/loops/screenshot-evidence";

export default defineConfig({
  ...baseConfig,
  outputDir: "test-results/validation-evidence",
  projects: validationScreenshotViewports.map(({ name, width, height }) => ({
    name: `validation-${name}`,
    testMatch: /(?:auth-guard|portal)\.spec\.ts/,
    use: {
      ...devices["Desktop Chrome"],
      viewport: { width, height },
    },
  })),
  use: {
    ...baseConfig.use,
    screenshot: "on",
  },
});
