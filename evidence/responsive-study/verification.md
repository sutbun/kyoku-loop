# Portable study layout

## Behavior

- The portable study screen measures the actual space used by the header, notices, hand, public melds, answer panel and safe areas. The table grows into the remaining width and height, instead of retaining the phone's 330px cap on an iPad.
- Portrait layouts put the answer below the board. Wide landscape layouts put it on the right. The lower navigation is hidden only during an active, valid question; the existing 中断 control returns home, and navigation is restored on completion.
- The answer panel reserves space for comparison and the three self-assessment actions. Hand rows stay the same before and after revealing an answer. Narrow containers use seven columns, or six below 323px, keeping selection targets at least 44px wide.
- Answer confirmation, rechoosing, selection cancellation, rating undo and interruption retain their existing behavior. Only portable rating undo moves to the question heading (↶).
- The sync warning remains visible as a compact disclosure during study, with the original error and retry action inside. This changes its presentation; it does not repair the underlying sync error or remove any records.
- Optional detail, very short windows and larger text can scroll rather than losing content. Opening detail keeps the table size; advancing to another question returns to the top.
- Storage, synchronization protocol and scheduling logic are unchanged by this work.

## Checks before integration

- `npm run check`: passed.
- `npm run build`: passed. The pre-existing large bundle warning remains.
- `npm run test:core`: 133 Python tests passed.
- `npm run test:layout`: 12 isolated Edge tests passed. Nine viewports: 375×667, 390×734, 390×844, 430×932, 768×1024, 820×1180, 1024×1366, 1180×820 and 1024×768. Each runs three consecutive questions without scrolling, confirms that all self-assessment controls can actually receive a click, checks table/hand dimensions before and after reveal, and exercises undo and interruption.
- Additional layout cases cover simulated safe areas, practice, optional detail, rotation, sync integrity warning/retry, public melds, a 320px window and larger text.
- The layout configuration serves built assets and a generated pack entirely inside a fresh Edge context. It does not start or borrow a server on port 1460. All fixtures use generated data, never the owner's learning database.
- Screenshots and geometry JSON are outside Git under `D:/dev-data/kyoku-loop/private/responsive-study-20261103/`.

## Remaining evidence

Full regression, integration with the preceding PWA update work, and daily-use deployment are pending. Actual Safari rendering and the owner's judgment of readability remain separate from Edge automation. Windows browser inspection stopped because the computer-use tool could not verify its URL; no user browser input was performed after that failure.
