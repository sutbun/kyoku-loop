# Mortal入力のオフライン診断

開発用CLI `kyokuloop-mortal-log-check 0.1.0`。ローカルのTenhou6 JSON、または `https://tenhou.net/6/#json=...` を保存したテキストを1ファイルずつ検査する。Mortalのモデル・アプリDB・Web解析・認証情報は使わない。入力中のURLを開く処理もない。

Mortalレビュアー1.5.10の公開 `convlog` をSHA固定して使用する。Webサーバー側のデプロイSHAが一致することは未確認であり、Webの実行ログを取り出す機能ではない。

```powershell
cd E:/dev/kyoku-loop
$env:CARGO_TARGET_DIR = 'E:/dev/kyoku-loop/node_modules/.cache/mortal-diagnostics-rust'
cargo build --locked --manifest-path tools/mortal-log-check/Cargo.toml
& ./node_modules/.cache/mortal-diagnostics-rust/debug/kyokuloop-mortal-log-check.exe D:/dev-data/kyoku-loop/private/target-log.txt
```

ビルド時は公開依存を取得する。生成したCLIの検査処理はオフライン。終了コードは0が検査通過、1が入力/検査失敗、2が呼び出し不正。

`--mjai-out <新しいファイル>` を追加すると、検査通過後だけMJAIイベント列を保存する。出力先が存在すれば失敗し、上書きしない。生成データも私的領域に置く。

| stage | 内容 |
| --- | --- |
| `input_json` | JSON、UTF-8、貼り付けURLのローカルデコード |
| `upstream_tenhou_parse` | 公開レビュアーのTenhou6パーサー |
| `rules` | 空の対局・東風を拒否。半荘判定は上流と同じルール表示文字列に基づく |
| `upstream_tenhou_to_mjai` | 公開レビュアーの変換処理。ドラ欠落、鳴き/手順の整合性などの詳細をそのまま返す |
| `physical_tiles` | 初期手牌・ツモ・公開ドラの同種4枚制限（通常/赤5を合算）、各局70ツモ制限 |
| `pre_engine_checks` | 上記を通過。実際のモデル推論や全ルールの互換性を保証するものではない |

牌数は移動では増やさず、新たに判明した物理牌だけを数える。捨て牌・鳴きの再表示を重複計上しない。裏ドラはこの追加集計の対象外。推論・全合法手検証・対象プレイヤー本人照合は実行しない。Mortalの汎用エラーの4候補だけで原因を確定しない。

実牌譜、ファイル名/結果ログ、変換前後のデータは `D:/dev-data/kyoku-loop/private` に置く。検査に失敗した入力を自動修復・送信しない。複数の局単位URLを渡す場合は、元の全行を保全してから1行1ファイルへ分けて検査する。由来の異なる対局を混ぜない。

一次ソース: [固定convlog](https://github.com/Equim-chan/mjai-reviewer/tree/2dc5ec5c8b28517cfb45f57eb21536d9a8f67aa9/convlog)、[Mortalを起動しないCLI経路](https://github.com/Equim-chan/mjai-reviewer/blob/2dc5ec5c8b28517cfb45f57eb21536d9a8f67aa9/src/main.rs)。
