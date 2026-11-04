# Mortalの1件送信とJSON保存を補助する拡張

**本人確認済み**：2026-11-04に「保存できた」と回答を受領。DEV-11.04-20の通常ブラウザ内1件保存は受入済み。以下は初版20の仕様記録。複数件の順次解析とアプリ登録は[DEV-11.04-21の仕様](MORTAL-BATCH.md)を参照し、初版の未確認記述を現在の受入状態として扱わない。

検証用 **KyokuLoop Mortal Helper / DEV-11.04-20**。2026-11-04の本人指示で、通常ブラウザ内の1件について「開始→送信可能待ち→送信→解析完了待ち→JSON保存」を実装する。普段のBrave/Edge/Chromeで使うManifest V3の独立拡張で、KyokuLoop本体の画面や学習DBを変更しない。

## 対応範囲

- 本人がKyokuLoopの「Mortalへ」で開いた、日本語/英語の入力ページ1タブを拡張の「この1件を開始」で指定する。AI=Mortal、UI=Killerducky、選択中モデル・対象・温度・局指定を維持する。対象が自動の場合は対象情報を含む雀魂URLの末尾 `_a...` が必要。明示的な席0〜3にも対応。
- 送信ボタンが自然に有効になるまで最大45秒待ち、選択内容を再確認して通常のクリックを1回だけ行う。disabled解除・force click・固定座標・固定秒数後の無条件クリックはしない。
- フォーム送信として観測した同じタブの進捗/結果遷移、またはフォーム応答からのclient redirectにだけ結果IDを結び付ける。結果IDが変わる、別サイト/別ページへ移動する、手動送信する、タブを閉じると停止する。取得ボタンの代理として未公開POSTを組み立てない。
- 結果ビューの局表示が描画されてから、結果画面の `data=/report/<id>.json` に対応するURLをブラウザ標準のダウンロードへ渡す。別の結果をダウンロードしない。解析待ち上限180秒、保存待ち120秒、ファイル上限20MiB。HTML・不正な最終URL・空/過大ファイル・ダウンロード失敗は成功にしない。
- 既定のダウンロード先の `KyokuLoop-Mortal/<結果ID>.json` に保存する。ファイル名が衝突した場合は別名となり、既存を上書きしない。任意の絶対パスへ拡張単体で直接保存することや、ブラウザ全体の保存設定変更はしない。
- 「ファイルを保存しました」はブラウザの保存完了であり、JSON全内容の検証・対象席の独立照合・KyokuLoop登録の合格ではない。既存の登録器が内容を検証する。保存したJSONは現在のKyokuLoopの複数JSON追加でも扱える。本体の自動取り込みフォルダへの直接受け渡し、URL一覧の連続解析は初版の範囲外。

## 重複と中断

送信とダウンロードの許可をローカルへ保存してから実行する。workerの停止/再起動で同じ許可を再発行しない。送信許可後は、実際の送信が不明な場合も同じ元URL・モデル・対象・温度・局指定・rating設定を自動再送しない。送信前の通常取消等は本人が改めて開始できるが、アクセス拒否を記録した同一設定の再試行はしない。

ブラウザ/拡張自体の再起動時は処理を停止する。停止ボタンは拡張の次操作と進行中の自前ダウンロードを止めるもので、サイトで受け付け済みの解析を取り消す機能ではない。元ファイルを削除しない。

## データと権限

