# iPad共有ショートカット手順の検証

2026-11-03。成果物はdocs/IPAD-MORTAL-JSON-SAVE.md（手順v1）とdocs/IPAD-SHORTCUT-DISTRIBUTION-RESEARCH.md。本人はMacなし・iPadで初回設定を選択。署名なしファイルの配布や未知の署名サービスを導入せず、Appleの標準アクションで作成する手順を用意した。

- 文書からコピー欄の検索/置換後/照合パターンを抽出し、架空URLで検査。killerducky・report・progressと%2F/%2f表記の7件を既存canonical_urlと照合し一致。
- 別ホスト・HTTP・userinfo・port・不正ID・追加query/fragment・外部data・二重percent encoding・複数行等21件は後段の照合で拒否。これはPython上の正規表現検査であり、iPadOSの正規表現実行を代替しない。
- 私的保存済みJSONを辞書→UTF-8 JSONへ書き直し、既存decodeと正規化digestが一致することを確認。これはPython上の意味保存の確認であり、実際のShortcuts書き出しを実証しない。
- 初期URLを既知のホスト/パスへ限定。GETは1回で、ヘッダー偽装・Cookie持込み・独自proxy・繰返し・新規解析を指示しない。不正URLはGET前に、HTMLは辞書変換で、非Mortal辞書はengine検査で保存へ進まない構成。
- 実MortalへのHTTP要求0。Windowsの既知403経路を再開しない。実iPadの共有・取得可否・ファイル選択・登録は未確認。拒否が出たらその取得を停止する。
- アプリ実装・依存・DB/API/端末記録に変更なし。日常版11.03-2は継続。前段のcheck/build、全体Python125/Edge110件＋最終関連Python25/Edge10件を、変更のないアプリ部分の根拠として再利用し、本件でそれらを再実行したとは扱わない。

詳細な私的結果は D:/dev-data/kyoku-loop/private/ipad-shortcut-20261103/verification.json。実URL、原JSON、名前、認証、端末保存先はGitへ登録していない。
