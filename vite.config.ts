import { defineConfig } from "vite";
import { localApi } from "./tools/local-api.ts";
import { phoneSite, phoneBuild, phoneHosts } from "./tools/phone.ts";
import { runtimeControl } from "./tools/runtime.ts";
import { phoneRuntime } from "./tools/phone-runtime.ts";
import { paipuyaURL } from "./tools/external-links.ts";
export default defineConfig(({ command }) => ({
  define: {
    "import.meta.env.VITE_KYOKULOOP_PAIPUYA_URL": JSON.stringify(paipuyaURL()),
  },
  base: command === "build" ? "/phone/" : "/",
  build: {
    rollupOptions: { input: { main: "index.html", phone: "phone/index.html" } },
  },
  plugins: [
    runtimeControl(),
    phoneSite(),
    phoneRuntime(),
    localApi(),
    phoneBuild(),
  ],
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