- `host_permissions`: `https://mjai.ekyu.moe/*` のみ。content scriptはトップフレームだけ。外部ページからの起動API/externally_connectable、KyokuLoopへの外部書き込み口は追加しない。
- `storage`: 拡張のlocalのみ。元URL・モデル・対象・結果ID・保存状態など最大1000件を保持し、popupには最近20件を表示。1000件で停止して黙って記録を消さない。sync storageを使わず、content scriptからの直接storageアクセスも許可しない。
- `webNavigation`: 指定された1タブのフォーム送信/結果遷移を対応付ける。他タブの履歴を保存しない。
- `downloads`: 自分の処理で開始したダウンロードIDだけを追跡する。既存ファイルの削除・上書き・履歴整理はしない。
- `alarms`: 待機時間の上限と保存完了の再確認。OSサービス/タスクスケジューラ/自動起動を追加しない。
- Cookie、Turnstile応答、認証情報、サイト内部JS変数、他の拡張を読み出し・操作しない。通常ブラウザのダウンロードに付随する標準動作を利用し、UA/ヘッダー偽装・proxy変更・再取得ループは加えない。
- 「対応表を保存」は元URLと結果IDを含む本人用txtをダウンロードする。解析JSONと分ける。実URL/結果/対応表はGit禁止。

## 導入用成果物

初回のフォルダー選択と1件の確認は、パッケージ内の `README.html` にまとめる。未登録のsource変更をそのまま配布しないため、commit済みコードからのみ以下で出力する。

```powershell
pwsh -NoProfile -File E:\dev\kyoku-loop\scripts\Package-MortalHelper.ps1
```

既定の出力は `E:/Apps/KyokuLoopMortalHelper/DEV-11.04-20/`。中の `extension` フォルダーを読み込む。フォルダー/ZIPの上書きを拒否し、source SHAと全拡張ファイルのSHA-256を `package-info.json` に記録する。ブラウザへの自動登録・設定変更はしない。

## 検証と実サイトの残条件

状態制御をNodeで、実拡張のDOM操作・フォーム遷移・保存・対応表出力・停止を隔離Chromiumで検証する。テストでは拡張のホスト文字列を予約済み `.invalid` へ置き換え、すべてのWeb要求を架空応答または拒否に限定する。JSONの外部転送だけは既知の架空JSONをdata URLに置き換え、ブラウザ標準ダウンロードの完了イベントと実ファイルのバイトを確認する。公開サービスへのPOST/結果GET、本人ブラウザ/学習DBへの書込は0。

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = 'D:/dev-cache/playwright'
npx.cmd playwright install chromium
npm.cmd run check
npm.cmd test -- --config=playwright.mortal-helper.config.ts
```

このnpm testは通常ビルド・全Python検証・本拡張・既存Mortal紐付け/完了表示の関連検査を行う。サーバーを起動せず、普段使いの1460へテスト要求を送らない。全アプリの全Edge画面検査を再実行したという意味ではない。

現行の公開フォームをアプリ内ブラウザで読み取り確認し、`input-method=log-url`、対象自動の値が空文字、Mortal/Killerducky/4.1bの選択値、温度欄の初期値が空であることを確認した。空の温度はサイト既定のまま送り、拡張が値を補わない。認証情報・hidden inputの値を読み出さず、フォーム送信も行っていない。本人の普段のBraveへ拡張を追加して動かした確認は未実施。

公開HTMLのPython直接取得は403で停止した。この経路を再試行せず、既知の専用browser probe/アプリHTTP結果取得も再開しない。通常ブラウザでの本拡張による1件の送信・結果保存が通るまでは実連携合格としない。本人確認/アクセス拒否が出れば止め、その状態を記録して報告する。

## 一次資料

- [Mortal公開入力画面](https://mjai.ekyu.moe/ja.html)
- [Killerduckyの公開HTML](https://github.com/killerducky/killer_mortal_gui/blob/master/index.html): 読込後の `.info-round` 表示。
- [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Chrome downloads](https://developer.chrome.com/docs/extensions/reference/api/downloads): filenameはダウンロード先に対する相対パス。
- [Chrome webNavigation](https://developer.chrome.com/docs/extensions/reference/api/webNavigation): form_submit、client_redirect、documentId。
- [Chrome storage](https://developer.chrome.com/docs/extensions/reference/api/storage): ローカル保存とaccess level。
