# Mortal URL-only route research

確認日: 2026-11-02 JST

## 結論

雀魂の共有URLを `mjai.ekyu.moe` の公開Web画面へ手動で貼り、対象プレイヤーと Mortal を選んで解析依頼する経路は、公式に公開されている最小経路として確認できる。雀魂ブラウザ版へのログインや拡張機能を KyokuLoop から操作する必要はない。

一方、KyokuLoop が雀魂URLを受け取っただけで第三者サイトへ自動送信し、解析結果まで自動取得する安定した公開API・ディープリンクは、確認した一次資料には記載がない。通常ページのフォームは `POST /review` で、URL欄 (`log-url`)、対象プレイヤー (`player-id`)、エンジン (`engine`)、Mortalモデル (`mortal-model-tag`) などを送る構造で、hidden の `cf-turnstile-response` も含まれる。実証時には明示的なCAPTCHA操作は発生しなかったが、トークンの抽出・再利用やKyokuLoopからの自動クロスサイトPOSTは行わない。現時点で安全に成立するのは「KyokuLoopでURLを保存・正規化 → 公式レビュー画面を開く → ユーザーがURLを貼って送信 → 結果をKyokuLoopへ取り込む」という半自動経路である。

## 一次資料で確認できたこと

### 公開Webレビュー画面

`mjai.ekyu.moe` は入力として Tenhou/Mahjong Soul の Game URL を受け付け、エンジンに Mortal、対象プレイヤーを指定して送信できる。画面の注意書きは四人打ち・一般的な共通ルール・Mortal は半荘対応に限定している。結果は通常15日保持される旨も表示される。

これは「雀魂のゲーム画面にログインしてデータを抽出する」方法ではなく、共有URLをレビューサービスへ渡す方法である。任意の共有URLが必ず解決できることまでは、一次資料だけでは確定できない。

その後、ユーザー提供の共有URLを1件だけ通常フォームへ貼り、Mortal 4.1b（初期選択）・自動対象プレイヤー・日本語で通常送信し、進捗ページを経てKiller Mortal Reviewerの結果画面へ到達することを確認した。雀魂ブラウザへのログイン、拡張機能、手動CAPTCHA操作、トークン読み出しは行っていない。この結果は1件の実証であり、すべての共有URL・ルール・プレイヤー指定に一般化しない。

現行の通常ページで公開されているのはフォームUIと送信先であり、URLをクエリに渡して入力欄を事前入力する仕様は確認できない。`?log-url=...` や `/review?...` のような未文書パラメータを推測して採用しない。公開されている補助スクリプトもDOMの入力欄を操作する方式で、公式の事前入力APIを示すものではない。

### mjai-reviewer

公式READMEは Mahjong Soul を入力として扱えるWebアプリを案内し、「ダウンロード・インストール・拡張機能なし」と説明している。CLIはTenhou URLまたはローカルの `tenhou.net/6` JSONを入力にできる。

ただし、JSON出力/APIについての公式Issueでは、CLIのJSON出力は内部的で不安定であり、Webサイトの選択肢として公開していない旨がメンテナから説明されている。これは安定した外部APIが存在しないことの証明ではないが、当面の自動連携の根拠にはできない。

### Mahjong Soulログ変換の公式プロジェクト

公式の `tensoul` は Mahjong Soul ログをTenhou形式へ変換できるが、READMEの手順は雀魂へログインして開発者ツールから `access_token` を取得し、そのトークンを設定する前提である。これは今回の「ブラウザ版雀魂ログインなし・拡張機能なし」の条件を満たさないため採用しない。トークン取得や認証経路の自動化・回避も行わない。

### ローカルMortal

公式Mortal Docker資料は推論用イメージにモデルファイルを含めず、別途モデルを用意する前提である。公式ディスカッションでも、個人が学習したMortal 3.0の重みは未公開と説明されている。したがって、モデルをKyokuLoopへ同梱してURL貼り付けだけでローカル解析する案は、現時点では成立条件を満たさない。

## 区分

### 確認済み

- 公開レビュー画面へMahjong Soul Game URLを入力し、Mortalと対象プレイヤーを選択するUIがある。
- 通常送信は `POST /review` のフォームで、`log-url`、`player-id`、`engine`、`mortal-model-tag` 等を含む。hiddenのCloudflare Turnstile応答もフォームに存在するが、実証時に明示的チャレンジは表示されなかった。
- Mortal側の対象範囲は四人打ちの半荘・一般的な共通ルールに限られる。
- 公式の雀魂ログ変換ツールは認証トークンを要求する。
- ローカルMortalはモデルファイルを別途必要とする。

### 推定・実装上の判断

- URL保存、入力前処理、公式レビュー画面を開くところまではKyokuLoop内で安全に実装できる。
- 第三者サイトへの自動送信、結果ページのスクレイピング、未公開エンドポイント利用は、公開仕様がないため実装しない。
- 最小UXは「URLを貼る」「Mortalで解析を開く」「公式画面で送信」の3段階にし、解析結果URLまたは対応する結果ファイルを手動で取り込む。

### 未確認

- ログインしていない状態で、ユーザーが所有する共有URLを公開レビュー画面が常に取得できるか。
- 公開レビュー画面が将来、安定したURLパラメータ・API・結果エクスポートを提供するか。
- 解析結果を第三者サイトから直接取得してKyokuLoopへ自動取り込みできるか。
- 通常ページにURLを渡して入力欄を事前入力する、公式に文書化されたクエリパラメータが存在するか。

