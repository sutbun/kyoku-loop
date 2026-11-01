import { readFileSync, existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { trackChild } from "./runtime.ts";

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
      !/^phone\/(?:index\.html|sw\.js|manifest\.webmanifest|icon-(?:192|512)\.png)$|^assets\/[\w.-]+$/.test(
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
          css: "text/css",
          webmanifest: "application/manifest+json",
          png: "image/png",
        } as Record<string, string>
      )[ext] ?? "application/octet-stream",
    );
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
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
      ];
      const worker = `const BUILD=__BUILD_JSON__, NAME='kyokuloop-shell-'+BUILD, URLS=${JSON.stringify(urls)};
async function shellMatches(response){return !!response&&(await response.clone().text()).match(/name="phone-build" content="([^"]+)"/)?.[1]===BUILD;}
async function complete(c){for(const u of URLS)if(!await c.match(u))return false;return shellMatches(await c.match('/phone/'));}
async function repair(c){if(await complete(c))return;const responses=await Promise.all(URLS.map(u=>fetch(u,{cache:'no-store'})));if(responses.some(r=>!r.ok)||!await shellMatches(responses[0]))throw Error('mixed generation');await Promise.all(URLS.map((u,i)=>c.put(u,responses[i])));if(!await complete(c))throw Error('incomplete');}
self.addEventListener('install',event=>event.waitUntil((async()=>{try{const c=await caches.open(NAME);await c.addAll(URLS);if(!await complete(c))throw Error('incomplete');}catch(e){await caches.delete(NAME);throw e;}})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{const keys=(await caches.keys()).filter(k=>k.startsWith('kyokuloop-shell-'));for(const k of keys.slice(0,-2))if(k!==NAME)await caches.delete(k);await self.clients.claim();})()));
self.addEventListener('message',event=>{if(['VERIFY','REPAIR'].includes(event.data?.type))event.waitUntil((async()=>{let ok=false;try{const c=await caches.open(NAME);if(event.data.type==='REPAIR')await repair(c);ok=event.data.build===BUILD&&await complete(c);}catch{}event.ports[0]?.postMessage({ok,build:BUILD});})());});
self.addEventListener('fetch',event=>{const u=new URL(event.request.url);if(event.request.method!=='GET'||u.origin!==self.location.origin)return;const key=event.request.mode==='navigate'&&u.pathname.startsWith('/phone/')?'/phone/':u.pathname;if(URLS.includes(key))event.respondWith((async()=>{const c=await caches.open(NAME);const hit=await c.match(key);return hit||fetch(event.request);})());});
`;
      const hash = createHash("sha256").update(worker);
      for (const name of [
        "manifest.webmanifest",
        "icon-192.png",
        "icon-512.png",
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
