# Mortal汎用エラーの診断準備

2026-11-02。アプリ11.02-8のコード/配備は変更せず、開発用CLI 0.1.0と取得手順を追加した。

## 取得と保全

本人は既存Brave拡張を一回限りの診断に使うことを了承し、変換した14行のTenhou6 URLを提供した。最初に報告した対象とは日時が異なるが、そのデータの対局を改めてMortalで実行して失敗したとの回答と、新しい失敗タスクURLを受領した。最初の対象の原牌譜を入手したとは扱わない。

原文はprivate/mortal-failure-20261102/received-exportへ保存。手入力し直さず、今回の受領メッセージを特定してそのまま保全した。全局のタイトル・名前・ルールが一致することを確認し、局配列だけを元の順序でまとめた別のJSONを作成。実牌譜、個人URL、対戦相手、詳細ログをGitへ入れない。

## 検査結果

- `cargo test --locked --manifest-path tools/mortal-log-check/Cargo.toml`: 最終8件成功。
- `cargo clippy --locked --manifest-path tools/mortal-log-check/Cargo.toml --all-targets -- -D warnings`: 成功。
- `cargo build --locked --manifest-path tools/mortal-log-check/Cargo.toml`: 成功。
- ドラ不足が上流変換の局/本場付きエラーになること、同種5枚・通常/赤5の合算・71ツモ・東風・空/壊れた形式・URLデコード・出力先の上書き拒否を確認。ドラ不足試験の追加時にjson!マクロの配列構文を修正し、export追加後のClippy指摘も修正して最終成功。
- 以前提供された別の9局分も、オフラインでパース/変換/牌数検査に成功。これは失敗対象の検査結果とは分ける。
- 今回受領した14局は、全局個別と14局結合版のどちらもパース/変換/物理牌検査に成功。結合版は1,355イベント。
- 既存の公開MortalソースSHA `0cff2b52982be5b1163aa9a62fb01f03ce91e0d2` から検査用Rust exampleをprivate cacheに作成し、4席の `validate_reaction` / `update_with_keep_cans(event, true)` に通した。1,355イベント・703判断で成功。モデル推論やWeb4.1bの実行成功ではない。

最初のPython PlayerState.updateを使った試験では、ドラ通知直後の候補消失でcannot discardになった。これは検査ハーネスの使い方の問題。上流validate_logsと同じkeep_cans=trueのRust検査へ切り替えて全件通ったので、元牌譜の不正やMortalの製品バグとは扱わない。イベント順/ドラ/手牌を修正していない。native実行時のPython DLL探索もプロセス限定PATH追加で解決し、システム設定は変更していない。

## アプリ側と限界

`npm run check` / `npm run build` は成功。Web/Python/SQLite/PWAの実装は変更しておらず、直前の成功証拠を利用し、今回のnpm test全件再実行・成功とは主張しない。診断CLIにネットワーク、認証、解析送信、モデル、DB操作はない。Rustのビルド依存取得とオフライン実行は区別する。

次は検査済みJSONをMortalの公式カスタム入力に本人が貼り、明示プレイヤー・4.1bで通常送信する確認を依頼した。JSON入力なら雀魂URLの取得・変換・自動対象解決を経由しない。結果はまだ未受領で、エラー解決・サービス障害・特定変換器の不具合を断定しない。日常のURL導線への自動修復/送信やNAGA追加連携は実装しない。

詳細はprivate同フォルダーのsummary.json / native-state-validation.json。公開の処理と取得方法の根拠はdocs/MORTAL-RAW-LOG-ACQUISITION.mdとtools/mortal-log-check/README.md。
