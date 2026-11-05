# Tab navigation without a full refresh

Baseline: main `d3acf894d40f7fde2b1dc46781916078f6f7dbcc` (11.05-13). Candidate: DEV-11.05-14.

Both navigation handlers changed the screen and called `run(refresh)`. That refresh disabled all tabs until completion. Windows reconstructed the full workspace; the phone also read/validated IndexedDB and verified offline runtime/shell files. Display-only navigation now reuses the loaded state. Initial loading, mutations, synchronization, focus updates and Windows background polling keep their existing refresh paths. Actual writes still disable navigation until their durable response.

Verification:

- Red: the two new display-only navigation cases failed on the baseline. A withheld second state response (Windows) and withheld shell verification response (iPad width) left the next tab disabled until the 750 ms interaction limit expired.
- Green: `npm run check` and `npm run build` passed. The configured isolated Edge suite passed all 42 cases across desktop and phone projects, including an explicit 1180 x 820 iPad viewport. The new cases cover consecutive tab changes with blocked refresh responses, zero phone state reads/shell checks during navigation, exact interrupted-session state retention, and a real save retaining the navigation lock until its response.
- Existing shared navigation, URL drafts, source selection, replay counts and detail actions passed in that same run. Generated Windows/iPad screenshots were inspected; no layout change is introduced.
- `npm run test:p0`: 19 passed. Focused `test_p3_selection.py`: 3 passed. The unchanged Python backend's full 168-test evidence in `evidence/study-repetition/verification.md` is reused; no backend, reducer, dependency, persistence or sync-format changes were made.
- Focused self-review verified that the removed calls were only in navigation handlers, and that startup/write/focus/sync/polling update paths and save guards remain present.

Private red/green artifacts are under `D:/dev-data/kyoku-loop/private/fast-tabs-20261105`. Browser tests use generated data and intercepted requests; no daily server or real history is used. Actual device latency acceptance and deployment are tracked separately in the shared task.
