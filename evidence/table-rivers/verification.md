# 河の向きと三段配置の検証

## 対象
- DEV-11.03-7 / codex/table-rivers。
- 承認仕様はdocs/TABLE-DISPLAY.md。保存schema・学習判定・外部解析経路は変更していない。
- 本人の画像は参照だけに使用し、実牌譜/URL/学習履歴をGitへ追加していない。

## 自動検証
- npm run check / npm run build: 成功。
- npm run test:core: Python全133件成功（348.660s）。Python側のコード変更なし。
- npx playwright test --config=playwright.rivers.config.ts --workers=1: Edge全14件成功（1.1m）。1460のサーバーを起動/借用せず、built assetsと架空の端末状態だけを使用。
- 320/390/820/1180/1440pxで、4方向の回転、6/7/12/13/18/19枚目の位置、24枚時の6・6・12枚の3段構成、リーチ牌の横向き幅を検証。
- 牌同士/中央/席情報との重なり、卓外へのはみ出しがない。回答前の比較非表示と回答後の配置、短い河の固定開始位置、各席のマウスでの説明表示も確認。
- Windowsデモでも共通の河と正方形の卓を確認。
- PR #21/main fc2146dを取り込んだc87a87fの製品コードで、全体Edge174ケースの最終成功を確認。全体実行は173成功/1失敗（22.4m）で、残るcompact phone 430は操作assertionではなくbrowserContext.close時のtrace/zip保存がENOENTになった。並行した補助テストが同じtest-resultsを初期化したことが原因で、専用configの出力先を.local/rivers-resultsへ分離した。製品コードを変更せず、独立出力先で対象1件が成功（21.2s）。一括実行が174成功で終了したとは扱わない。
- 統合後の配置5サイズも専用に成功し、拡大されたiPad幅の生成画面を観測。保存/復旧/同期/更新/端末内解析と先行responsive-studyのケースを含む。

## 生成画面のAI観測
- 私的根拠: D:/dev-data/kyoku-loop/private/table-rivers-20261103。
- rivers-320.png / rivers-820.png: 対面180度、上家90度、下家-90度、中央を囲む河、3段目の横延長、リーチ牌を観測。
- rivers-desktop-demo.png / rivers-opening.png: Windowsと序盤の固定配置を観測。
- これは架空データのEdge生成画面の観測であり、人間のUX合格や実機合格を意味しない。

## 統合と配備
先行PR #21の盤面拡大/操作配置改善も本件へ取り込み済み。GitHub mainの確認済みSHAで専用日常版へ配備し、切替前後のDB/取り込み台帳/設定の一致、正常起動、配備した生成デモのEdge表示、本人HTTPSの更新情報を確認する。実行結果のSHAと私的根拠は共有Task tasks/waiting/table-rivers.md（移動前はdoing）へ記録する。
