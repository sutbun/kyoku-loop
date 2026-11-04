import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  readFileSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  cpSync,
} from "node:fs";
import { resolve, join } from "node:path";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function fixture() {
  const root = resolve(".local/helper-update-test/" + crypto.randomUUID());
  const installed = join(root, "DEV-11.04-20/extension"),
    pack = join(root, "DEV-11.05-2");
  mkdirSync(installed, { recursive: true });
  mkdirSync(join(pack, "extension"), { recursive: true });
  const files = {},
    oldFiles = {};
  const names = [
    "manifest.json",
    "core.js",
    "background.js",
    "inspector.js",
    "content.js",
    "popup.html",
    "popup.js",
    "popup.css",
    "batch.js",
    "payloads.js",
    "app-content.js",
    "diagnostics.js",
  ];
  for (const name of names) {
    const bytes = readFileSync("extensions/mortal-helper/" + name);
    files[name] = hash(bytes);
    writeFileSync(join(pack, "extension", name), bytes);
    if (names.indexOf(name) < 8) {
      const old =
        name === "manifest.json"
          ? Buffer.from(
              JSON.stringify({
                manifest_version: 3,
                name: "KyokuLoop Mortal Helper",
                version: "0.1.0.20",
              }),
            )
          : Buffer.from("old fictional " + name);
      oldFiles[name] = hash(old);
      writeFileSync(join(installed, name), old);
    }
  }
  writeFileSync(
    join(root, "DEV-11.04-20/package-info.json"),
    JSON.stringify({ files: oldFiles }),
  );
  writeFileSync(
    join(pack, "package-info.json"),
    JSON.stringify({
      version: "DEV-11.05-2",
      sourceSha: "a".repeat(40),
      files,
    }),
  );
  const run = (p, installedDirectory) =>
    execFileSync(
      "pwsh",
      [
        "-NoProfile",
        "-File",
        "scripts/Update-MortalHelper.ps1",
        "-PackageDirectory",
        p || pack,
        "-HelperRoot",
        root,
        ...(installedDirectory
          ? ["-InstalledDirectory", installedDirectory]
          : []),
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  return { root, installed, pack, files, oldFiles, run };
}
test("updates the exact original folder, retains old files, and supports a second checked update", () => {
  const f = fixture(),
    first = JSON.parse(f.run());
  assert.equal(first.extension_id_path_unchanged, true);
  assert.equal(first.directory, f.installed);
  assert.equal(first.result, "UPDATED_RELOAD_REQUIRED");
  for (const [name, sha] of Object.entries(f.files))
    assert.equal(hash(readFileSync(join(f.installed, name))), sha);
  for (const [name, sha] of Object.entries(f.oldFiles))
    assert.equal(
      hash(readFileSync(join(first.backup, "extension", name))),
      sha,
    );
  assert.equal(JSON.parse(f.run()).directory, f.installed);
});
test("refuses modified installed files and preserves them", () => {
  const f = fixture();
  writeFileSync(join(f.installed, "core.js"), "unique modified contents");
  assert.throws(() => f.run());
  assert.equal(
    readFileSync(join(f.installed, "core.js"), "utf8"),
    "unique modified contents",
  );
  assert.equal(existsSync(join(f.root, "installed.json")), false);
});
test("rejects package tampering, extra installed files and paths outside its root", () => {
  const a = fixture();
  writeFileSync(join(a.pack, "extension/core.js"), "tampered");
  assert.throws(() => a.run());
  const b = fixture();
  writeFileSync(join(b.installed, "unique.txt"), "keep");
  assert.throws(() => b.run());
  assert.equal(readFileSync(join(b.installed, "unique.txt"), "utf8"), "keep");
  const c = fixture();
  assert.throws(() => c.run(a.pack));
  assert.equal(readdirSync(c.installed).length, 8);
});

test("updates a second known package path without changing the primary installation record", () => {
  const f = fixture();
  const secondary = join(f.root, "DEV-11.04-21/extension");
  cpSync(f.installed, secondary, { recursive: true });
  writeFileSync(
    join(f.root, "DEV-11.04-21/package-info.json"),
    JSON.stringify({ files: f.oldFiles }),
  );
  f.run();
  const primary = readFileSync(join(f.root, "installed.json"), "utf8");
  const updated = JSON.parse(f.run(f.pack, secondary));
  assert.equal(updated.directory, secondary);
  assert.equal(readFileSync(join(f.root, "installed.json"), "utf8"), primary);
  assert.ok(existsSync(join(f.root, "DEV-11.04-21/installed-extension.json")));
  for (const [name, sha] of Object.entries(f.files))
    assert.equal(hash(readFileSync(join(secondary, name))), sha);
  assert.equal(JSON.parse(f.run(f.pack, secondary)).directory, secondary);
  assert.throws(() => f.run(f.pack, join(f.root, "../outside/extension")));
});
