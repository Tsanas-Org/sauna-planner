import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" keeps the built site working from any sub-path (e.g. GitHub Pages)
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: { chunkSizeWarningLimit: 1000 }, // one page; three.js alone is most of the ~730 kB bundle
});
