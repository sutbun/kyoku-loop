# Mortalの順次解析とKyokuLoop登録

KyokuLoop Mortal Helper **DEV-11.05-6**。初版21の一括実操作は本人の登録完了表示と正本DBの紐付けで確認済み。通常ブラウザ内での初版20の1件保存は本人の「保存できた」で受入済み。21では本人が選んだ最大20件を、送信・結果待ち・JSON保存・検証・登録ACKの順で1件ずつ処理し、30秒空けて次へ進む。実サイトの複数件動作は別の確認とする。

## 処理と照合

1. 拡張を開くと自動で、同じブラウザで開いた `http://127.0.0.1:1460/` のKyokuLoopから解析待ちを読む。削除済み・登録済み・東風と判明した対局・手動依頼済み・送信不明を新規解析しない。対象情報の `_a...` 付き雀魂URLが必要。履歴がないときは本人が四人半荘を選ぶ。
2. 1つの通常Mortalタブで入力画面を開き、公開フォームのURL、Mortal、本人選択モデル（初期4.1b）、対象自動、Killerducky、温度空、局指定空、ratingなしを設定する。自然に有効になる送信ボタンを通常クリックする。初版の耐久送信許可・フォーム応答/結果ID対応・待機上限を使う。固定座標、disabled解除、認証情報読取、未公開POST組立はしない。
3. 初版と同じChrome downloads経路でJSONを保存する。保存成功後、同じ結果ページ内content scriptが、表示された同じ結果IDの同一origin JSONを通常のブラウザfetchで一度読む。最大20MiB、UTF-8 JSON、Mortal/モデル、最終URL、表示中の結果IDを照合。401/403/429、本人確認、別ページ、内容不一致で全体を止める。
4. JSONとSHA-256を拡張のIndexedDBへ保持する。未登録のJSONは最大1件。他の対局で置き換えず、登録ACKを受けるまで削除しない。
5. KyokuLoop自身のタブ内content scriptが既存の `POST /api/local` の `inspect`（base64の**ファイル内容だけ**）と `commit` を呼ぶ。アプリHTTPからMortalのURLを取得する経路は使わない。登録器が全内容・対象席・モデルを検証し、元URL/解析待ちIDを指定して登録する。元履歴がある場合は全員の最終点、対象者の点数と順位も照合する。
6. 対局の存在を登録直前にも確認し、返答の `source_link.linked` と元IDを照合して初めて成功とする。既存問題・回答・学習セッション・期限・リンクを既存登録器が保持する。KyokuLoopホームの既存focus/定期state更新で結果を表示し、ページの強制再読込を行わない。

## 中断と再開

- 登録失敗・ACK喪失は一時停止。耐久保持した同じJSONからローカル登録のみ再試行でき、解析送信/結果読取を再発行しない。重複登録は既存登録器の同一結果判定を利用する。
- 結果読取の許可も実行前に記録する。許可後にworkerが失われ、JSONが耐久保存できていなければ再取得しない。ブラウザに保存済みのJSONを手動登録できる。送信結果不明は再解析しない。
- ブラウザ/拡張の再起動後は一時停止。通常のworker休止からは耐久状態に従う。ポップアップを閉じても継続する。
- 停止は未送信ならすぐ、送信済みなら現在の1件を登録してから次へ進むのを止める。未登録JSONが残る間は一覧終了・別一覧開始を拒否する。一覧を終了しても送信台帳は残す。
- 初版20で保存済みの同一元URL/モデルの結果は、同じ結果ページを再表示して登録に使える。新しい解析を依頼しない。

## 権限と更新

新しいhost権限は `http://127.0.0.1:1460/*` のみ。app-contentはルートページだけで動作する。`scripting` は既に開いたKyokuLoopへ自分のisolated content scriptを追加するために使い、未保存のUIを保持する。既存APIのHost/Origin/cross-site/Content-Type検査は一切変更しない。externally_connectable、window message、nativeMessaging、レジストリ、サービス、新規ポートはない。

既存拡張のIDと台帳を保つため、`Package-MortalHelper.ps1` はcommit済みコードから不変の21パッケージを作り、`Update-MortalHelper.ps1` は元の読込先 `E:/Apps/KyokuLoopMortalHelper/DEV-11.04-20/extension` の中身だけを更新する。旧版のファイルをbackupへ保持し、元パスは変えない。新旧SHA-256、許可済みファイル一覧、名前/key、root包含、reparseなしを確認して入れ替える。ブラウザで既存拡張を1回再読み込みする。削除・入れ直しや2個目の追加は不要。

PythonのMortal直接取得で既知の403となった経路、拒否済みの専用ブラウザ経路は再開しない。今回の結果読取は本人が利用する通常ブラウザ内で、同じ結果ページからの同一origin要求であり、これも拒否されたら停止する。拒否回避や自動再試行は追加しない。

## 検証

