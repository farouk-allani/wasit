import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests are pure logic: no React plugin, no Node polyfills
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
