# Pyodide runtime research for standalone iPad Safari validation

調査日: 2026-11-03

目的は、Mortal の解析済み JSON を端末内で検証・表示するための Python
標準ライブラリ実行環境を、スタンドアロンの iPad Safari アプリへ同梱できるかを
確認すること。AI 推論、Mortal への自動依頼、実牌譜の取得は調査対象外。

## Verified (official sources)

- The current `pyodide` npm package is **314.0.7**. npm reports MPL-2.0,
  package provenance at `github.com/pyodide/pyodide`, 14 files, and an unpacked
  size of **13,879,282 bytes**. The npm registry metadata does not expose a
  compressed `.tgz` byte size in the version record; do not infer one from the
  unpacked size. Registry integrity is SHA-512
  `0YvXxEhfEdpLfb/XkM2BFAeMROq0iMUX2bzzH9pOttyMcWkwq+HbE5uyuGD82LN7y2q+SNvi/6V5JEsOlD2R1A==`.
  Sources: [npm package](https://www.npmjs.com/package/pyodide),
  [npm registry metadata](https://registry.npmjs.org/pyodide/314.0.7),
  [tagged package manifest](https://raw.githubusercontent.com/pyodide/pyodide/314.0.7/src/js/package.json).

- The tagged npm manifest's published runtime allow-list is: `pyodide.asm.mjs`,
  `pyodide.asm.wasm`, `python_stdlib.zip`, `pyodide.mjs`, source maps,
  `pyodide.d.ts`, `ffi.d.ts`, `pyodide-lock.json`, `console.html`, and
  `console-v2.html`. Its package entry points are `package.json` and
  `pyodide.js` (`main`), and the package exports the ESM loader as `pyodide.mjs`
  and the legacy/global loader as `pyodide.js`. The exact npm archive was not
  downloaded for this research; use the tagged manifest as the source of truth
  for the allow-list and the docs for the runtime contents. Source: [Pyodide
  314.0.7 package manifest](https://raw.githubusercontent.com/pyodide/pyodide/314.0.7/src/js/package.json),
  [deployment contents](https://pyodide.org/en/stable/usage/downloading-and-deploying.html#contents-of-pyodide-github-releases).

- Pyodide's tested-browser recommendation is **Safari 16.4 or newer** (also
  Firefox 112+ and Chrome 112+). The project recommends current browsers, so
  this is a floor for the documented test matrix, not a promise that every
  older or future iPadOS build behaves identically. Source: [supported browsers](https://pyodide.org/en/stable/usage/index.html#supported-browsers).

- Pyodide requires a **module-type Web Worker**: `pyodide.asm.mjs` is an ES
  module and classic workers using `importScripts()` are unsupported. A worker
  keeps long-running validation off the UI thread. Source: [official Web Worker guide](https://pyodide.org/en/stable/usage/webworker.html#using-pyodide-in-a-web-worker).

- Offline/self-hosting is an explicitly supported deployment mode. The official
  bundler guide says to bundle Pyodide files for offline use; its Vite example
  copies the npm package's static files. For a genuinely offline install,
  package files and any required wheels locally and set `indexURL` (and, if
  applicable, `packageBaseUrl`) to the local asset directory. The docs warn
  that the npm mirror contains runtime only, not wheels. Source: [bundler guide](https://pyodide.org/en/stable/usage/working-with-bundlers.html#bundling-pyodide-files),
  [deployment guide](https://pyodide.org/en/stable/usage/downloading-and-deploying.html#downloading-pyodide).

- Size planning: the full release archive, including vendored packages, is
  officially described as **200+ MB**; the `pyodide-core` archive is the
  minimal startup set and is the same set installed by `npm install pyodide`.
  The full archive contains wheels and `.metadata` files; the latter include
  package author/license/dependency information. For this repository's
  stdlib-only validator, the npm/core runtime is the relevant baseline and
  numpy/scipy/etc. should not be added without a demonstrated need. Source:
  [release size and archive contents](https://pyodide.org/en/stable/usage/downloading-and-deploying.html#github-releases).

- Provenance/licensing: the tagged package manifest identifies the package as
  MPL-2.0 and links the upstream repository. The official docs identify the
  copyright as Pyodide contributors and Mozilla; vendored wheels have their
  own metadata/licenses. Any shipped bundle therefore needs the Pyodide
  license/notice and a review of licenses for any additionally bundled wheels.
  Sources: [manifest](https://raw.githubusercontent.com/pyodide/pyodide/314.0.7/src/js/package.json),
  [official docs footer](https://pyodide.org/en/stable/usage/index.html).

## Untested / must be proven in KyokuLoop

- No Pyodide binary was installed or downloaded in this research, and no
  iPad/iPadOS Safari run was performed. Safari 16.4+ compatibility is therefore
  a documented target, not KyokuLoop acceptance evidence.
- It is unverified whether the chosen iPadOS Web Worker can initialize the
  exact bundled 314.0.7 files under KyokuLoop's final static-hosting/PWA
  arrangement, including correct WASM MIME handling and any CSP restrictions.
- It is unverified that the current stdlib-only validator (copy/json/math/re/
  collections/gzip/hashlib/datetime) completes within acceptable startup,
  memory, and battery limits on the target iPad. Test with fictional fixtures
  first; do not use private or real Mortal reports for this runtime spike.
- It is unverified whether an offline bundle needs only npm/core assets for the
  validator. If Python import discovery requests a package not in the core
  runtime, add and license that wheel explicitly rather than allowing a
  network fallback.

## Recommendation boundary

Pyodide is a technically plausible P0/P1 candidate for local JSON validation:
use a module Worker, pin 314.0.7, self-host the core assets, and fail closed on
network/package fetches. This research does **not** establish iPad acceptance,
performance, or a production bundle decision; those require a separate device
test and fixture-based evidence.

## Core-runtime redistribution notices (follow-up)

- The exact core set currently used by KyokuLoop (`pyodide.mjs`,
  `pyodide.asm.mjs`, `pyodide.asm.wasm`, `python_stdlib.zip`, and
  `pyodide-lock.json`) contains the Pyodide runtime plus CPython and its
  standard library, but no wheels. Pyodide's tagged source repository carries
  the authoritative [MPL-2.0 license](https://raw.githubusercontent.com/pyodide/pyodide/314.0.7/LICENSE)
  and identifies CPython as a project component in its
  [README](https://raw.githubusercontent.com/pyodide/pyodide/314.0.7/README.md).

- Pyodide 314.0.0 (the 314.0 line used by 314.0.7) officially upgraded to
  **CPython 3.14.2** ([tagged Pyodide changelog](https://raw.githubusercontent.com/pyodide/pyodide/314.0.7/docs/project/changelog.md)). CPython's tagged [v3.14.2 LICENSE](https://raw.githubusercontent.com/python/cpython/v3.14.2/LICENSE)
  states that Python is under the Python Software Foundation License 2.0,
  requires retaining the PSF license and copyright notice, and notes that
  incorporated software can have separate licenses. The current Python
  [license and acknowledgements page](https://docs.python.org/3.14/license.html)
  is the readable companion and explicitly points to incorporated-software
  acknowledgements.

- The official Pyodide deployment page enumerates the core archive's runtime
  files but does **not** promise that `python_stdlib.zip` embeds a standalone
  license/NOTICE file. The npm manifest likewise lists runtime assets, not a
  third-party notice inventory. Because the core archive was not downloaded or
  unpacked in this follow-up, embedded-license presence is **unverified**;
  do not rely on the zip or WASM binary to supply notices.

- Recommended redistribution practice for KyokuLoop: ship a visible or
  reachable `THIRD_PARTY_NOTICES`/About entry containing (1) Pyodide 314.0.7
  MPL-2.0 text and source URL, (2) CPython 3.14.2 PSF License 2.0 text and
  copyright notice, (3) a short note that Pyodide's CPython build has patches,
  and (4) the upstream source URLs/commit or tag for obtaining corresponding
  source. This is a conservative notice bundle for the five core files; if any
  wheel or additional native library is later added, expand the inventory from
  that artifact's own license metadata.

- Pyodide's MPL-2.0 text requires informing executable-form recipients how to
  obtain corresponding source and prohibits removing or altering substantive
  license notices. This is a redistribution recommendation, not legal advice;
  have a maintainer review the final shipped notice and source-offer wording.
