# KyokuLoop

対局後の気づきを反復学習へつなげる、新規開発の四人麻雀ツール。

現在は **P1 UX試作 DEV-11.01-1**。架空データだけで、ホーム、牌譜・分析、学習の3画面、重要局面巡回、手動保存、標準5問の自主練習、回答比較、自己評価、4状態ライブラリを操作できる。

**P0は未通過**。NAGAレポート利用許諾の適用範囲と、実レポート/原牌譜の5判断照合が未確認。自動取得や実データインポートは実装していない。P2以降は開始していない。

## 起動

Node.js 22.12以降とnpm。初回は `npm ci`。確認環境はNode 22.15.0、Windows、既存のMicrosoft Edge。

```powershell
Set-Location E:\dev\kyoku-loop
npm run dev
```

[試作を開く](http://127.0.0.1:1460/)。ポート1460は `sutbun/ai-dev/DEV-PORTS.md` に登録済み。loopback限定、使用中は他の番号へ自動変更しない。終了は起動したコンソールでCtrl+C。

```powershell
npm run check
npm run build
npm test
```

テストは既存Edgeで、Windows幅とiPhone 13相当の幅を使用。Safari/iPhone実機の検証とは異なる。GitHub Actionsは使用しない。

## 現在の範囲

- URL登録・NAGA操作は無効な入力欄と案内だけ。外部HTTP取得・認証・NP消費・拡張制御を行わない。
- 4局から生成した128の打牌直前スナップショット、5重要局面と学習用の架空問題。「全手順」はこの収録範囲を指し、実半荘の完全復元を意味しない。
- クイズは保留・習得済みを除き最大5問。すべて架空の自主練習で、定期復習間隔・卒業・同期は未実装。
- 試作の回答・進行のみlocalStorageへ保存し、失敗を表示する。端末間同期、オフライン起動、バックアップの保証はない。
- 全データは今回新規生成。旧麻雀ツールのコード・設計・UI・データは参照/再利用していない。

## 仕様と検証

- [製品仕様 v1.0](KyokuLoop_MVP_Spec_v1.0_DRAFT.md)
- [フェーズ計画 v1.0](KyokuLoop_Codex_Implementation_Plan_v1.0.md)
- [P0 調査・ブロッカー・代替案](NAGA-SPIKE-RESULT.md)
- [P1 画面状態・再現手順・ゲート](docs/P1-UX-RESULT.md)
- 共通ルール: [sutbun/ai-dev](https://github.com/sutbun/ai-dev)

実牌譜・個人URL・Cookie・認証情報・実学習履歴はGit登録禁止。私的検証データはrepo外の `D:/dev-data/kyoku-loop/private/` に置く。旧ツール由来データは使用しない。ログやスクリーンショットにも実データを混入させない。