状態制御・耐久JSONの制限をNodeで、拡張と通常DOM操作・実際の既存parser/SQLiteへの2件登録・ACK喪失からのブラウザ再起動/登録のみの再開を隔離Chromiumで検証する。Web originは `.invalid`、全要求は架空応答/拒否、DBは私的test.sqlite3に限定。解析送信・JSON読取は1件につき各1回、過去の問題/回答/中断セッション/未保存入力が保持されることを確認する。Chrome APIで新規タブの初回navigationをPlaywrightが捕捉できないため、架空テストは事前に接続した空のMortalタブを割り当て、その後のナビゲーションは通常のtabs.updateで行う。downloadsの外部転送は初版同様、架空JSONのdata URLに差し替える。実サイト・本人DBへの要求は0。更新器も隔離フォルダーで検証する。

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH='D:/dev-cache/playwright'
npm.cmd run check
npm.cmd test -- --config=playwright.mortal-helper.config.ts
node --test tests/mortal-helper-update.test.mjs
```

本人の実ブラウザでは更新後まず未解析の四人半荘2件を選び、両方が元対局へ登録されることだけを確認する。架空検証を実サイト・本人UXの受入とは扱わない。

## 一次資料

- [Chromeのネットワーク要求](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)：content scriptの要求はページoriginの制約を受ける。
- [Chrome messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)：拡張内通信とtabs.sendMessage。
- [Chrome scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting)：host権限を用いたisolated scriptの追加。
- [Chrome downloads](https://developer.chrome.com/docs/extensions/reference/api/downloads)：既定保存先、完了イベントとダウンロードID。

## 停止時の診断情報（11.05-2）
停止メッセージの直下に「診断情報をコピー」を置く。最後に取得したSTATUSから進捗・生の停止コード・牌譜ID・モデル・送信済みか・結果ID・ファイル保存先・登録ACK・保留JSONの有無を明示的な項目だけで組み立てる。利用者のクリック内でClipboard.writeTextを呼び、拒否時はread-only文字欄へ表示・選択しCtrl+Cでコピーできる。クリップボード読取や追加権限、JSON本体・Cookie・学習履歴・認証情報の出力は行わない。

配布にはdiagnostics.jsを含める。更新器のInstalledDirectoryは、HelperRoot内の確認済みの既存extensionパスを明示して同じ場所へ更新するための任意引数。標準20読込先のinstalled.jsonを維持し、既存21読込先を明示する場合はその親のinstalled-extension.jsonへ別記録する。各読込元のZIPとバックアップを保持し、両方とも実ファイルのhashが一致した場合だけ更新する。元のパス・拡張ID・台帳・IndexedDBを維持する。

一次資料: [Chrome Clipboard permissions](https://developer.chrome.com/docs/extensions/reference/permissions-list)、[Chromiumのユーザー操作内のwriteTextの扱い](https://issues.chromium.org/issues/40846300)。自動検査はClipboardの書込先をメモリ上へ置換し、クリックのuserActivationとコピー内容・拒否時の選択文字欄を確認する。本人のOSクリップボードは検査で変更しない。

11.05-3では、次の未送信項目にjobがない場合に、同じタブの直前の結果を診断へ混ぜない。結果ID・送信操作済み・保存状態はその項目のjobが確認できる場合だけ表示する。


## 操作と進捗の簡素化（11.05-4）

- 通常画面は未登録件数・開始ボタン・「対象を変更」。起動時に一覧を読み、処理可能で四人半荘（mode 9/12/16）の未登録を古い順に最大20件選ぶ。解析は明示的な開始クリック後のみ。登録済み/対象外/送信不明は一覧へ出さず、ルール未確認は別グループで手動選択する。
- 対象変更には20件までの一括選択/解除と日時・順位の短い行。長いIDは行の詳細（マウスを置いた表示）へ。最大20件をUIと既存runnerの両方で守る。
- モデルは右上メニュー内。初期4.1b、popupModelを拡張localに記憶し、既存state/台帳/IndexedDBへ触れない。進行中/停止中はそのバッチのモデルを使う。
- 処理中は登録ACK確認済み件数/総数の進捗バー、現在の段階または次の開始までの秒数、「この1件で止める」。ポップアップを開き直してもSTATUSの実状態へ戻り、一覧を読み直さない。
- 完了/一覧終了時に候補を自動更新。完了なら件数と「KyokuLoopを開く」、次の対象があれば開始ボタンを表示。「KyokuLoopを開く」は既存のアプリタブを再読込せず前面へ出し、なければ通常URLを開く。
- 異常停止時だけ「エラー情報をコピー」。再開可否はrunnerと同じread-only検査を使い、再開可能時だけボタンを表示。登録待ちJSONがあれば「登録を再開」。本人の一時停止は診断ボタンを出さない。メニュー内に既存の1件保存/履歴/対応表/一覧終了を残す。
- 権限、解析送信/JSON取得/登録ACK/停止/再開の制約、保存場所、台帳と保留JSONの保持は継続する。新UIの架空Edge検証と本人の実ブラウザUX合格は区別する。


## タブを閉じた後の再開（11.05-5）
`tab_closed` で停止した一覧を本人が「続きから再開」するとき、既存の送信/保持JSON/アクセス制限の検査を通った後にだけ、閉じた処理タブの参照を解放する。未送信の次項目は新しいタブで開き、保持JSONがある場合は従来どおりローカル登録だけを再開する。登録済みや送信不明の再送を許可する変更ではない。タブを閉じた瞬間に自動で再開せず、明示再開を待つ。


## 入力フォーム内の本人確認待ち（11.05-6）
通常の入力フォームの検証を通り、表示中のinline widgetと無効な送信ボタンを観測した場合だけ、waiting/awaitingConfirmationとして同じdocumentで待つ。この間は通常の45秒の送信準備期限を適用しない。送信ボタンが自然に有効になったら、既存の元URL/設定/document/耐久許可の照合を経て通常クリックを1回行い、再開操作を要求しない。widgetが消えても送信できない場合は通常の45秒待機へ戻る。ユーザー停止・タブ終了・ブラウザ再起動は従来どおり停止する。

観測はトップ文書の表示中widgetの有無をBooleanにするだけ。widget/iframeの中身、応答token、Cookie、site globalsを読まず、チェック・解答・本人確認の迂回を行わない。手動確認が必要なら本人が行う。ページ全体の本人確認画面、アクセス拒否、401/403/429、入力やページの変更は従来どおり停止し、自動再試行・再読み込みしない。送信後の解析180秒/保存120秒などの期限は維持する。
