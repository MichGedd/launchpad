import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  server: {
    proxy: {
      "/api": {
        target: process.env.LAUNCHPAD_API_TARGET ?? "http://127.0.0.1:5174",
      },
    },
  },
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./app", import.meta.url)),
    },
  },
});
