import { readFileSync, existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { trackChild } from "./runtime.ts";
import { runtimeManifest } from "./phone-runtime.ts";

type Access = { origin: string; login: string };
export function phoneAllowed(
  req: Pick<IncomingMessage, "headers" | "socket">,
  access: Access | null,
) {
  const h = req.headers;
  const forwarded = Object.keys(h).some(
    (k) =>
      k.startsWith("tailscale-") ||
      k.startsWith("x-forwarded-") ||
      k === "forwarded",
  );
  const loopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
    req.socket.remoteAddress ?? "",
  );
  if (!loopback) return false;
  if (!forwarded && h.host === "127.0.0.1:1460")
    return !h.origin || h.origin === "http://127.0.0.1:1460";
  if (
    !access ||
    typeof access.origin !== "string" ||
    typeof access.login !== "string" ||
    !access.login
  )
    return false;
  let origin: URL;
  try {
    origin = new URL(access.origin);
  } catch {
    return false;
  }
  if (origin.protocol !== "https:" || origin.origin !== access.origin)
    return false;
  return (
    h["tailscale-user-login"] === access.login &&
    h.host === origin.host &&
    (!h.origin || h.origin === access.origin)
  );
}
function access(): Access | null {
  try {
    return JSON.parse(
      readFileSync(
        process.env.KYOKULOOP_PHONE_ACCESS_FILE ||
          "D:/dev-data/kyoku-loop/private/phone-access.json",
        "utf8",
      ).replace(/^\uFEFF/, ""),
    );
  } catch {
    return null;
  }
}
export function phoneHosts(): string[] {
  try {
    const cfg = access();
    if (!cfg) return [];
    const url = new URL(cfg.origin);
    return url.protocol === "https:" ? [url.hostname] : [];
  } catch {
    return [];
  }
}
function callPhone(res: ServerResponse, payload: object) {
  const child = spawn(
    process.env.KYOKULOOP_PYTHON || "python",
    [fileURLToPath(new URL("./p2_store.py", import.meta.url))],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  trackChild(child);
  const chunks: Buffer[] = [];
  let bytes = 0;
  let done = false;
  const end = (status: number, body: string) => {
    if (!done) {
      done = true;
      res.statusCode = status;
      res.end(body);
    }
  };
  const timer = setTimeout(() => {
    child.kill();
    end(503, '{"ok":false,"error":"local_service_error"}');
  }, 60000);
  child.stdout.on("data", (b: Buffer) => {
    bytes += b.length;
    if (bytes > 25 * 1024 * 1024) {
      child.kill();
      end(413, '{"ok":false,"error":"pack_large"}');
    } else chunks.push(b);
  });
  child.stderr.resume();
  child.on("error", () => {
    clearTimeout(timer);
    end(503, '{"ok":false,"error":"local_service_error"}');
  });
  child.stdin.on("error", () =>
    end(503, '{"ok":false,"error":"local_service_error"}'),
  );
  child.on("close", (code) => {
    clearTimeout(timer);
    if (code !== 0)
      return end(503, '{"ok":false,"error":"local_service_error"}');
    try {
      end(
        200,
        JSON.stringify(JSON.parse(Buffer.concat(chunks).toString("utf8"))),
      );
    } catch {
      end(503, '{"ok":false,"error":"local_service_error"}');
    }
  });
  child.stdin.end(JSON.stringify(payload));
}
export function phoneSite(): Plugin {
  const handle = (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ) => {
    const path = (req.url ?? "").split("?")[0];
    const remote =
      Object.keys(req.headers).some(
        (k) =>
          k.startsWith("tailscale-") ||
          k.startsWith("x-forwarded-") ||
          k === "forwarded",
      ) || req.headers.host !== "127.0.0.1:1460";
    if (!path.startsWith("/phone/") && path !== "/phone") {
      if (remote) {
        res.statusCode = 403;
        res.end("Private phone access only");
        return;
      }
      return next();
    }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (
      !phoneAllowed(req, access()) ||
      req.headers["sec-fetch-site"] === "cross-site"
    ) {
      res.statusCode = 403;
      res.end("Private access denied");
      return;
    }
    if (path === "/phone/mortal") {
      res.setHeader("Content-Type", "application/json");
      if (
        req.method !== "POST" ||
        !req.headers["content-type"]?.startsWith("application/json")
      ) {
        res.statusCode = 403;
        res.end("{}");
        return;
      }
      const chunks: Buffer[] = [];
      let length = 0;
      req.on("data", (chunk: Buffer) => {
        length += chunk.length;
        if (length <= 29 * 1024 * 1024) chunks.push(chunk);
      });
      req.on("end", () => {
        const deny = (code: number, error: string) => {
          res.statusCode = code;
          res.end(JSON.stringify({ ok: false, error }));
        };
        if (length > 29 * 1024 * 1024) return deny(413, "size_limit");
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          return deny(400, "invalid_json");
        }
        if (!body || Array.isArray(body) || typeof body !== "object")
          return deny(400, "invalid_request");
        const keys = Object.keys(body).sort().join(",");
        if (
          body.action === "inspect" &&
          keys === "action,data,source" &&
          typeof body.data === "string" &&
          (body.source === null || typeof body.source === "string")
        ) {
          callPhone(res, {
            action: "phone_mortal_inspect",
            data: body.data,
            source: body.source,
          });
          return;
        }
        if (
          body.action === "register" &&
          (keys === "action,analysis_id,source,token" ||
            (keys === "action,analysis_id,created_at,item_ids,source,token" &&
              typeof body.created_at === "string" &&
              Array.isArray(body.item_ids) &&
              body.item_ids.length <= 3 &&
              body.item_ids.every((id) => typeof id === "string"))) &&
          typeof body.token === "string" &&
          typeof body.source === "string" &&
          (body.analysis_id === null || typeof body.analysis_id === "string")
        ) {
          callPhone(res, {
            action: "phone_mortal_register",
            token: body.token,
            source: body.source,
            analysis_id: body.analysis_id,
            ...(body.created_at === undefined
              ? {}
              : { created_at: body.created_at, item_ids: body.item_ids }),
          });
          return;
        }
        deny(403, "invalid_request");
      });
      return;
    }
    if (path === "/phone/api") {
      res.setHeader("Content-Type", "application/json");
      if (
        req.method !== "POST" ||
        !req.headers["content-type"]?.startsWith("application/json")
      ) {
        res.statusCode = 403;
        res.end("{}");
        return;
      }
      const chunks: Buffer[] = [];
      let length = 0;
      req.on("data", (b: Buffer) => {
        length += b.length;
        if (length <= 21 * 1024 * 1024) chunks.push(b);
      });
      req.on("end", () => {
        if (length > 21 * 1024 * 1024) {
          res.statusCode = 413;
          res.end('{"ok":false,"error":"size_limit"}');
          return;
        }
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          res.statusCode = 400;
          res.end('{"ok":false,"error":"invalid_sync"}');
          return;
        }
        if (body?.action === "download" && Object.keys(body).length === 1) {
          callPhone(res, { action: "offline_pack" });
          return;
        }
        if (
          ["round_review_catalog", "round_review_material"].includes(
            String(body?.action),
          ) &&
          typeof body.report === "string" &&
          /^[a-f0-9]{64}$/.test(body.report) &&
          (body.action === "round_review_catalog"
            ? Object.keys(body).length === 2
            : Object.keys(body).length === 3 &&
              Number.isInteger(body.round_index) &&
              Number(body.round_index) >= 0 &&
              Number(body.round_index) < 256)
        ) {
          callPhone(res, body);
          return;
        }
        if (
          body?.action === "analysis_sync" &&
          Object.keys(body).length === 2 &&
          Array.isArray(body.entries)
        ) {
          callPhone(res, { action: "analysis_sync", entries: body.entries });
          return;
        }
        if (
          body?.action === "sync" &&
          Object.keys(body).length === 2 &&
          body.payload &&
          typeof body.payload === "object"
        ) {
          callPhone(res, { action: "phone_sync", payload: body.payload });
          return;
        }
        {
          res.statusCode = 403;
          res.end("{}");
          return;
        }
      });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.statusCode = 405;
      res.end();
      return;
    }
    if (path === "/phone") {
      res.statusCode = 302;
      res.setHeader("Location", "/phone/");
      res.end();
      return;
    }
    const relative =
      path === "/phone/"
        ? "phone/index.html"
        : path.startsWith("/phone/assets/")
          ? path.slice(7)
          : path.slice(1);
    const root = resolve("dist");
    const file = resolve(root, relative);
    if (
      !file.startsWith(root + sep) ||
      !existsSync(file) ||
      !/^phone\/(?:index\.html|sw\.js|manifest\.webmanifest|icon-(?:192|512)\.png|licenses\/(?:NOTICE|PYODIDE-LICENSE|PYTHON-LICENSE)\.txt|runtime\/(?:pyodide\.mjs|pyodide\.asm\.mjs|pyodide\.asm\.wasm|python_stdlib\.zip|pyodide-lock\.json))$|^assets\/[\w.-]+$/.test(
        relative,
      )
    ) {
      res.statusCode = 404;
      res.end("Phone build unavailable");
      return;
    }
    const ext = file.split(".").at(-1)!;
    res.setHeader(
      "Content-Type",
      (
        {
          html: "text/html; charset=utf-8",
          js: "text/javascript",
          mjs: "text/javascript",
          txt: "text/plain; charset=utf-8",
          wasm: "application/wasm",
          css: "text/css",
          webmanifest: "application/manifest+json",
          png: "image/png",
        } as Record<string, string>
      )[ext] ?? "application/octet-stream",
    );
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    );
    if (relative.startsWith("assets/"))
      res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.end(req.method === "HEAD" ? undefined : readFileSync(file));
  };
  return {
    name: "kyokuloop-phone",
    configureServer: (s) => {
      s.middlewares.use(handle);
    },
    configurePreviewServer: (s) => {
      s.middlewares.use(handle);
    },
  };
}

