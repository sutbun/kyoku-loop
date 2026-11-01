import { defineConfig } from "vite";
import { localApi } from "./tools/local-api.ts";
export default defineConfig({
  plugins: [localApi()],
  server: { host: "127.0.0.1", port: 1460, strictPort: true },
  preview: { host: "127.0.0.1", port: 1460, strictPort: true },
});
