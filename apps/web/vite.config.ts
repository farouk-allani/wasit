import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  plugins: [
    react(),
    // Passport's dependency tree (readable-stream, ethers, web3) expects Node globals in the
    // browser; this set is the one verified in the Passport spike (VERIFIED-FACTS)
    nodePolyfills({
      include: ["buffer", "process", "stream", "util", "events", "crypto"],
      globals: { Buffer: true, process: true, global: true },
    }),
  ],
});
