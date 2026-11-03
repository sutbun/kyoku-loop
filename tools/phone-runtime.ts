import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type { Plugin } from "vite";

const require = createRequire(import.meta.url);
const root = dirname(require.resolve("pyodide/package.json"));
const names = [
  "pyodide.mjs",
  "pyodide.asm.mjs",
  "pyodide.asm.wasm",
  "python_stdlib.zip",
  "pyodide-lock.json",
];
const version = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
).version;
if (version !== "314.0.7") throw Error("Unexpected compiler runtime version");
const files = names.map((name) => {
  const bytes = readFileSync(resolve(root, name));
  return {
    name,
    url: "/phone/runtime/" + name,
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
});
export const runtimeManifest = {
  version,
  cache:
    "kyokuloop-runtime-" +
    createHash("sha256")
      .update(JSON.stringify(files))
      .digest("hex")
      .slice(0, 20),
  files,
};
export function phoneRuntime(): Plugin {
  return {
    name: "kyokuloop-compiler-runtime",
    resolveId(id) {
      if (id === "virtual:phone-runtime") return "\0phone-runtime";
    },
    load(id) {
      if (id === "\0phone-runtime")
        return "export default " + JSON.stringify(runtimeManifest);
    },
    generateBundle() {
      for (const { name } of files)
        this.emitFile({
          type: "asset",
          fileName: "phone/runtime/" + name,
          source: readFileSync(resolve(root, name)),
        });
    },
  };
}
