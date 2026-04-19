import { defineConfig, mergeConfig } from "vitest/config";

import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      reporters: ["dot"],
    },
    define: {
      // Neutralise the env-var baking from vite.config.ts so that tests
      // always start with empty values. Individual tests can then control
      // the URL resolution via vi.stubEnv / vi.stubGlobal as needed.
      "import.meta.env.VITE_HTTP_URL": JSON.stringify(""),
      "import.meta.env.VITE_WS_URL": JSON.stringify(""),
    },
  }),
);
