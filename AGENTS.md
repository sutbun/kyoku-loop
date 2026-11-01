# KyokuLoop

開発共通ルールの正本は sutbun/ai-dev。開始時に E:/dev/ai-dev の AGENTS.md、COMMON-RULES.md、TASK-MANAGEMENT.md、HUMAN-INBOX.md、skills/dev-common-rules/SKILL.md を確認する。
製品仕様は KyokuLoop_MVP_Spec_v1.0_DRAFT.md、フェーズ計画は KyokuLoop_Codex_Implementation_Plan_v1.0.md。
共有状態は E:/dev/work/kyoku-loop/ai。human は別repoであり同期・書換えしない。
旧麻雀ツールは一切参照・移植しない。実牌譜・URL・アカウント・Cookie・学習履歴はGit登録禁止。私的検証データはリポジトリ外 D:/dev-data/kyoku-loop/private に置く。
P0の許諾と実データ5判断照合ゲートが通るまでP2を実装しない。P1は独立した架空データのみ。NAGAの自動取得・有料解析・拡張操作は実装しない。
GitHub Actionsを追加しない。開発ポート1460、127.0.0.1、strictPort。開発版はDEV-MM.DD-Nを表示する。
検証: npm run check / npm run build / npm test。P1の操作成功と人間によるUX合格を区別する。