なお、KyokuLoop側で外部結果取得を試した際に403で停止した検証は [MORTAL-IMPORT.md](MORTAL-IMPORT.md) に記録している。再試行、User-Agent変更、プロキシ、認証回避は行わない。

## 推奨する次の実装境界

### Phase A: すぐ実装できる半自動経路

1. KyokuLoopで雀魂URLを正規化して解析待ちに保存する。
2. 「コピーしてMortalへ」を押すと `https://mjai.ekyu.moe/ja.html` を開き、URLをクリップボードへコピーする。
3. ユーザーが公式画面でURLを貼り、対象プレイヤー・Mortalを選択して送信する。Turnstile等の確認が表示された場合もユーザーのブラウザ操作に任せ、トークンはKyokuLoopへ渡さない。
4. 結果URLまたは公式に提供されるエクスポートを、KyokuLoopの既存Mortal取り込みへ手動で渡す。

この範囲なら雀魂ブラウザへのログイン、拡張機能の自動操作、有料解析の自動実行は不要である。

### Phase B: 保留条件

URL貼り付けだけで送信・取得まで自動化するには、Mortalサービス提供元が明示した公開API、許可されたインポート機能、または安定した公式ディープリンクの確認が必要である。それが確認できるまで、非公開エンドポイントの推測やスクレイピングは行わない。

## 一次資料

- [mjai.ekyu.moe 公開レビュー画面](https://mjai.ekyu.moe/)
- [mjai-reviewer README](https://github.com/Equim-chan/mjai-reviewer)
- [mjai-reviewer Mahjong Soul guide](https://github.com/Equim-chan/mjai-reviewer/blob/master/mjsoul.adoc)
- [mjai-reviewer Issue #129: JSON/API discussion](https://github.com/Equim-chan/mjai-reviewer/issues/129)
- [tensoul README](https://github.com/Equim-chan/tensoul)
- [Mortal Docker / model requirements](https://mortal.ekyu.moe/user/docker.html)
- [Mortal discussion #97: model availability](https://github.com/Equim-chan/Mortal/discussions/97)
- [MahjongSoul-review-supporter: MjaiList.vue](https://github.com/kbkn3/MahjongSoul-review-supporter/blob/develop/src/popup/MjaiList.vue)
- [MahjongSoul-review-supporter: mjai.content.ts](https://github.com/kbkn3/MahjongSoul-review-supporter/blob/develop/src/entrypoints/mjai.content.ts)


## 実装した導線（DEV-11.02-6）

Windowsホームの雀魂共有URL欄に貼り、「コピーしてMortalへ」を押すと、正規化したURLを解析待ちへ保存し、クリップボードへコピーし、通常の日本語レビュー画面を開く。外部ページにはクエリ等で個人URLを付けない。通常の「保存」も残す。iPhone側のオフラインURL保存・同期は従来どおり。

保存済みの項目からも同じ操作で再度コピーして開ける。外部ページでは牌譜URL欄に貼り、AIがMortalであることを確認して「送信」を押す。自動POST、外部DOM操作、Turnstile応答の読み出し/再利用、解析完了の自動判定はない。開いただけでは依頼済みにせず、既存の本人申告状態と区別する。

コピー拒否では入力URLを残し、手動コピーを案内する。保存失敗では入力を消さず、保存成功を表示しない。ポップアップはユーザーの操作内で、保存応答を待たずに開くため、保存失敗時にも外部の通常画面だけが開く場合があるが、新規解析を自動送信することはない。

コピー後の案内には通常リンク「Mortalを開く」も置く。ポップアップが抑止された環境でも入力ページへ進める。通常ブラウザの実Clipboard APIと新規ページ生成は、外部通信を架空入力ページへ置き換えた両幅の画面テストで確認する。実ブラウザ画面でも、保存済みURLのコピーと日本語レビュー入力画面への移動を確認した。解析依頼済みの状態は変更しない。

結果URLのアプリHTTP取得は403で停止した既存の制限を引き継ぎ、再試行や回避を加えない。結果のJSON取り込みは前段の実装を継続する。今回の新しい結果自体のJSON取得・アプリ本登録は未実施であり、「URLだけで解析から結果取込まで完結」の合格とはしない。

## 検証記録

`npm run check` と `npm test` 内のビルド・Python97件は成功。初回の全画面92件は90成功・2失敗で、新規導線8件はすべて成功した。既存のPWA検査では更新候補がredundantになった直後にもキャッシュが見える例、端末URL保存検査では5秒以内に一覧が出ない例があった。同じ2検査はスマートフォン幅では成功している。

失敗した検査は、インストール中の候補がなくなり不整合キャッシュが消えることを最大15秒のpollで待つ形と、実Pythonを呼ぶ試験側の停止に合わせて保存行を最大30秒待つ形に修正した。記録保持・再起動・旧版維持・次の正常更新の条件は残し、アプリ本体のPWA/保存処理は変更していない。`npm run check` と該当ファイルの両幅12件を再実行し、すべて成功（3.2分）。その他の検査は変更のない初回成功結果を利用する。初回の `npm test` 自体が全件成功したとは扱わない。
