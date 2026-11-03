import { test, expect } from "@playwright/test";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { createRuntimeControl } from "../tools/runtime";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { createHash } from "node:crypto";

test("Windows PowerShell 5 installs and atomically updates a release pointer with a retained backup", () => {
  const root = resolve("D:/dev-data/kyoku-loop/private");
  const folder = mkdtempSync(join(root, "daily-pointer-test-"));
  const executable = join(
    process.env.SystemRoot!,
    "System32/WindowsPowerShell/v1.0/powershell.exe",
  );
  const script = resolve("scripts/Switch-KyokuLoopRelease.ps1");
  const staged = join(folder, "staged.json"),
    pointer = join(folder, "current.json"),
    backup = join(folder, "previous.json");
  const invoke = () =>
    execFileSync(
      executable,
      [
        "-NoProfile",
        "-File",
        script,
        "-StagedPath",
        staged,
        "-PointerPath",
        pointer,
        "-BackupPath",
        backup,
      ],
      { encoding: "utf8", windowsHide: true },
    );
  try {
    writeFileSync(staged, JSON.stringify({ release: "first" }));
    invoke();
    expect(JSON.parse(readFileSync(pointer, "utf8"))).toEqual({
      release: "first",
    });
    expect(existsSync(staged)).toBe(false);
    writeFileSync(staged, JSON.stringify({ release: "second" }));
    invoke();
    expect(JSON.parse(readFileSync(pointer, "utf8"))).toEqual({
      release: "second",
    });
    expect(JSON.parse(readFileSync(backup, "utf8"))).toEqual({
      release: "first",
    });
    expect(existsSync(staged)).toBe(false);
    expect(() => invoke()).toThrow();
    expect(JSON.parse(readFileSync(pointer, "utf8"))).toEqual({
      release: "second",
    });
    expect(JSON.parse(readFileSync(backup, "utf8"))).toEqual({
      release: "first",
    });
  } finally {
    if (dirname(folder) !== root) throw Error("Unexpected cleanup path");
    rmSync(folder, { recursive: true });
  }
});

test("Windows launcher reports status and rejects a modified release without stopping the running app", async () => {
  const executable = join(
    process.env.SystemRoot!,
    "System32/WindowsPowerShell/v1.0/powershell.exe",
  );
  const script = resolve("scripts/KyokuLoop.ps1");
  const status = JSON.parse(
    execFileSync(
      executable,
      ["-NoProfile", "-File", script, "-Action", "Status", "-NoUI"],
      { encoding: "utf8", windowsHide: true },
    ),
  );
  expect(status.runtime.app).toBe("kyoku-loop");
  const root = resolve("D:/dev-data/kyoku-loop/private"),
    folder = mkdtempSync(join(root, "daily-launch-test-"));
  try {
    const release = "11.02-1-" + "a".repeat(12),
      sub = join(folder, "releases", release);
    mkdirSync(sub, { recursive: true });
    writeFileSync(
      join(folder, "current.json"),
      JSON.stringify({ app: "kyoku-loop", release, sourceSha: "a".repeat(40) }),
    );
    writeFileSync(join(sub, "code.txt"), "changed");
    writeFileSync(
      join(sub, "release.json"),
      JSON.stringify({
        sourceSha: "a".repeat(40),
        files: {
          "code.txt": createHash("sha256").update("original").digest("hex"),
        },
      }),
    );
    const result = spawnSync(
      executable,
      [
        "-NoProfile",
        "-File",
        script,
        "-Action",
        "Launch",
        "-InstallRoot",
        folder,
        "-NoUI",
        "-NoBrowser",
      ],
      { encoding: "utf8", windowsHide: true },
    );
    expect(result.status).toBe(1);
    const after = JSON.parse(
      execFileSync(
        executable,
        ["-NoProfile", "-File", script, "-Action", "Status", "-NoUI"],
        { encoding: "utf8", windowsHide: true },
      ),
    );
    expect(after.runtime.pid).toBe(status.runtime.pid);
  } finally {
    if (dirname(folder) !== root) throw Error("Unexpected cleanup path");
    rmSync(folder, { recursive: true });
  }
});

