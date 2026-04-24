import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base si può override via env VITE_PUBLIC_PATH (es. "/the_pulp/" per GitHub Pages).
// Default "/" ok per localhost e deploy a root.
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_PUBLIC_PATH || "/",
  server: { port: 5180, open: true, strictPort: true },
});
