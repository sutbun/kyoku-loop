import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { trackChild, registerBackgroundStop } from "./runtime.ts";

// Runs in the existing Windows process even when its browser tab is closed.
// A disabled/unconfigured inbox launches no background Python process.
export function startInbox(
  server: Pick<import("vite").ViteDevServer, "httpServer">,
) {
  let running = false,
    stopped = false;
  const settings = join(
    dirname(
      process.env.KYOKULOOP_DB ||
        "D:/dev-data/kyoku-loop/private/app/kyokuloop.sqlite3",
    ),
    "mortal-inbox-settings.json",
  );
  const failure = join(dirname(settings), "mortal-inbox-error.json");
  const timer = setInterval(() => {
    if (
      running ||
      stopped ||
      !server.httpServer?.listening ||
      existsSync(failure)
    )
      return;
    try {
      if (JSON.parse(readFileSync(settings, "utf8")).enabled !== true) return;
    } catch {
      return;
    }
    running = true;
    const child = spawn(
      process.env.KYOKULOOP_PYTHON || "python",
      [fileURLToPath(new URL("./p2_store.py", import.meta.url))],
      {
        stdio: ["pipe", "pipe", "ignore"],
        windowsHide: true,
      },
    );
    trackChild(child);
    let output = "",
      timedOut = false;
    child.stdout.on("data", (chunk) => {
      if (output.length < 65536) output += chunk.toString();
    });
    const failed = () => {
      try {
        writeFileSync(failure, '{"error":"inbox_service_error"}');
      } catch {}
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      failed();
      child.kill();
    }, 60000);
    const finish = () => {
      clearTimeout(timeout);
      running = false;
    };
    child.once("error", () => {
      failed();
      finish();
    });
    child.once("close", (code) => {
      try {
        if (timedOut || code !== 0 || !JSON.parse(output).ok) failed();
      } catch {
        failed();
      }
      finish();
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({ action: "inbox_scan" }));
  }, 5000);
  timer.unref();
  const stop = () => {
    stopped = true;
    clearInterval(timer);
  };
  const unregister = registerBackgroundStop(stop);
  server.httpServer?.once("close", () => {
    stop();
    unregister();
  });
  return stop;
}

// Vite and preview share one loopback port. No separate exposed API service.
function handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
  if (req.url !== "/api/local") return next();
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const deny = (status: number, error: string) => {
    res.statusCode = status;
    res.end(JSON.stringify({ ok: false, error }));
  };
  if (
    req.headers.host !== "127.0.0.1:1460" ||
    Object.keys(req.headers).some(
      (k) =>
        k.startsWith("tailscale-") ||
        k.startsWith("x-forwarded-") ||
        k === "forwarded",
    ) ||
    (req.headers.origin && req.headers.origin !== "http://127.0.0.1:1460") ||
    req.headers["sec-fetch-site"] === "cross-site" ||
    req.method !== "POST" ||
    !req.headers["content-type"]?.startsWith("application/json")
  )
    return deny(403, "local_only");
  const chunks: Buffer[] = [];
  let length = 0;
  req.on("data", (chunk: Buffer) => {
    length += chunk.length;
    if (length <= 29 * 1024 * 1024) chunks.push(chunk);
  });
  req.on("end", () => {
    if (length > 29 * 1024 * 1024) return deny(413, "size_limit");
    const child = spawn(
      process.env.KYOKULOOP_PYTHON || "python",
      [fileURLToPath(new URL("./p2_store.py", import.meta.url))],
      {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    trackChild(child);
    const output: Buffer[] = [];
    let outputSize = 0;
    let done = false;
    const finishError = () => {
      if (!done) {
        done = true;
        deny(500, "local_service_error");
      }
    };
    const timer = setTimeout(() => {
      child.kill();
      finishError();
    }, 60000);
    child.stdout.on("data", (chunk: Buffer) => {
      outputSize += chunk.length;
      if (outputSize > 50 * 1024 * 1024) {
        child.kill();
        finishError();
      } else output.push(chunk);
    });
    // stderr is intentionally discarded; raw data/tracebacks are never logged.
    child.stderr.resume();
    child.on("error", () => {
      clearTimeout(timer);
      finishError();
    });
    child.stdin.on("error", finishError);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (done) return;
      if (code !== 0) return finishError();
      try {
        const parsed = JSON.parse(Buffer.concat(output).toString("utf8"));
        done = true;
        res.end(JSON.stringify(parsed));
      } catch {
        finishError();
      }
    });
    child.stdin.end(Buffer.concat(chunks));
  });
}

export function localApi(): Plugin {
  return {
    name: "kyokuloop-private-local-api",
    configureServer(server) {
      startInbox(server);
      server.middlewares.use(handle);
    },
    configurePreviewServer(server) {
      startInbox(server);
      server.middlewares.use(handle);
    },
  };
}
