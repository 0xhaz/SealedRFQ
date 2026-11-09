import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Only here to teach vitest the `@/` alias that tsconfig and Next already understand. Without it a
 * test cannot import anything under `app/`, which means route handlers go untested — and the agent
 * card route is one whose exact bytes matter.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
});
