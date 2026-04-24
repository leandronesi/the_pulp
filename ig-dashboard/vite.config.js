import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import chatPlugin from "./scripts/chat-plugin.js";

// base si può override via env VITE_PUBLIC_PATH (es. "/the_pulp/" per GitHub Pages).
// Default "/" ok per localhost e deploy a root.
export default defineConfig(({ mode }) => {
  // Carica .env nel process.env così il chat-plugin (middleware Node) legge
  // OPENAI_API_KEY, TURSO_*. In prod/build questo è un no-op di fatto.
  const env = loadEnv(mode, process.cwd(), "");
  for (const k of Object.keys(env)) {
    if (!process.env[k]) process.env[k] = env[k];
  }

  return {
    plugins: [react(), chatPlugin()],
    base: process.env.VITE_PUBLIC_PATH || "/",
    server: { port: 5180, open: true, strictPort: true },
  };
});
