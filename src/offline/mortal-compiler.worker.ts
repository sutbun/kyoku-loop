import p0Code from "../../tools/p0_verify.py?raw";
import mortalCode from "../../tools/mortal_report.py?raw";
import materialCode from "../../tools/mortal_material.py?raw";
import revealCode from "../../tools/hand_reveal.py?raw";
import reviewCode from "../../tools/round_review.py?raw";
import type { PyodideInterface } from "pyodide";

let runtime: Promise<PyodideInterface> | undefined;
function initialize() {
  return (runtime ??= (async () => {
    const indexURL = new URL("/phone/runtime/", self.location.origin).href;
    const loaderURL = indexURL + "pyodide.mjs";
    const { loadPyodide } = await import(/* @vite-ignore */ loaderURL);
    const py: PyodideInterface = await loadPyodide({
      indexURL,
      packageBaseUrl: indexURL,
      stdout: () => {},
      stderr: () => {},
    });
    py.FS.mkdir("/compiler");
    for (const [name, code] of [
      ["p0_verify.py", p0Code],
      ["mortal_report.py", mortalCode],
      ["mortal_material.py", materialCode],
      ["hand_reveal.py", revealCode],
      ["round_review.py", reviewCode],
    ])
      py.FS.writeFile("/compiler/" + name, code);
    py.runPython(
      "import sys,json; sys.path.insert(0,'/compiler'); from mortal_material import compile_upload, preview_upload, review_upload",
    );
    return py;
  })());
}
let chain = Promise.resolve();
self.onmessage = (event) => {
  const { id, data, created, preview, review, round_index } = event.data;
  chain = chain.then(async () => {
    try {
      const py = await initialize();
      if (data === null) {
        self.postMessage({ id, ok: true, data: { version: py.version } });
        return;
      }
      if (typeof data !== "string" || typeof created !== "string")
        throw Error("invalid_json");
      py.globals.set("_encoded_upload", data);
      py.globals.set("_created_at", created);
      py.globals.set("_preview", preview === true);
      py.globals.set("_review", review === true);
      py.globals.set(
        "_round_index",
        Number.isInteger(round_index) ? round_index : -1,
      );
      try {
        const result = py.runPython(`
try:
    _compile = preview_upload if _preview else compile_upload
    _data = review_upload(_encoded_upload, _created_at, _round_index if _round_index >= 0 else None) if _review else _compile(_encoded_upload, _created_at)
    _result = {'ok': True, 'data': _data}
except Exception as error:
    _code = str(error)
    _allowed = {'invalid_json','inbox_mortal_only','size_limit','unsupported_format','unsupported_rule','unsupported_model','reconstruction_failed','invalid_import_time'}
    _result = {'ok': False, 'error': _code if _code in _allowed else 'invalid_json'}
json.dumps(_result, ensure_ascii=False)
`);
        self.postMessage({ id, ...JSON.parse(result) });
      } finally {
        py.runPython(
          "del _encoded_upload, _created_at, _preview, _review, _round_index, _result, _compile",
        );
      }
    } catch {
      self.postMessage({ id, ok: false, error: "runtime_unavailable" });
    }
  });
};
