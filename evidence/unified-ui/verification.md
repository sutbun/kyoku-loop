# iPad基準の共通UI

## 変更範囲

Windows/iPad/スマホで「学習・牌譜・設定」の3タブ、学習トップ、URL入力、Mortal JSON登録、保存牌譜の行・件数・絞り込みを共用する。Windowsの重要局面/収録手順/手動保存、JSONドロップ、NAGA/レポートURL、全解析結果、フォルダ取り込み、バックアップは内部詳細または設定へ残す。保存形式と同期処理は変更しない。

## 検証

- 変更前の新規UIテストは、共通3タブが存在しないことで失敗した。
- `npm run check` / `npm run build` 成功。
- `npm run test:core`: Python 166件成功。Pythonの保存・正規化・同期処理は本変更で未変更。
- 先行Edge回帰154件成功。最終整理後は `playwright.unified-ui.config.ts` で登録/紐付け/一覧削除/未紐付け結果/復習/履歴/バックアップ/縦横配置まで確認する。
- 共通JSON登録の新規ケースで、確認画面のタブ往復、指定した元対局への実SQLite登録、Windowsで端末用IndexedDBを新設しないこと、一覧から削除後も結果と問題が残り収録手順を開けることを検査する。
- static-appの画面テストは実サーバーを起動・借用せず、ビルド済みファイルと架空DBを使う。Service Workerは明示的に無効化し、本人用サーバーから資産を取得しない。
- 元牌譜の選択、入力済みtextareaの参照はrole/nameで行う。暗黙label内の入力値で完全一致が外れるテストを修正。牌譜屋リンクはSSRでも公開トップを既定値にできるようにする。

私的検証記録・生成画像・配備前後のDB/設定照合は `D:/dev-data/kyoku-loop/private/unified-ui-20261105/`。実iPad Safariでの主観的UX受入とは区別する。本人は更新時のWindows本体/Helperについて、処理中・未保存入力なしと回答済み。
