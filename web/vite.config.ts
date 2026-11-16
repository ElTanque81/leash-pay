import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // The demo invoices live in agent/demo-invoices and are imported as raw text.
  server: { fs: { allow: [".."] } },
});
