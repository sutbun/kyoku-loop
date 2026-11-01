# 牌譜屋のAIレビュー導線

2026-11-02。本人提示のプレイヤー履歴ページを通常の公開画面で確認した。個人ページURL・ID・名前・対局履歴・実牌譜URLはGitに保存しない。

## 結論

**履歴の確認と、MortalのURL入力を省く入口に利用できる。** 牌譜屋自身がMortal解析やMortal向け原牌譜を提供する別経路であるとは確認できない。

公開画面では、対局の日時・順位・プレイヤー・雀魂牌譜リンクと「AI レビュー」が表示された。AIレビューのリンクは次の形だった。

```text
https://mjai.ekyu.moe/ja.html?url=<URLエンコードした雀魂共有URL>
```

これは推測パラメータではない。牌譜屋の公開実装は `GameRecord.getRecordLink(game, player)` を `encodeURIComponent()` で `url` に渡しており、日本語表示では日本語Mortal画面へ向く。選択プレイヤーの雀魂共有URLに含まれる `_a...` を保持する。

## 実画面での確認

1. 新しい通常のin-appブラウザタブで本人提示の履歴ページを開き、AIレビューリンクのhrefを読み取った。
2. 同じ正規リンクを開き、Mortalの「牌譜URL」欄に、リンクで渡された雀魂URLが入力済みになることを確認した。
3. 対象プレイヤーは「自動」、使用AIはMortal、モデルは4.1bの初期選択だった。対象プレイヤーの実解析での解決は今回未検証。
4. 解析送信操作は行わない。観測時点で送信ボタンはdisabledだった。これを解除する操作、CAPTCHA操作、token読み出し、既知拒否HTTP結果取得・専用ブラウザ自動送信経路の再試行は行っていない。

この確認に雀魂ブラウザログインや拡張は使用しなかった。URL入力済み画面への到達と、解析送信・完了・結果取り込みは区別する。今回は新しい解析結果は作成していない。

Mortal公開JSの `init()` は `new URLSearchParams(location.search).get('url')` を `input[name=log-url]` の値に設定し、`changeURL()` を呼ぶ。ここではsubmitを呼ばない。通常フォームの送信先は `POST /review` であり、Turnstileの要件も残る。

## 履歴APIとの違い

牌譜屋の公開フロントの `player_records` / `games_by_id` 等は、UUID、日時、プレイヤー、順位等の対局メタデータを扱う。公開コードで確認したこの契約は、手牌・ツモ・打牌・副露を含むMortal解析用原牌譜JSONの取得契約ではない。今回、履歴の自動収集・一括解析や追加のAPI実データ保存は行っていない。

サイト自身も非公式でデータの完全性を保証せず、対局が載るまで数分〜数時間の遅延があると表示する。収録されない対局も想定する。閲覧できる履歴の存在を、任意の共有URLの原牌譜を取得できる根拠にしない。

## KyokuLoopに使う場合の最小案

既存の正規化済み雀魂URLから上記の `?url=` リンクを作り、「Mortalを開く」でURL入力済み画面へ進む。保存済み項目にも同じ方式を使える。クリップボードへのコピーとMortal画面での貼り付けを省く。Mortal画面で対象プレイヤー・モデルを確認し、本人が送信する。

URLだけの全自動解析や結果自動回収は別条件のまま。リンクを開いただけで解析依頼済みへ変えない。第三者サイトへのURLクエリ付与は既存11.02-6の動作から変わるため、導線と送信範囲を明示して製品へ採用する。今回は研究メモの保存だけで、普段使い版のコード・記録を変更していない。

この発見で「URL事前入力仕様を確認できない」という以前の調査は更新する。自動POST・結果取得APIの存在まで確認できたとは扱わない。

## 一次資料

- [牌譜屋・AIレビューリンクの生成](https://github.com/SAPikachu/amae-koromo/blob/master/src/components/gameRecords/gameLinkActions/dialog.tsx)
- [牌譜屋・雀魂URLの生成](https://github.com/SAPikachu/amae-koromo/blob/master/src/data/types/record.ts)
- [牌譜屋・データAPIクライアント](https://github.com/SAPikachu/amae-koromo/blob/master/src/data/source/api.ts)
- [Mortalの公開JavaScript](https://mjai.ekyu.moe/index.js?d=d29fde14)
- [Mortalの通常の日本語入力画面](https://mjai.ekyu.moe/ja.html)
