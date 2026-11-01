import { defineConfig } from "vite";
import { localApi } from "./tools/local-api.ts";
import { phoneSite, phoneBuild, phoneHosts } from "./tools/phone.ts";
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/phone/" : "/",
  build: {
    rollupOptions: { input: { main: "index.html", phone: "phone/index.html" } },
  },
  plugins: [phoneSite(), localApi(), phoneBuild()],
  server: {
    host: "127.0.0.1",
    port: 1460,
    strictPort: true,
    allowedHosts: phoneHosts(),
  },
  preview: {
    host: "127.0.0.1",
    port: 1460,
    strictPort: true,
    allowedHosts: phoneHosts(),
  },
}));
