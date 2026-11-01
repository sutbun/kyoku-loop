import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

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
      "python",
      [fileURLToPath(new URL("./p2_store.py", import.meta.url))],
      {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
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
      server.middlewares.use(handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handle);
    },
  };
}
