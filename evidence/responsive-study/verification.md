# Portable study layout

## Behavior

- The portable study screen measures the actual space used by the header, notices, hand, public melds, answer panel and safe areas. The table grows into the remaining width and height, instead of retaining the phone's 330px cap on an iPad.
- Portrait layouts put the answer below the board. Wide landscape layouts put it on the right. The lower navigation is hidden only during an active, valid question; the existing 中断 control returns home, and navigation is restored on completion.
- The answer panel reserves space for comparison and the three self-assessment actions. Hand rows stay the same before and after revealing an answer. Narrow containers use seven columns, or six below 323px, keeping selection targets at least 44px wide.
- Answer confirmation, rechoosing, selection cancellation, rating undo and interruption retain their existing behavior. Only portable rating undo moves to the question heading (↶).
- The sync warning remains visible as a compact disclosure during study, with the original error and retry action inside. Background retries retain the warning until synchronization and refresh succeed, so an open explanation does not disappear during a retry. This changes its presentation; it does not repair the underlying sync error or remove any records.
- Optional detail, very short windows and larger text can scroll rather than losing content. Opening detail keeps the table size; advancing to another question returns to the top.
- Storage, synchronization protocol and scheduling logic are unchanged by this work.

## Checks before integration

- `npm run check`: passed.
- `npm run build`: passed. The pre-existing large bundle warning remains.
- `npm run test:core`: 133 Python tests passed.
- Layout suite: all 13 isolated Edge tests passed after integration with PR #20. Nine viewports: 375×667, 390×734, 390×844, 430×932, 768×1024, 820×1180, 1024×1366, 1180×820 and 1024×768. Each runs three consecutive questions without scrolling, confirms that all self-assessment controls can actually receive a click, checks table/hand dimensions before and after reveal, and exercises undo and interruption.
- Additional layout cases cover simulated safe areas, practice, optional detail, rotation, sync integrity warning/retry, public melds, a 320px window and larger text.
- The layout configuration serves built assets and a generated pack entirely inside a fresh Edge context. It does not start or borrow a server on port 1460. All fixtures use generated data, never the owner's learning database.
- Screenshots and geometry JSON are outside Git under `D:/dev-data/kyoku-loop/private/responsive-study-20261103/`.

## Integrated regression

- PR #20 / main `be991233` is an ancestor of the implementation. Its version button, input guards and update locks remain intact. The portable layout suite passed all 13 cases on the integrated code.
- Full Edge regression: 158 cases passed in the 160-case run; the remaining two (the same standalone offline case in desktop and phone projects) still used the old bottom-navigation Home action. That navigation is intentionally hidden during study. Updating the test to use the existing interruption control preserved every storage/restore/sync assertion, and both affected cases then passed in a focused rerun (2.2 minutes). No product code changed between the full run and rerun. All 160 cases are covered by these final successes; this is not a claim that one unmodified full invocation exited successfully.
- The product code remained at `e1dea14` throughout this regression. The later changes are test navigation and this report only. Python code is unchanged, so the passing 133-case Python evidence is reused.
- Logs: `full-edge-resumed.log`, `p14-recheck.log` and `npm-test-baseline.log` in the private evidence folder. An earlier full invocation reached passing build/Python checks but refused to borrow another server on 1460. Another run was interrupted to restore daily-use access, before the owner explicitly requested uninterrupted continuation. Neither is recorded as a complete test success.

## Deployment and acceptance

Daily-use deployment is pending. Actual Safari rendering and the owner's judgment of readability remain separate from Edge automation. Windows browser inspection stopped because the computer-use tool could not verify its URL; the owner then confirmed that no unsaved Windows work remained before normal shutdown. Live data was backed up and snapshotted; it was never replaced with a test database.
