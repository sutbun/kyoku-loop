# Practice rotation and overdue selection

Baseline: main `549f605b6ca28c113008c274586d3e9dfb672e1c` (shared UI and Helper updates retained). Candidate: DEV-11.05-13.

Two valid-state selection defects reproduce completion followed by the same five questions. In practice, five questions with fewer historical answers remain first after another completed set while the rest of a large library have higher counts. In scheduled study, newer review deadlines precede older unlearned deadlines because status was compared before date. Both scenarios failed before the correction in Python and the mobile reducer. Testing only equally unanswered questions did not detect these cases.

Practice now selects unanswered questions first, followed by the oldest last-answer instant. Count, status, deadline and ID break ties. Scheduled study selects the oldest eligible deadline first, then retains review/manual/automatic priority for matching dates. UTC-normalized instants are used in both implementations. Older phone packs also derive missing or understated counts from retained answer history; local/saved copies of the same event are not counted twice. Read-only statistics are memoized within one reducer call.

No stored answer, due date, streak, active session, backup or synchronization format is rewritten. Due-date eligibility, same-day scheduled credit limits, pause/graduation exclusion and interrupted-session continuation remain intact.

Verification:

- `npm run check`, `npm run build`, Prettier and `git diff --check`: passed after merging current main. Only the version conflicted; retained build 13 while incorporating build 12's shared UI.
- `npm run test:core`: 168 passed in 443.199 seconds. The subsequently added timezone regression also passed in the focused three-test selection suite; two of those tests are included in the full run.
- Integrated isolated Edge selection/control suite: 23 passed. Includes 207-question first passes, old/missing counters, uneven answer counts, a next-day backlog, a simulated sync ACK moving answers to saved history while retaining raw events, compiled mobile five-answer completion and the next set, undo/backup/concealment/graduation/deduplication/stale advancement regressions.
- Windows study and shared-navigation integration checks: six passed, including five-answer concealment/completion/undo/history, a lost-response retry, additive backup recovery and shared navigation. Total integrated configured Edge coverage is 29 passed. Build/core/configured Edge components are executed separately instead of repeating the entire npm-test wrapper.

Focused self-review compared both queue implementations, UTC offset handling, summary versus partial histories, raw-event deduplication, unchanged scheduling credit rules and the integrated diff. Browser cases intercept requests and Python cases use generated private DBs or an in-memory DB. No real reports, account identifiers, source URLs, answers or device backups are included here.

The automated evidence establishes the reproduced selection failures and their correction. It is not acceptance of the user's physical iPad/iPhone experience. Deployment and the minimal real-device check are tracked in the shared task.
