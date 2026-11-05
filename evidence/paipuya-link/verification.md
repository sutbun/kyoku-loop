# 牌譜屋リンクの検証

- 開発版DEV-11.05-10。Windowsの「牌譜屋から一括追加」とphone/iPadの「牌譜 → URLを追加」にリンクを追加。
- 個人のプレイヤーURLはGit外のexternal-links.jsonからビルド時に取り込む。未設定はトップ。HTTPS/ホスト/プレイヤーパスを限定し、認証情報・クエリなど不正設定は拒否。
- check/build成功。Python全166件成功（499.948秒）。
- Edgeの既存タブ/URL一括/学習/バックアップ回帰32件成功。件数表示を取り込んだ最終ビルドで、設定検証・Windows/phoneのリンク/別タブ/入力保持を6件成功。
- 外部ページは架空応答に差し替え、牌譜屋/Mortalへの実HTTP要求は0。生成したWindows/phone画像をAIが目視確認。
- 本人URLが追跡ソースに含まれないことを確認。私的画面根拠はD:/dev-data/kyoku-loop/private/paipuya-link-20261105。
- 実iPadでのショートカット利用・本人UXの新しい合格は未確認。
- 配備は確認済みmainと専用スクリプトを使う。配備後のSHA/PC/本人HTTPS/Worker/hashとDB保持は私的deployment.json/前後auditへ記録する。
