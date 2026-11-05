# 普段使いの起動とバックアップ

普段使い版はGitHub mainの確認済みSHAから `E:/Apps/KyokuLoop/` に独立配備する。Node.js/Pythonは既存の環境を使用し、開発checkoutのViteには依存しない。WindowsのURL `http://127.0.0.1:1460/` と本人用iPhone HTTPSの `/phone/` は引き継ぐ。

## 起動・終了

- スタートメニューの **#My Dev Apps → KyokuLoop** で起動する。普段使い版は `11.02-4` のようにDEV接頭辞だけを外して表示する。開発版は `DEV-11.02-4`。
- ブラウザを閉じても、Windows側のアプリはiPhoneとの同期用に動作を続ける。**KyokuLoop を終了** で終了する。処理中の場合は終了せず、完了後の再操作を案内する。
- 11.05-8から、Codexや起動元のターミナルを終了してもサーバーが終了しないよう、Windowsの既存WMI経由で起動処理を独立させる。非表示の短い起動処理からサーバーを起動し、従来どおりhealthの版とSHAを照合する。起動処理が使えない場合はエラーを返す。サービス・タスクスケジューラ・ログオン時の自動起動は追加しない。
- PCを再起動した後は、スタートメニューから一度起動する。自動起動のサービスやタスクスケジューラは登録しない。Windowsを止めても、iPhoneへ保存済みの問題と未送信記録は端末内に残る。
- 起動を繰り返してもサーバーを二重に作らない。開発版や他のプログラムが同じ接続先を使っている場合は、それを勝手に停止しない。

iPadは初回の「端末だけで使う準備」後、取得済みMortal JSONの登録と復習もWindows停止中に行える。操作と端末記録の復旧は [IPAD-STANDALONE.md](IPAD-STANDALONE.md) を参照。

Windows・iPad・スマホ共通の下部タブは「学習・牌譜・設定」。起動時は学習を開く。URL/解析結果の登録は「牌譜」、保存/同期/学習の設定/記録の保存と復旧は「設定」へ進む。詳細は [PHONE-NAVIGATION.md](PHONE-NAVIGATION.md)。

11.06-1から「牌譜」の解析済み対局で「一局レビュー」を開き、局を選んで振り返れる。「クイズあり/なし」を切り替え、手牌の上で最大3候補のAI推奨度を確認する。保存した局は端末内で使え、気になる場面は任意のタグとメモを付けて「学習 → 保存した場面」から開ける。レビュー記録は通常の5問復習と別に端末へ保存する。詳しくは [一局レビュー](ROUND-REVIEW.md)。

牌譜屋は「牌譜」→「URLを追加」→「牌譜屋を開く」で別タブに開く。既存のショートカットで取得したURLを元の画面へ貼り付ける。Windowsも同じ「URLを追加」にリンクがあり、PC用の取得ブックマークは「PCで牌譜URLを取得」から開く。リンク先はGit外の `D:/dev-data/kyoku-loop/private/app/external-links.json` の `paipuya` に設定し、ビルド時に取り込む（任意のファイルは `KYOKULOOP_EXTERNAL_LINKS_FILE` で指定）。未設定なら牌譜屋トップを開く。変更時は再ビルド・再配備が必要。個人のプレイヤーURLはGitへ登録しない。

「牌譜」タブの保存牌譜は状態別の件数を表示し、押すと絞り込む。集計と全選択の範囲は [Windowsの保存牌譜と件数](WINDOWS-REPLAY-LIST.md) を参照。

## バックアップ

**KyokuLoop バックアップ**、またはアプリの **設定 → バックアップと復元 → バックアップを作成** を使う。

1. SQLiteの一貫したsnapshotを `D:/dev-data/kyoku-loop/private/app/backups/` に作る。
2. 設定済みの追加コピー先へ複製し、内容のSHA-256とSQLite整合性を確認してから完了とする。
3. 追加コピーに失敗しても元のsnapshotは残る。「追加コピーは完了していません」と表示した場合は、接続/空き容量を確認して再実行する。

このPCでは追加コピー先を `E:/Backups/KyokuLoop/` とする。Dはdisk0、Eはdisk1であることを配備時に確認する。同じPC内の別ディスクへのコピーであり、USB等へ保管する場合はバックアップ画面の「ダウンロード」で作ったファイルを別媒体へコピーして保管する。古いバックアップは自動削除しない。

復元は **設定 → バックアップと復元 → バックアップファイルを選択 → 内容を確認 → この内容を復元**。既存データを残して不足分を追加する。分岐した履歴は適用せず、復元前にもsnapshotを作る。ファイル選択は20MB以下、gzip展開後256MB以下。未送信のiPhone記録は「設定」→「端末の管理」→「記録をファイルに保存」でも別途保管できる。

## 配備・更新の仕組み（開発担当向け）

`scripts/Deploy-KyokuLoop.ps1 -ExpectedSha <確認済みGitHub mainの40桁SHA>` を使用する。GitHub mainとfetch後のmainの両方が指定SHAと一致する場合だけ、git archiveから新しい版ディレクトリを作り、lockfileどおり依存を導入してビルドする。作業ブランチからの配備は行わない。

版は `E:/Apps/KyokuLoop/releases/<版>-<SHA先頭12桁>/`。必要ファイルのハッシュと実行環境をrelease.jsonへ記録し、ビルド後だけcurrent.jsonを切り替える。旧版と前の参照/ランチャーは保持する。参照の置換はSwitch-KyokuLoopRelease.ps1が明示的なバックアップファイル名を使って行い、Windows PowerShell 5でも更新できるようにする。同じ版のディレクトリを上書きせず、失敗した配備で実データを削除しない。

`scripts/KyokuLoop.ps1` は配備先に置く安定したランチャーとなる。Launch/Stop/Backup/Statusに対応。開始前にコードのハッシュを検査し、ローカル制御のPID/role/SHAとprivate nonceを照合して所有するサーバーだけを正常終了させる。実行中APIとPython子プロセスが残っていれば終了を拒否する。強制終了は行わない。

起動寿命の回帰検証は `python -m unittest discover -s tests -p test_p19_launcher.py`。本物のランチャーを架空release・専用データフォルダー・OS割当のテストポートで起動し、起動元だけのWindows Jobを終了した後も同じサーバーが応答し、専用APIで正常終了できることを確認する。本人の稼働アプリやDBをテストで停止しない。仕組みの一次資料は [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects) と [Win32_Process.Create](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/create-method-in-class-win32-process)。

元レポート、URL、学習履歴、本人用HTTPS設定、停止用nonce、追加コピー先の設定はrepo外に置く。データ正本は引き続き `D:/dev-data/kyoku-loop/private/app/kyokuloop.sqlite3`。追加コピー設定は同じフォルダーのbackup-settings.jsonのdirectoryで指定し、データやGitフォルダーへの再帰的なコピーとCドライブへの長期保存は拒否する。

開発版/普段使い版の切替前は、画面で処理や未保存入力がないことと、ローカル制御の実行中件数を確認する。切替には一貫したsnapshotを用意し、同じDBと同じOriginを維持する。iPhoneの問題やサイトデータを消して更新しない。
