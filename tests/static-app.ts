import { test as base } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
// These cases already supply their own /api/local via a generated private DB.
// Serve this checkout's production assets without touching a running user app.
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route("**/*", async (route) => {
      const u = new URL(route.request().url());
      const path = u.pathname.startsWith("/phone/assets/")
        ? u.pathname.slice(6)
        : u.pathname.endsWith("/")
          ? u.pathname + "index.html"
          : u.pathname;
      const file = resolve("dist", "." + path);
      if (file.startsWith(resolve("dist")) && existsSync(file))
        return route.fulfill({ path: file });
      return route.abort();
    });
    await use(page);
  },
});

// A static fixture must never install a worker that could fetch from the daily app.
test.use({ serviceWorkers: "block" });
