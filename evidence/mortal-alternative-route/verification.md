# 別Mortal経路の検証

2026-11-02。対象は研究用CLIと一次資料調査。日常版11.02-6の製品コード・データ・モデル基準を変更しない。

## 結果

- 日本サーバーの共有URLを、本人雀魂ログイン・拡張なしで取得できる別の利用可能な公開経路は調査範囲で見つからなかった。
- 牌谱工房の公開サービス状態は中国サーバーだけ `operational`、日本・国際サーバーは `unavailable`。現行Webフォームは画像認証を要求する。実URL送信なし。
- 既知のmjai HTTP拒否／専用ブラウザ拒否経路を再実行せず、認証・CAPTCHA回避、別UA/proxy/Cookie経路、無料/有料の新規Web解析も実行しなかった。
- 公開コミュニティMortalモデルのCPU推論を、生成した5局面で確認した。URLからの原牌譜取得、全牌譜解析・登録・復習の成功とは異なる。

## 固定資材

Mortal公式ソース `0cff2b52982be5b1163aa9a62fb01f03ce91e0d2` の `libriichi` をWindows releaseビルドした。初回CargoはDNS失敗、通常の名前解決の回復を確認後に一度再実行し成功（4分8秒）。リンクのライブラリ生成メッセージはwarningでありexit 0。ブラウザや解析サービスの拒否を回避したものではない。

モデル `hhim8826/mortal3-b40c192` revision `7784a9deddf63df03f023474116f715850d3c7a0`、ONNX 45,437,193 bytes、SHA-256 `ce6c44cb25f9381cb31065a035556df2ea5e86107b44151a8eff8c266e40971e`。ダウンロードは初回途中終了のサイズ/SHA不一致を成功とせず、再取得後に固定値と一致したファイルだけ使用した。

CPython 3.12.14 / NumPy 2.5.4 / ONNX Runtime 1.31.1 / CPUExecutionProvider、2推論スレッド。通常Python、アプリ設定、GPU環境は変更しない。モデル・環境・実行ログは `D:/dev-cache/kyoku-loop/`、Rust出力は `node_modules/.cache/mortal-rust/`。

## 実推論

実行:

```powershell
& D:/dev-cache/kyoku-loop/mortal-onnx-env/Scripts/python.exe -m tools.mortal_local_probe --model D:/dev-cache/kyoku-loop/models/hhim8826-mortal3-b40c192/mortal.onnx
```

exit 0。モデルロード0.630秒、5局面について状態生成/二度推論/検査の合計0.857秒。初回の一観測であり、半荘全体の処理時間や最低性能を保証しない。

| 生成ケース | 座席 | 最高Qの行動 | 合法行動数 | ルール検査した打牌数 |
|---|---:|---|---:|---:|
| 1 | 0 | 西 | 14 | 14 |
| 2 | 1 | 1筒 | 12 | 12 |
| 3 | 2 | 南 | 12 | 12 |
| 4 | 3 | 西 | 13 | 13 |
| 5 | 0 | 發 | 13 | 13 |

全ケースで合法Qが有限、同一観測の二度の推論結果一致、他家の隠れた手牌の交換による観測/マスク不変、全打牌候補の `PlayerState.validate_reaction` 合格。ケース1で通常5筒（slot13）と赤5筒（slot35）の両方が別々に合法選択となった。

これは打牌を含む5架空局面の技術検証である。公式Webモデル4.1bとの同一性、判断品質、実牌譜、鳴き見送り・槓・リーチ・和了ガード・局境界・対象座席照合や全牌譜レビューは未検証。ローカルモデルをユーザーの解析基準へ自動変更しない。

## その他の検証

- probeガード4件成功。通常アプリのPythonでも実行でき、未固定モデルをnativeロード前に拒否、違法な高Qを除外、非有限Q/不正マスクを拒否、生成牌の枚数制約を検査。
- `npm run check` / `npm run build` 成功。
- `python -m unittest discover -s tests -p test_p*.py` 全101件成功（264.703秒）。今回追加4件を含む。
- 製品UI/HTTP/SQL/PWA/同期は変更なし。画面試験は直前の変更していない製品コードの既存証拠を利用し、今回新たに `npm test` の全画面合格を主張しない。

調査正本は [サービス調査](../../docs/MORTAL-ALTERNATIVE-SERVICES.md) と [ローカル検証の範囲・一次資料](../../docs/MORTAL-LOCAL-RESEARCH.md)。ユーザー提供の実URL、名前、原牌譜、アカウント、Cookie、学習記録、モデル重みをこの証拠やGitへ含めない。
