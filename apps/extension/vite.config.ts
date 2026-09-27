import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { resolve } from "node:path";
import "dotenv/config";
export default defineConfig({
  root: resolve("apps/extension"),
  plugins: [react(), tailwind()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: { react: ["react", "react-dom"], validation: ["zod"] },
      },
      input: {
        sidepanel: resolve("apps/extension/sidepanel.html"),
        options: resolve("apps/extension/options.html"),
        popup: resolve("apps/extension/popup.html"),
      },
    },
  },
  server: { host: "127.0.0.1", port: 5173 },
});
