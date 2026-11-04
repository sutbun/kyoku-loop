# DEV-11.04-21 verification

2026-11-04。初版20の1件保存は本人の「保存できた」で受入済み。今回の順次解析・登録は、実サイトの受入と分けて検証した。

- `npm run check` / `npm run build`: 成功。本体コード・DB schema・Origin/Host条件・Service Worker・本体の版は変更なし。
- `npm test -- --config=playwright.mortal-helper.config.ts`: build、全Python **153成功**（366.517秒）、関連 **12成功**。拡張のNode制御・隔離Chromium・更新器検査はこの12件のwrapper内でも実行。
- 新規バッチ制御13、IndexedDB保持2：成功。登録ACKの元ID不一致、既知拒否、送信前の拒否・手動送信の耐久記録、再起動、読取許可後の喪失、削除済み対局、保存済み結果再利用、登録待ちJSONの保護、停止後に次を送らない動作を含む。
- 更新器3：成功。元フォルダーを維持した更新と再更新、旧ファイルの退避、元ファイル変更・パッケージ改変・未知ファイル・root外パスの拒否を隔離フォルダーで確認。
- 隔離Chromiumの2対局で実際のMortal parser/SQLiteへ登録し、各対局の解析POST/結果読取がそれぞれ1回、履歴付き対局の点数/順位/対象照合とURLのみの対局の両方が通り、元の問題・回答・中断セッション全行と未保存の入力が保持されることを確認。モデル・温度空・対象自動・ratingなしが公開フォームの操作として送信されることも検査。
- 登録直後に返答を落としてブラウザを終了・同じprofile/extensionパスで再起動。拡張IDと耐久JSONを保持し、再開後のローカルcommitのみが2回目となること、解析POST/結果読取は各1回のままであることを確認。
- 生成popupのチェック付き一覧をAIが画像で確認。日時・順位/URLのみの行、長いIDの折返し、一覧内の縦スクロール、下の開始・停止を配置した。本人ブラウザのUX合格とは区別する。

架空ホストは `.invalid`、全Web要求は架空応答または拒否、DBは `D:/dev-data/kyoku-loop/private/mortal-batch-20261104/tests/` のtest.sqlite3。ダウンロードの外部転送は既知の架空JSON data URLに差し替え、通常のdownload完了イベントを使用。拡張APIで作られたタブの初回navigationをPlaywrightが捕捉できないため、テストは事前に接続したMortalタブの割当だけを差し替える。以後の公開フォーム/通常tabs.update、JSON fetch、API橋渡し、parser/SQLiteは実処理。command-line拡張のruntime.reloadがこのChromiumでは再ロードできないため、再起動検査は同じprofileと同じ拡張パスのブラウザ再起動で行った。

実Mortalへの解析POST/結果取得、本人DBへの書込・削除、通常ブラウザの自動操作、本体の終了・再配備は0。稼働中の127.0.0.1:1460はread-only healthでdaily/11.04-20/main d070495を確認した。既知403のPython/アプリHTTP/専用browser経路は再開していない。

詳細ログ・生成画像は `D:/dev-data/kyoku-loop/private/mortal-batch-20261104/`。実URL/解析JSON/Cookie/学習データはGitへ登録しない。配布はmainの確認済みSHAから出力し、同じ元拡張フォルダーへ更新する。本人確認の残条件は、既存拡張の再読み込み後、未解析の四人半荘2件が元対局に登録されること。
