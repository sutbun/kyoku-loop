# Mortal Helper minimal popup — DEV-11.05-4

## Delivered behavior
- Automatically read the local queue when opening an idle popup. Select the oldest eligible, confirmed four-player half games (mode 9/12/16), at most 20; never submit before the explicit start click.
- Hide registered/ineligible rows and long IDs. Put optional target editing, unknown-rule confirmation, bulk selection/clear, remembered model and existing single-save/history/export behind disclosures/menu.
- Display ACK-confirmed registration count/total, stage, cooldown seconds and stop-after-current. Restore running/paused state without reading/resetting its selection.
- Refresh candidates after completion/end. Open/focus the app without reloading it. Show error copying only for abnormal stops, and resume only when the runner's existing validation succeeds.
- Keep the submit/read grants, duplicate guards, registration ACK validation, existing privileges, ledger and durable JSON unchanged.

## Verification (2026-11-05)
- New Edge popup tests: five expected failures before implementation (the required controls did not exist), then all five successful. Checks include default oldest-20, unknown-rule exclusion, 20 limit, editing/clear, model persistence, reopen progress, cooldown, stop, completed-row removal, app-open command, resume eligibility, error-only copying and retry.
- New read-only resume availability guards plus existing BatchRunner tests: 15 successful. Availability does not write state or re-read a report.
- npm run check and npm run build successful. Final build/check used the isolated source archive on E:.
- npm test -- --config=playwright.mortal-helper.config.ts: build and all 165 Python cases successful. One browser assertion in the single-save harness initially read before popup startup loading completed. The harness now restores its target tab after menu clicks and waits for the real saved status; standalone browser verification passed all 8 nested cases. No production code was weakened for this correction.
- Final npx playwright test --config=playwright.mortal-helper.config.ts --output=<private>/playwright: all 12 successful, including actual isolated extension single save, two sequential games through the real parser/SQLite, automatic completed-row removal, existing app focus with unsaved input preserved, lost-ACK/restart registration-only recovery, diagnostics clipboard fallback, updater guards and the five Edge popup cases.
- Reuse the successful Python evidence after the test-harness-only correction; a default full-app live-port UI run was not performed.
- Inspected generated ready/running/paused/done/targets/menu screenshots. Private evidence: D:/dev-data/kyoku-loop/private/mortal-simple-ui-20261105 (final-related.log and PNGs). Synthetic extension/profile material is temporary on E:.
- Real Mortal requests: 0. User application DB writes: 0. OS clipboard changes: 0. Browser tests use reserved .invalid origins and private generated databases.

## Delivery boundary
Package committed GitHub main into DEV-11.05-4, update the existing installed folders in place with the checked updater and retain backups. The extension ID, ledger and IndexedDB stay at their existing paths. Browser extension reload and subjective user UX acceptance are separate from file/hash verification. Do not reload the user's extension during active processing.
