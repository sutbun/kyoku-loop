# Stored-history practice rotation

Baseline: main `403345fe5b4fbc98c0a7e55852cbba20d6a37d09`. Candidate: DEV-11.05-13.

The current reducer already rotates through 207 fictional unanswered questions without repetition in both practice and same-day scheduled study. The reported device failure has not been established as that path. A separate reproducible compatibility defect exists: a valid retained pack containing answer history but no `review_count` summary selects previously answered questions again. The pre-fix regression failed with `Expected false / Received true` for membership of the next item in the answered set.

The candidate uses the greater of the saved summary and the saved answer-history count, then adds local answers whose event IDs are absent from the saved history. This changes only the computed selection count. It does not rewrite stored answers, due dates, streaks, sessions or synchronization contracts.

Verification on the candidate:

- `npm run check` and `npm run build`: passed.
- New reducer checks: practice and scheduled study each cover 207 distinct fictional questions before a repeat; missing and stale-zero summary counters both prefer unanswered items. Four passed.
- New isolated mobile UI check: old answer history, five answers through the compiled UI, completion, then another five distinct unanswered candidates. Passed.
- Existing isolated Edge regressions: `offline-engine`, `p5-client`, `practice-rotation`, `study-controls`; 16 passed. Includes raw-event deduplication, refusing a newer-answer overwrite, backup recovery, undo, resume, scheduling intervals, automatic stale-item advancement and answer controls.
- `python -B -m unittest discover -s tests -p test_p4_pack.py`: one passed. Python/backend source is unchanged. The full product `npm test` was not run for this draft; this record is not release approval.
- `git diff --check`: passed. Focused self-review confirmed that valid summary counts continue to dominate partial histories and that local/saved event IDs are not counted twice.

Tests use fictional data and intercept all browser requests in the UI cases. No real reports, account identifiers, URLs, answers or device backups are included here. The actual reported device behavior, including whether it follows completion or interruption, remains unconfirmed. The candidate is not deployed and must not be described as a confirmed fix for both reported modes.
