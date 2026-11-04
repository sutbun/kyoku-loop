# Mortal Kakan and copyable diagnostics

2026-11-05 / アプリ・Helper DEV-11.05-2。本人から一括登録が4/11件で停止した報告と、診断情報を簡単にコピーしたい要望を受領した。個別の実ID/URL/原本/学習記録はGitへ置かず、根拠は `D:/dev-data/kyoku-loop/private/mortal-kakan-state-20261105/` と前段 `mortal-chrome-stop-20261105/` に保持する。

## 原因

旧adapterは加槓後のreview副露を通常の鳴きと同じ`pai`と`target`で解釈し、4枚目と元のポン相手を復元できず拒否していた。作者の[State::Fuuro::Kakan](https://github.com/Equim-chan/mjai-reviewer/blob/master/src/state.rs)に合わせ、手持ち2枚・元の鳴いた牌・追加牌の計4枚と元のポン相手を照合する。欠落/不正型/枚数/牌/相手の不一致を許可せず、原本/ID/評価と前回の同一牌検証を保持する。

## 検証

- 架空の加槓回帰3件。公式形の受入は修正前に同じ復元エラー、修正後に成功。元のポン相手/鳴いた牌/追加牌の変更、必須項目の欠落や枚数違いを拒否。
- check/build、全Python162、関連12（拡張隔離ブラウザ検査を含む）成功。変更後の加槓回帰も最終状態で成功。
- 本人の最新結果の全98判断を原本のSHAを維持して検証。保存済みMortal22結果もread-onlyで再計算し、ID/source/全判断/重要判断が従来と一致した。
- CPythonと同梱Pyodideのreport ID・3問・各37評価値が1e-12で一致。正本の隔離コピーで既存stage/commitによる本人指定元対局への登録・3問・重複再登録を確認し、旧source/report/問題/回答/中断/対象外設定を全行保持、integrity ok。
- 診断文字列2件成功。現在のjobを特定して進捗/生の停止コード/牌譜ID/モデル/送信済み/結果ID/保存先/ACK/保持JSONだけを出力し、JSON本体・Cookie・token・回答を含めない。不明な状態を送信/保存成功としない。
- 実拡張を隔離Chromiumへ読み込んだコピー操作を確認。クリック時のuserActivationと必要なコピー内容、拒否時に同じ内容をreadonly文字欄へ表示・全選択する動作が成功。Clipboardの書込先はメモリのテストダブルで、OSのクリップボードは変更していない。AIが生成popup画像を観測した。実ユーザーのクリップボードUX合格とは区別する。
- 更新器4件成功。元の読込パスと旧コードbackupを保持し、標準20パスの配備記録を変更せず既存21パスも明示更新/再更新できる。改変ファイル・未知ファイル・root外パスを拒否。package/manifestの版一致と全12コードファイルのhashを必須とする。

公開Mortalへの解析依頼/結果取得と正本DB書込は開発検証で0。日常版への反映と本人の保留JSON登録は既存の専用配備・正常終了・バックアップ・既存登録APIを使う。Helperは同じ読込元のファイルを更新し、再読込後もID/送信台帳/IndexedDBのJSON/4件成功済みの進捗を保持する。ブラウザUIの既知URL判定不可は再試行しない。
