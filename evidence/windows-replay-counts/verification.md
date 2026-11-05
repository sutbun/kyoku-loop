# Windows replay counts verification

## Scope
- Home list renamed to 保存した牌譜, with すべて / 未解析 / 解析済み counts and filters.
- Count visible saved games across pages; multiple model reports count once and validated reports without questions count as analysed.
- Filter-scoped select-all, cleared selection and pagination on filter changes, empty states, live refresh and whole-button wrapping.
- Existing API/storage/import/learning formats unchanged. Isolated worktree based on origin/main 63115bb; existing checkout/WIP untouched.

## Evidence
- Before implementation: new Edge regression failed because the promised 保存した牌譜 heading was absent.
- After implementation: npm run check and npm run build passed; four targeted desktop Edge tests passed.
- Agent inspected generated screenshots for the 1440px desktop and a 200px-wide wrapping filter row. This establishes generated-fixture layout, not Human acceptance of the daily-use app.
- Private artifacts: D:/dev-data/kyoku-loop/private/windows-replay-counts-20261105/{red,green,regression}.

## Required regression
- `npm run check` and `npm run build`: passed.
- `npm test -- --config=playwright.replay-management.config.ts --output=D:/dev-data/kyoku-loop/private/windows-replay-counts-20261105/regression`: passed. Full Python 166 tests (409s); isolated Edge 120 tests (8.5m), including both desktop and narrow viewport coverage, JSON import/linking, registration-only deletion and study/offline preservation.
- The isolated configuration starts no server and uses generated data and routed production assets. It does not borrow daily-use port 1460 or use the user's learning DB.
- Source review: filter counts and selection use the same visible-entry set; saved-game numbering remains stable across filters; content/actions retain original entry references. No API, database, importer, helper extension or dependency change.

Daily-use delivery and preservation evidence are recorded in the shared windows-replay-counts Task and the private deployment/audit reports. Human acceptance of the daily-use interface remains separate from these automated and generated-fixture checks.
