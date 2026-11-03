# 相手手牌の直接タップ開閉（DEV-11.04-4）

各相手の手牌列をクリック／タップすると、その相手だけ表・裏を切り替える。独立したOPEN/CLOSEボタンは設けず、別局面では全員を伏せ直す。中央の「○打目／巡目」は削除した。PC起動時ホームのPR #25を含む累積版。

元JSONを読み取りで再生し、公開Scene・問題ID・回答履歴を変えない表示用データを生成する。端末に同期保存した問題はオフラインで開閉できる。旧端末内JSONも保存済みWorkerで補完する。旧形式を受け入れ、元データがない場合は同期を案内し、牌を作らない。透明な操作領域と河／副露が重なる部分では河／副露の操作を優先する。

## 確認結果

- check/build成功。Python既存133件、追加の元データ再現2件成功。配牌・ツモ・打牌・ポン・槓の時点一致、公開SceneとSQLite行を変更しないことを検証。
- 対象Edge12件成功。個別開閉・次問で閉じること・矩形不変・最小44px操作領域・データなし時の案内・320pxの河のhit testを検証。
- 累積製品commit `f243124731ece92809e013fca86c500fdc46a289` の全体Edge210件を実行し、206件成功、4件はテストfixtureの不整合で失敗。fixtureが問題を1問／0問へ削減する際に残した余分な手牌mapを修正し、該当4件を両projectで追試して全件成功。製品コードは全体検証時から変更していない。
- `npm test`の構成要素を別実行。全体27.4分、fixture修正後の4件19.9秒。Windows/iPhone各105ケースの最終成功がそろった。一括210件成功と区別する。
- cached WorkerによるオフラインJSON登録、旧形式backupの復旧と手牌補完、途中の学習／未送信／重複防止、PWA更新時の記録保持、連続回答と各画面幅の配置を確認。
- iPhone幅390／iPad横1180の最終生成画像をAIで観測。実Safariでの操作感・主観的UX合格は本人確認と分ける。
- 実保存9問すべての元データ再現を読み取りで確認。全体検証切替前後の7表全行と設定3ファイルSHA一致、SQLite integrity ok。配備時の再保全・実HTTPS・配備実assetの検証は共有Taskとprivate evidenceへ記録する。

私的根拠: `D:/dev-data/kyoku-loop/private/open-hands-20261104/` のbuild-final.log、core.log、replay.log、target.log、full-edge.log、retry-edge.log、final-ui/、real-replay.json、before/after-11.04-4-full.*。本人の元データ・URL・学習履歴はGitに含めない。
