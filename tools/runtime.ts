import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  mkdirSync,
  realpathSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { dirname, resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ChildProcess } from "node:child_process";
import type { Plugin, ViteDevServer } from "vite";
import { DEVELOPMENT_VERSION } from "../src/version.ts";

const children = new Set<ChildProcess>();
export function trackChild(child: ChildProcess) {
  children.add(child);
  child.once("close", () => children.delete(child));
  child.once("error", () => children.delete(child));
}
export function localControlAllowed(
  req: Pick<IncomingMessage, "headers" | "socket">,
) {
  return (
    ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
      req.socket.remoteAddress ?? "",
    ) &&
    req.headers.host === "127.0.0.1:1460" &&
    (!req.headers.origin || req.headers.origin === "http://127.0.0.1:1460") &&
    req.headers["sec-fetch-site"] !== "cross-site" &&
    !Object.keys(req.headers).some(
      (k) =>
        k.startsWith("tailscale-") ||
        k.startsWith("x-forwarded-") ||
        k === "forwarded",
    )
  );
}
export function createRuntimeControl(
  meta: { role: string; version: string; source_sha: string },
  stop: () => Promise<void>,
  childCount = () => children.size,
) {
  const token = randomBytes(32).toString("hex");
  let active = 0,
    draining = false;
  const health = () => ({
    app: "kyoku-loop",
    pid: process.pid,
    ...meta,
    active_requests: active,
    active_children: childCount(),
    draining,
  });
  const handle = (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ) => {
    const path = (req.url ?? "").split("?")[0];
    if (path === "/api/health" || path === "/api/runtime") {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "application/json");
      const reply = (status: number, body: object) => {
        res.statusCode = status;
        res.end(JSON.stringify(body));
      };
      if (!localControlAllowed(req)) return reply(403, { error: "local_only" });
      if (path === "/api/health" && req.method === "GET")
        return reply(200, health());
      if (
        path !== "/api/runtime" ||
        req.method !== "POST" ||
        !req.headers["content-type"]?.startsWith("application/json")
      )
        return reply(403, { error: "invalid_control" });
      let body = "",
        oversized = false;
      req.on("data", (chunk) => {
        if (Buffer.byteLength(body) + chunk.length > 1024) oversized = true;
        else body += chunk;
      });
      req.on("end", () => {
        let input: Record<string, unknown>;
        try {
          input = JSON.parse(body);
        } catch {
          return reply(400, { error: "invalid_control" });
        }
        const candidate =
          typeof input?.token === "string"
            ? Buffer.from(input.token)
            : Buffer.alloc(0);
        if (
          oversized ||
          input?.action !== "stop" ||
          candidate.length !== 64 ||
          !timingSafeEqual(candidate, Buffer.from(token))
        )
          return reply(403, { error: "invalid_control" });
        if (active || childCount()) return reply(409, { error: "busy" });
        if (draining) return reply(409, { error: "stopping" });
        draining = true;
        res.once("finish", () => {
          setImmediate(() => void stop());
        });
        return reply(200, { stopping: true });
      });
      return;
    }
    if (draining) {
      res.statusCode = 503;
      res.end("Stopping");
      return;
    }
    if (path === "/api/local" || path === "/phone/api") {
      active++;
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          active--;
        }
      };
      res.once("finish", finish);
      res.once("close", finish);
    }
    next();
  };
  return { token, health, handle };
}
export function runtimeControl(): Plugin {
  function configure(server: Pick<ViteDevServer, "httpServer" | "close">) {
    const role = process.env.KYOKULOOP_DAILY === "1" ? "daily" : "development";
    const source_sha = process.env.KYOKULOOP_SOURCE_SHA ?? "";
    if (role === "daily" && !/^[a-f0-9]{40}$/.test(source_sha))
      throw new Error("Missing release identity");
    const meta = {
      role,
      source_sha,
      version:
        role === "daily"
          ? DEVELOPMENT_VERSION.replace(/^DEV-/, "")
          : DEVELOPMENT_VERSION,
    };
    const file = resolve(
      process.env.KYOKULOOP_CONTROL_FILE ??
        "D:/dev-data/kyoku-loop/private/app/runtime-control.json",
    );
    const root = resolve("D:/dev-data/kyoku-loop/private");
    if (!file.startsWith(root + sep))
      throw new Error("Private runtime control required");
    const cleanup = () => {
      try {
        if (JSON.parse(readFileSync(file, "utf8")).token === control.token)
          unlinkSync(file);
      } catch {}
    };
    const control = createRuntimeControl(meta, async () => {
      await server.close();
      cleanup();
      process.exit(0);
    });
    const publish = () => {
      mkdirSync(dirname(file), { recursive: true });
      if (!realpathSync(dirname(file)).startsWith(root + sep))
        throw new Error("Invalid runtime path");
      writeFileSync(
        file,
        JSON.stringify({ ...control.health(), token: control.token }),
        { mode: 0o600 },
      );
    };
    if (server.httpServer?.listening) publish();
    else server.httpServer?.once("listening", publish);
    server.httpServer?.once("close", cleanup);
    return control.handle;
  }
  return {
    name: "kyokuloop-runtime",
    configureServer(s) {
      s.middlewares.use(configure(s));
    },
    configurePreviewServer(s) {
      s.middlewares.use(configure(s));
    },
  };
}
