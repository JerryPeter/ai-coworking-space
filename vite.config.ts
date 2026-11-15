import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: Vite on 127.0.0.1:5173 proxies /api and /health to FastAPI on 127.0.0.1:8742, so the
// browser only talks to one origin (no CORS in dev).
// Prod: `npm run build` -> dist/, which FastAPI serves itself on :8742.
const API = "http://127.0.0.1:8742";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: API },
      "/health": { target: API },
    },
  },
  preview: { host: "127.0.0.1", port: 5173, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true },
});
