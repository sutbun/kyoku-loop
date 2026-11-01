# KyokuLoop

開発共通ルールの正本は sutbun/ai-dev。開始時に E:/dev/ai-dev の AGENTS.md、COMMON-RULES.md、TASK-MANAGEMENT.md、HUMAN-INBOX.md、skills/dev-common-rules/SKILL.md を確認する。
製品仕様は KyokuLoop_MVP_Spec_v1.0_DRAFT.md、フェーズ計画は KyokuLoop_Codex_Implementation_Plan_v1.0.md。
共有状態は E:/dev/work/kyoku-loop/ai。human は別repoであり同期・書換えしない。
旧麻雀ツールは一切参照・移植しない。実牌譜・URL・アカウント・Cookie・学習履歴はGit登録禁止。私的検証データはリポジトリ外 D:/dev-data/kyoku-loop/private に置く。
ユーザー追加説明（2026-11-01）: 完全な個人利用・非公開。競合製品と推定した一律停止は撤回し、通常の公開経路と本人が利用できるデータでP0を進める。提供元の個別許諾取得の事実としては扱わない。実データ5判断照合ゲートが通るまでP2を実装しない。P1は架空データのみ。有料解析・認証回避・外部拡張の自動操作は行わない。明示的なアクセス/利用制限が判明すれば対象処理を止めて報告する。
GitHub Actionsを追加しない。開発ポート1460、127.0.0.1、strictPort。開発版はDEV-MM.DD-Nを表示する。
ユーザー指示（2026-11-02）: NAGA追加連携は保留。Mortal解析済み結果の局面表示・復習への取り込みを先行し、その後に雀魂URLだけから解析へつなぐ経路を検証する。ブラウザ版雀魂ログイン・拡張不要を優先する。実結果対応はdocs/MORTAL-IMPORT.mdを参照し、未確認の自動依頼/API/モデル入手を成立済みと扱わない。
検証: npm run check / npm run build / npm test（P0のPython検証とEdgeでの画面テスト）。P1の操作成功と人間によるUX合格を区別する。

普段使い版は当repoの scripts/Deploy-KyokuLoop.ps1 に確認済みGitHub mainのSHAを渡して E:/Apps/KyokuLoop へ独立配備する。共通5アプリ用のAfterMergeドライバーへ勝手に登録しない。手順は docs/DAILY-USE.md。データは従来のD:/dev-data/kyoku-loop/private/appを継続使用し、起動中はUIと実行中API/子プロセスを確認して専用APIから正常終了する。強制終了・自動起動サービス追加は行わない。
