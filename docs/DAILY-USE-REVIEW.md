# 普段使い配備・バックアップの重点レビュー

2026-11-02 JST。DEV-11.02-1に対応する11.02-1。今回のレビューは同一担当による重点自己レビューであり、独立した人間レビューとは区別する。

- 配備元: GitHub mainとfetch後のorigin/mainを40桁SHAで照合し、Git archiveから独立配備する。失敗時に既存の版・参照・ランチャー・ユーザーデータを削除しない。current参照の切替は最後に行う。
- 起動/終了: 版のハッシュを確認し、二重起動を防ぐ。停止はloopback限定のJSON要求とprivate nonceで認証し、PID/role/SHAを照合する。APIやPython子プロセスが動作中なら拒否する。Tailscale転送・異なるOrigin・不正nonceを拒否し、認証情報をhealth応答へ含めない。
- バックアップ: SQLite snapshotを元の保存先に保持し、追加コピーだけを行う。一時ファイルへのコピーとfsync後にSHA-256・SQLite・外部キーを確認し、完成名へ変更する。同名コピーを上書きしない。追加コピーが失敗した場合は元の保存成功とコピー失敗を分けて伝える。
- データ境界: 正本DB・本人用HTTPS設定・URL・学習履歴・停止用nonce・コピー設定はrepo外。テスト用DBの設定を正本のコピー設定から分離する。iPhoneのOrigin/IDB・SQL版3を維持する。

全体検証はnpm test成功（Python76件、Windows/iPhone幅の画面60件）。npm run check/buildも成功。終了認証・処理中拒否・改変された版の起動拒否・コピー失敗時表示・コピー破損/衝突を確認した。最終のimport拡張子明示後にはcheck、日常版build、起動制御の両幅6件も成功した。

架空レポートを持つ隔離DBと別loopbackアドレスの1460で、日常版previewの起動、Windows APIからのバックアップ、検証済みコピーから別DBへの復元、不正停止拒否、正規nonceによる正常終了（exit 0）、制御ファイルの削除を確認した。これを実iPhoneの再受け入れとは扱わない。

実配備のmain SHA、版、起動元、ショートカット、別ディスクへのコピー、既存データの不変確認は共有AIのevidence/daily-use/verification.mdに記録する。個別データと画像はprivate領域に保持しGitへ含めない。