// Static assets only. Study material and learning events never enter Cache Storage.
export function phoneBuild(): Plugin {
  return {
    name: "kyokuloop-phone-build",
    enforce: "post",
    generateBundle(_, bundle) {
      const html = bundle["phone/index.html"];
      if (!html || html.type !== "asset") throw new Error("Missing phone page");
      // Public files already live under phone/. The custom mount supplies the base.
      html.source = String(html.source).replace(
        /\/phone\/phone\/(manifest\.webmanifest|icon-(?:192|512)\.png)/g,
        "/phone/$1",
      );
      const urls = [
        "/phone/",
        ...Object.keys(bundle)
          .filter((k) => k.startsWith("assets/"))
          .map((k) => "/phone/" + k),
        "/phone/manifest.webmanifest",
        "/phone/icon-192.png",
        "/phone/icon-512.png",
        "/phone/licenses/NOTICE.txt",
        "/phone/licenses/PYODIDE-LICENSE.txt",
        "/phone/licenses/PYTHON-LICENSE.txt",
      ];
      const sourceVersion = readFileSync(
        resolve("src/version.ts"),
        "utf8",
      ).match(/DEVELOPMENT_VERSION = "(DEV-[0-9.]+-[0-9]+)"/)?.[1];
      if (!sourceVersion) throw Error("Missing phone version");
      const version =
        process.env.VITE_KYOKULOOP_DAILY === "1"
          ? sourceVersion.replace(/^DEV-/, "")
          : sourceVersion;
      const worker = readFileSync(resolve("tools/phone-worker.js"), "utf8")
        .replace("__VERSION_JSON__", JSON.stringify(version))
        .replace("__URLS_JSON__", JSON.stringify(urls))
        .replace("__RUNTIME_JSON__", JSON.stringify(runtimeManifest));
      const hash = createHash("sha256").update(worker);
      for (const name of [
        "manifest.webmanifest",
        "icon-192.png",
        "icon-512.png",
        "licenses/NOTICE.txt",
        "licenses/PYODIDE-LICENSE.txt",
        "licenses/PYTHON-LICENSE.txt",
      ])
        hash.update(readFileSync(resolve("public/phone", name)));
      const build = hash
        .update(
          Object.values(bundle)
            .map((v) => (v.type === "asset" ? String(v.source) : v.code))
            .join(""),
        )
        .digest("hex")
        .slice(0, 20);
      html.source = String(html.source).replace(
        "</head>",
        `<meta name="phone-build" content="${build}"></head>`,
      );
      this.emitFile({
        type: "asset",
        fileName: "phone/sw.js",
        source: worker.replace("__BUILD_JSON__", JSON.stringify(build)),
      });
    },
  };
}
