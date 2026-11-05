"""An isolated Windows job simulates the process tree owned by a terminal/agent."""
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.request


class BasicLimits(ctypes.Structure):
    _fields_ = [("process_time", ctypes.c_int64), ("job_time", ctypes.c_int64),
                ("flags", wintypes.DWORD), ("min_working_set", ctypes.c_size_t),
                ("max_working_set", ctypes.c_size_t), ("active_processes", wintypes.DWORD),
                ("affinity", ctypes.c_size_t), ("priority", wintypes.DWORD),
                ("scheduling", wintypes.DWORD)]


class IOCounts(ctypes.Structure):
    _fields_ = [(name, ctypes.c_uint64) for name in
                ("reads", "writes", "other", "read_bytes", "write_bytes", "other_bytes")]


class ExtendedLimits(ctypes.Structure):
    _fields_ = [("basic", BasicLimits), ("io", IOCounts),
                ("process_memory", ctypes.c_size_t), ("job_memory", ctypes.c_size_t),
                ("peak_process_memory", ctypes.c_size_t), ("peak_job_memory", ctypes.c_size_t)]


@unittest.skipUnless(os.name == "nt", "Windows process/job lifecycle")
class LauncherLifetimeTest(unittest.TestCase):
    def test_daily_server_survives_termination_of_the_launching_job(self):
        repo = Path(__file__).resolve().parents[1]
        parent = Path("D:/dev-data/kyoku-loop/private/launcher-lifetime-test")
        parent.mkdir(parents=True, exist_ok=True)
        root = Path(tempfile.mkdtemp(prefix="synthetic-", dir=parent)).resolve()
        powershell = str(Path(os.environ["SystemRoot"]) /
                         "System32/WindowsPowerShell/v1.0/powershell.exe")
        node, python = shutil.which("node"), shutil.which("python")
        self.assertTrue(node and python)
        native_env = {k: v for k, v in os.environ.items() if k.lower() != "psmodulepath"}
        native_env["PSModulePath"] = str(Path(os.environ["SystemRoot"]) /
                                       "System32/WindowsPowerShell/v1.0/Modules")
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        url = f"http://127.0.0.1:{port}"

        def health():
            try:
                with opener.open(url + "/api/health", timeout=1) as response:
                    return json.load(response)
            except (OSError, ValueError):
                return None

        def wait_for(predicate, seconds=30):
            end = time.monotonic() + seconds
            while time.monotonic() < end:
                if predicate():
                    return True
                time.sleep(0.1)
            return False

        # Only the data root and local port change: use synthetic data and an OS-selected
        # local test port. The launch/backup/hash/health/stop paths are production code.
        script = (repo / "scripts/KyokuLoop.ps1").read_text(encoding="utf-8-sig")
        data_line = "$taskDataRoot = 'D:\\dev-data\\kyoku-loop\\private\\app'"
        url_line = "$taskAppURL = 'http://127.0.0.1:1460/'"
        self.assertEqual(script.count(data_line), 1)
        self.assertEqual(script.count(url_line), 1)
        script = script.replace(data_line, "$taskDataRoot = '" + str(root).replace("'", "''") + "'")
        script = script.replace(url_line, "$taskAppURL = '" + url + "/'")
        script = script.replace("Get-NetTCPConnection -LocalPort 1460 ",
                                f"Get-NetTCPConnection -LocalPort {port} ")
        launcher = root / "KyokuLoop.ps1"
        launcher.write_text(script, encoding="utf-8-sig")
        sha = "a" * 40
        release = "11.05-3-" + sha[:12]
        folder = root / "releases" / release
        vite = folder / "node_modules/vite/bin/vite.js"
        store = folder / "tools/p2_store.py"
        vite.parent.mkdir(parents=True)
        store.parent.mkdir(parents=True)
        vite.write_text("""
const http = require('node:http'), fs = require('node:fs');
const info = {app:'kyoku-loop',pid:process.pid,role:'daily',version:'11.05-3',
 source_sha:process.env.KYOKULOOP_SOURCE_SHA,active_requests:0,active_children:0};
fs.writeFileSync(process.env.KYOKULOOP_CONTROL_FILE, JSON.stringify({...info,token:'fixture'}));
const server = http.createServer((req,res) => {
 if(req.url==='/api/health'){res.end(JSON.stringify(info));return;}
 if(req.url==='/api/runtime'){
  let body='';req.on('data',b=>body+=b);req.on('end',()=>{
   if(JSON.parse(body).token!=='fixture'){res.statusCode=403;res.end();return;}
   res.end('{}');server.close();
  });return;
 }
 res.statusCode=404;res.end();
});
server.listen(PORT,'127.0.0.1');
""".replace("PORT", str(port)), encoding="utf-8")
        store.write_text('print(\'{"ok":true,"data":{"mirror":{"state":"saved"}}}\')\n', encoding="utf-8")
        files = {str(p.relative_to(folder)): hashlib.sha256(p.read_bytes()).hexdigest()
                 for p in (vite, store)}
        (root / "current.json").write_text(json.dumps({"app": "kyoku-loop", "release": release,
                                                      "sourceSha": sha}), encoding="utf-8")
        (folder / "release.json").write_text(json.dumps({"sourceSha": sha, "version": "11.05-3",
            "node": node, "python": python, "files": files}), encoding="utf-8")
        gate = root / "gate.ps1"
        gate.write_text("""
param([string]$Root)
while (-not (Test-Path -LiteralPath (Join-Path $Root 'go'))) { Start-Sleep -Milliseconds 50 }
& (Join-Path $Root 'KyokuLoop.ps1') -Action Launch -InstallRoot $Root -NoBrowser -NoUI |
 Set-Content -LiteralPath (Join-Path $Root 'launched.json')
Start-Sleep -Seconds 120
""", encoding="utf-8-sig")
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        kernel.CreateJobObjectW.restype = wintypes.HANDLE
        kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        job = kernel.CreateJobObjectW(None, None)
        self.assertTrue(job)
        limits = ExtendedLimits()
        limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        self.assertTrue(kernel.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)))
        process = None
        try:
            with (root / "launcher-output.log").open("wb") as output:
                process = subprocess.Popen([powershell, "-NoProfile", "-File", str(gate), "-Root", str(root)],
                    stdout=output, stderr=output, creationflags=subprocess.CREATE_NO_WINDOW, env=native_env)
                self.assertTrue(kernel.AssignProcessToJobObject(job, int(process._handle)),
                                f"AssignProcessToJobObject: {ctypes.get_last_error()}")
                (root / "go").touch()
                self.assertTrue(wait_for(lambda: (root / "launched.json").exists() and health()),
                                (root / "launcher-output.log").read_text(errors="replace"))
                before = health()
                kernel.CloseHandle(job)
                job = None
                process.wait(timeout=10)
                time.sleep(1)
                after = health()
                self.assertIsNotNone(after, "Daily server died with the launching job")
                self.assertEqual(after["pid"], before["pid"])
                self.assertEqual(after["source_sha"], sha)
        finally:
            if job:
                kernel.CloseHandle(job)
            if process:
                process.wait(timeout=10)
            if health():
                result = subprocess.run([powershell, "-NoProfile", "-File", str(launcher),
                    "-Action", "Stop", "-InstallRoot", str(root), "-NoUI"],
                    capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW, timeout=25, env=native_env)
                self.assertEqual(result.returncode, 0, result.stderr.decode(errors="replace"))
                self.assertTrue(wait_for(lambda: not health(), 5))
            if root.parent != parent.resolve():
                raise RuntimeError("Unexpected cleanup path")
            shutil.rmtree(root)


if __name__ == "__main__":
    unittest.main()
