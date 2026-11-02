# Mortalエラー調査用の牌譜取得

調査日: 2026-11-02。日常版11.02-8のMortal失敗調査。製品の追加連携ではなく、検査用データ取得の手順を扱う。

## 今回使う方法

本人は一回限りの診断として、導入済みBrave拡張「雀魂牌譜検討サポーター」の利用を了承した。v1.6.0の公開実装に、選択局をTenhou6 URLへ変換しNAGA注文画面の入力欄へ渡す機能がある。解析依頼・NP購入は不要。

1. 対象の雀魂牌譜を通常のBraveで開き、再生できる状態にする。
2. 検討サポーターを開く。NAGA欄の局一覧が出たら `All` → `Go`。
3. 開いた注文画面の入力欄にある `https://tenhou.net/6/#json=...` の全行をコピーする。
4. 注文・解析依頼・NP購入は押さない。コピーしたテキストを私的領域へ原文のまま保存する。

`NagaList.vue`が局ごとのURLを `toNagaData` に入れ、`naga.content.ts` が注文画面のtextareaへ設定する。`viewer.ts` は `log: [toNagaLog(v)]` として1局単位で生成する。以前本人が送った複数行URLもこの形式に一致する。Mortal/Acochan欄の名前ボタンは雀魂URLをMortalへ渡す操作であり、JSON取得とは別。

- [NagaList.vue v1.6.0](https://github.com/kbkn3/MahjongSoul-review-supporter/blob/v1.6.0/src/popup/NagaList.vue)
- [viewer.ts v1.6.0](https://github.com/kbkn3/MahjongSoul-review-supporter/blob/v1.6.0/src/lib/viewer.ts)
- [naga.content.ts v1.6.0](https://github.com/kbkn3/MahjongSoul-review-supporter/blob/v1.6.0/src/entrypoints/naga.content.ts)
- [MjaiList.vue v1.6.0](https://github.com/kbkn3/MahjongSoul-review-supporter/blob/v1.6.0/src/popup/MjaiList.vue)

これは拡張が変換した牌譜であり、雀魂サーバーの生protobufを取得したことにはならない。全行を保全し、局・本場・タイトル・名前・ルールが整合する場合だけ、診断用の別ファイルでlog配列を順序を変えずにまとめる。取得済み原文は上書きしない。元の雀魂URLをMortal側がどう変換したかまでは、この出力だけでは分からない。

## ログイン・拡張を使わない取得の調査結果

確認した公式ガイドと公開実装では、日本版の共有URLだけでTenhou6 JSONを安定取得する、ログインも拡張も不要な文書化済み経路を確認できなかった。公式のダウンロードボタンの存在も確認できていないため、存在しない操作を利用者へ案内しない。これは全ての取得方法が禁止されているという判断ではない。

`tensoul` は設定したアカウントのアクセストークンで `fetchGameRecord` を呼ぶ。返された `data_url` を読む分岐はあるが、URLを共有IDから推測する公開ダウンロード仕様ではない。認証トークンの取得・保存を今回の診断には加えない。

- [tensoul README.adoc](https://github.com/Equim-chan/tensoul/blob/main/README.adoc)
- [設定例](https://github.com/Equim-chan/tensoul/blob/main/config.example.js)
- [client.js](https://github.com/Equim-chan/tensoul/blob/main/client.js)

レビュアー作者の雀魂ガイドには、ログイン後にTampermonkeyの保存スクリプトを導入し、牌譜読み込み後に `s` を押してTenhou6 JSONを保存する方法もある。スクリプトはWebSocket応答を捕捉して変換する。今回の既存拡張の方法とは別で、新規導入は行わない。

- [mjai-reviewerの雀魂保存ガイド](https://github.com/Equim-chan/mjai-reviewer/blob/master/mjsoul.adoc)

DevToolsの通信表示だけでは、雀魂のバイナリ応答を検査用Tenhou6 JSONへ変換する手順は完成しない。今回はHAR、Cookie、認証トークン、WebSocket一式の収集を求めない。既に拒否を確認した履歴API・結果HTTP取得・専用ブラウザ経路は再試行しない。

## 詳細ログとローカル診断

Mortal Webの汎用エラーには、4つの原因候補が並ぶだけで今回どれが該当したかは書かれていない。公開フロントには、内部スタックトレースを取得する案内は確認できなかった。失敗タスクの閲覧で得たtimeoutも、最初の失敗箇所を確定する根拠ではない。

一方、公開 `mjai-reviewer` はローカルTenhou6入力と `--no-review` を持つ。モデル起動前にパース・MJAI変換を行うので、変換失敗の局/本場などはローカルで調べられる。今回、同じconvlogをSHA固定した開発用検査CLIを用意した。

- [検査CLIと限界](../tools/mortal-log-check/README.md)
- [固定レビュアーの処理順序](https://github.com/Equim-chan/mjai-reviewer/blob/2dc5ec5c8b28517cfb45f57eb21536d9a8f67aa9/src/main.rs)
- [convlogの詳細変換エラー](https://github.com/Equim-chan/mjai-reviewer/blob/2dc5ec5c8b28517cfb45f57eb21536d9a8f67aa9/convlog/src/conv.rs)

公開Mortalの `PlayerState::validate_reaction` と `update_with_keep_cans(event, true)` で4席の実手順も検査できる。後者はドラ表示やリーチ受理の通知で候補状態を保つ、上流validate_logsと同じ検査用動作。通常のPython updateだけでは通知直後に候補が消えるため、その診断ハーネス由来のエラーを元牌譜の不正と混同しない。

- [Mortalの検査用更新](https://github.com/Equim-chan/Mortal/blob/0cff2b52982be5b1163aa9a62fb01f03ce91e0d2/libriichi/src/state/update.rs)
- [上流validate_logs](https://github.com/Equim-chan/Mortal/blob/0cff2b52982be5b1163aa9a62fb01f03ce91e0d2/libriichi/src/bin/validate_logs.rs)

## 次の切り分け

検査を通った14局を、本人操作でMortal公式のカスタム牌譜（Tenhou6 JSON）へ入力したところ、4.1bでも4.0でも同じエラーとの回答を受領。URL入力側だけ、または特定のモデルだけに原因を絞れない。

さらに公式ja.htmlのカスタム入力欄自身のplaceholderを変更せず、通常ブラウザの有効な送信ボタンで1件だけ対照実験した。対象2/Mortal4.1b/KillerDucky/日本語で同じ汎用タスクエラーを観測。この公開サンプルもローカルでパース・変換・牌数検査を通過した。本人のデータとは独立した再現手順が得られたため、これ以上の利用者の再送は求めず、提供元の内部エラー確認へ進める。投稿は明示指示がある場合だけ行う。

受領した実データの特徴量version4への変換と、別の公開コミュニティMortal v3による対象席206局面のローカル推論も通った。ただしWeb4.1bの重み・デプロイ環境と同一ではなく、原因の断定やアプリのモデル変更の根拠にはしない。詳細はevidence/mortal-failure/verification.md。

この手順のために日常アプリのモデル基準、NAGA追加連携の保留、牌譜/学習履歴の保存仕様を変更しない。個人URL・対戦相手・実データ・詳細ログはリポジトリ外に保持する。

2026-11-03追記: 本人が時間を置いて再試行し成功したと回答し、結果ビューアーでもMortal4.1b / reviewer1.5.10 / Hanchanを確認した。作者への投稿は行っていない。一時的な失敗だった可能性はあるが、サーバー内部原因は未確定。次は成功した結果の取り込み/対象確認/復習への接続を扱う。エラーを直すための入力改変やモデル既定値変更は採用しない。
