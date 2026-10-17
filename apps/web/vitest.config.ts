import { defineConfig } from "vitest/config";

// Unit tests are pure logic: no React plugin, no Node polyfills
export default defineConfig({ test: { environment: "node", include: ["src/**/*.test.ts"] } });
