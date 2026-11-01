# THROWAWAY: Mortal browser bridge

Question: can a browser-owned form submission lead to one validated report, without an HTTP-client result retry or user browser credentials?

```powershell
Set-Location E:/dev/kyoku-loop
node tools/prototype-mortal-browser/run.mjs
```

`--interactive` selects scenarios one at a time; a scenario name runs just that case. Forms/results use the reserved `mortal-fixture.invalid` host and intercepted requests. No new ports, real submissions, live DB connection or installed-app change. Browser profiles are temporary under the private D: root and removed after normal browser closure. No live flag exists.

The prototype scopes only `form[action="/review"]`, keeps one submission per run, derives the expected result path from the observed progress task, and reads the response already loaded by the fictional official viewer. It never creates a direct HTTP request for a result. Existing `tools/mortal_report.py` validates the captured body without storing it. Access denial, human confirmation, changed form, invalid data, wrong-task data and missing result stop the flow.

Passing fixtures does not prove Cloudflare accepts an app-controlled browser or that a new real result can be imported. That feasibility and the dedicated-window UX must be confirmed before product integration. This branch is not for merging into main.

## Observed verdict (2026-11-02)

| Scenario | Outcome | Form posts | Captured bodies |
|---|---|---:|---:|
| Normal | Complete; existing Python parser accepted 1 scene/3 timeline events | 1 | 1 |
| Entry 403 | Stop: access restricted | 0 | 0 |
| Visible human confirmation | Stop: human confirmation | 0 | 0 |
| Duplicate/changed form field | Stop: form changed | 0 | 0 |
| Result 403 | Stop: access restricted | 1 | 0 |
| Invalid result | Stop: existing parser rejected it | 1 | 1 |
| Different task's body | Stop: expected result absent | 1 | 0 |

No bot-dispatch form was submitted. No DB was written, profiles were closed normally and removed, and the installed 11.02-6 application was unchanged. `node --check` passed for both modules. Product check/build/core/screen evidence from the unchanged main implementation remains applicable; this prototype is not a passing live-service integration.

Initial harness runs exposed missing UTF-8 metadata/short startup waits and the fact that a synthetic HTTP redirect could escape the route callback. A fictional progress GET reached the public host; the form POST was intercepted and contained only the hard-coded fictional source. No real replay or real analysis submission was involved. The final harness uses the reserved `.invalid` host and fresh scripted document navigation, and only the final seven scenario outcomes support this verdict. Initial zero exit codes were not evidence of success.

Next gate: agree the dedicated-window UX, then validate one normal live-browser flow without stealth flags, imported user credentials, token extraction or custom result HTTP requests. On service rejection/human confirmation, stop rather than weaken those conditions. Production would also need bounded response size/time, deduplication across clicks/restarts, lifecycle tracking, and existing explicit player/registration confirmation; this throwaway runner does not implement that product work.