test("runtime control never exposes its nonce and refuses cross-site or busy shutdown", async () => {
  let stopped = 0,
    children = 0;
  const control = createRuntimeControl(
    { role: "daily", version: "11.02-1", source_sha: "a".repeat(40) },
    async () => {
      stopped++;
    },
    () => children,
  );
  const request = (
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const socket = new Socket();
    Object.defineProperty(socket, "remoteAddress", { value: "127.0.0.1" });
    const req = new IncomingMessage(socket);
    req.url = path;
    req.method = body === undefined ? "GET" : "POST";
    req.headers = {
      host: "127.0.0.1:1460",
      "content-type": "application/json",
      ...headers,
    };
    let text = "",
      next = false;
    const emitter = new EventEmitter();
    const response = Object.assign(emitter, {
      statusCode: 200,
      setHeader() {},
      end(value: string) {
        text = value;
        emitter.emit("finish");
      },
    });
    control.handle(req, response as unknown as ServerResponse, () => {
      next = true;
    });
    if (body !== undefined) {
      req.emit("data", Buffer.from(JSON.stringify(body)));
      req.emit("end");
    }
    return { response, status: response.statusCode, text, next };
  };
  const health = request("/api/health");
  expect(health.status).toBe(200);
  expect(health.text).not.toContain(control.token);
  expect(
    request("/api/health", undefined, { "x-forwarded-host": "example.invalid" })
      .status,
  ).toBe(403);
  expect(
    request("/api/health", undefined, { origin: "https://example.invalid" })
      .status,
  ).toBe(403);
  expect(
    request("/api/runtime", { action: "stop", token: "wrong" }).status,
  ).toBe(403);
  const active = request("/phone/api");
  expect(active.next).toBe(true);
  expect(
    request("/api/runtime", { action: "stop", token: control.token }).status,
  ).toBe(409);
  active.response.emit("close");
  const importing = request("/phone/mortal");
  expect(importing.next).toBe(true);
  expect(
    request("/api/runtime", { action: "stop", token: control.token }).status,
  ).toBe(409);
  importing.response.emit("close");
  children = 1;
  expect(
    request("/api/runtime", { action: "stop", token: control.token }).status,
  ).toBe(409);
  children = 0;
  expect(
    request("/api/runtime", { action: "stop", token: control.token }).status,
  ).toBe(200);
  expect(request("/api/local").status).toBe(503);
  await new Promise((resolve) => setImmediate(resolve));
  expect(stopped).toBe(1);
});

test("runtime HTTP rejects remote control and a failed copy keeps the local backup success visible", async ({
  page,
  request,
}) => {
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect((await health.json()).app).toBe("kyoku-loop");
  expect(
    (
      await request.post("/api/runtime", {
        data: { action: "stop", token: "invalid" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.get("/api/health", {
        headers: { Origin: "https://example.invalid" },
      })
    ).status(),
  ).toBe(403);
  await page.route("**/api/local", async (route) => {
    const action = route.request().postDataJSON().action;
    const data =
      action === "state"
        ? { reports: [], items: [] }
        : action === "backup_create"
          ? { name: "backup-fictional.sqlite3", mirror: { state: "failed" } }
          : {
              folder: "D:/fictional-backups",
              mirror_folder: "E:/fictional-copies",
              files: [],
            };
    await route.fulfill({ json: { ok: true, data } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "学習", exact: true }).click();
  await page
    .getByRole("button", { name: "バックアップと復元", exact: true })
    .click();
  await page
    .getByRole("button", { name: "バックアップを作成", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "バックアップを保存しました",
  );
  await expect(page.getByRole("alert")).toContainText(
    "追加コピーは完了していません",
  );
  await expect(page.getByRole("status")).not.toContainText(
    "追加コピーも確認済み",
  );
});
