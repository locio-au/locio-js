import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // No DOM: this client runs in a browser, a worker and on a server, and a
    // test suite that needs jsdom would be testing something narrower than the
    // thing being shipped.
    environment: "node",
    globals: true,
  },
});
