# 回答欄の推奨度表示 — DEV-11.04-5

2026-11-04 JST。生成データで検証。実ユーザーのブラウザ・学習DBへ検証回答を入れていない。

- mainのPR #26をマージして競合を解決。先行の相手手牌開閉・fixture修正を保持。
- npm run check / npm run build 成功。
- 統合後のPython全体136件成功（core-integrated.log、362.638秒）。前回の旧Scene完全一致期待の不一致は、元Scene不変と追加投影値一致を別比較して解消済み。
- 隔離Edge4件成功（integrated-edge.log）。回答前非表示・不正配列拒否・旧pack受入・幅320/390/768・40.0%/40.0%/45.0%・選び直し後非表示を確認。390px生成画像をAI目視確認済み。
- 追加の対象Edge30件（Windows/iPhone、p3/p8/p14/offline-engine）を実行中。旧端末backupのpoliciesなしも復旧検証に含める。

実ユーザーブラウザの読み取りはComputer UseのURL確認不能で停止したため、再試行しない。本人からの「進めて」に基づき、専用APIの所有/処理0、DB snapshotと別ディスクbackupを確認し、専用APIから正常終了した。ユーザーブラウザ内の入力・端末内DBは操作しない。検証は別の生成DBと別controlで1460を使用し、終了後に普段使い版へ戻す。

配備先は E:/Apps/KyokuLoop、DBは従来の D:/dev-data/kyoku-loop/private/app。PR #27をGitHub mainへ統合して確認済みmain SHAから専用配備する。配備と実HTTPS、前後のDB全行・設定SHA照合は共有Task/private evidenceへ記録する。

私的根拠: D:/dev-data/kyoku-loop/private/comparison-policy-20261104。実端末のUX合格は主張しない。元JSON/新しい同期packのない旧端末では推奨度は「—」。
