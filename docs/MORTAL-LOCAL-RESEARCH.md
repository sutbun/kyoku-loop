# ローカルMortal経路の技術検証

2026-11-02。目的は、Web解析サービスの自動依頼に依存せず、雀魂ログイン・拡張なしでURLから解析できる別経路の評価。URL取得と解析を別々に判定する。

## 判定境界

| 部分 | 現在の判定 |
|---|---|
| 日本サーバーの雀魂URL → 原牌譜 | 別の利用可能な公開経路は未確認。詳細は [サービス調査](MORTAL-ALTERNATIVE-SERVICES.md) |
| 公開モデル → Windows CPU推論 | 固定モデル・架空5局面で合格。打牌64候補の合法性を検査 |
| Tenhou JSON → 全判断の解析・復習 | 今回のprobeには未実装。通常の結果取り込みは既存reviewer 1.5.10のまま |
| URL貼付だけの自動完結 | 未達。probeの成功をこの合格へ拡大しない |

取得候補の牌谱工房は日本サーバーが現在 `unavailable`。現行Webフォームには画像認証がある。旧デスクトップAPIを使ってその認証を省く実装や、日本サーバーへの実URL送信は行わない。本人ログインなしのURL取得と、本人アカウントを使う独自クライアントは異なるため、後者を無断で採用しない。

## 固定した検証資材

- Mortal公式 `Equim-chan/Mortal` commit `0cff2b52982be5b1163aa9a62fb01f03ce91e0d2`。AGPL-3.0-or-later。公式手順で `libriichi` をソースビルドし、`PlayerState` と観測v3を使う。
- コミュニティモデル `hhim8826/mortal3-b40c192` revision `7784a9deddf63df03f023474116f715850d3c7a0`。公開モデルカードはAGPL-3.0、四麻半荘・赤ありを記載する。公式Web版4.1bとは別で、公式モデルや人間に対する強さは不明。
- `mortal.onnx`: 45,437,193 bytes、SHA-256 `ce6c44cb25f9381cb31065a035556df2ea5e86107b44151a8eff8c266e40971e`。
- 入力 `obs: float32[batch,934,34]`、`mask: bool[batch,46]`、出力 `q: float32[batch,46]`。ONNX RuntimeのCPUを使い、PyTorch pickleは読まない。
- 検証環境はCPython 3.12.14、NumPy 2.5.4、ONNX Runtime 1.31.1、Mortalのlibriichi release build。通常のアプリ用Pythonやシステム設定は変更しない。
- モデルや環境は `D:/dev-cache/kyoku-loop/`、Rustビルド出力は無視対象の `node_modules/.cache/mortal-rust/`。Gitに重み・実牌譜・URLを入れない。

出所・ライセンスは公開元の表明であり、公式モデルとの同一性や学習データ提供元の個別許諾を表すものではない。モデルを普段使いの解析基準に変更する前に、別モデルであることを本人に確認する。

## probeの範囲

`tools/mortal_local_probe.py` は開発者向けの独立CLI。URLやユーザー牌譜の入力、ネットワーク、SQLite操作、アプリ起動、ダウンロード機能は持たない。固定SHAを先に検査し、その後でモデルをロードする。

生成した5局面について、合法手マスク、全合法Qの有限性、再推論の一致、他家の見えない手牌を交換しても観測が変わらないこと、赤5筒と通常5筒の別選択、打牌候補のルール上の合法性を検査する。Q値を公式の一致率や勝率として表示せず、和了ガード・槓の選択・鳴きの見送り・全牌譜の判断照合も合格に含めない。

実行結果は [検証証拠](../evidence/mortal-alternative-route/verification.md)。固定SHA確認・公式libriichiのreleaseビルド後、5局面の実推論がexit 0。通常Pythonの回帰101件とcheck/buildも成功した。全画面試験は製品コード不変の既存証拠を利用し、今回の新規成功とは扱わない。

依存するnative環境がない通常のPythonテストでも、偽モデルのロード前拒否、違法な高Qの除外、不正Q/マスク拒否、生成牌の枚数制約を確認する。

## 再現

ビルドはMortal公式手順を使用し、Python環境とCargoの保存先を明示する。Windowsの `target/release/riichi.dll` を、同じPython環境の `Lib/site-packages/libriichi.pyd` にコピーする。モデルは上記revisionから取得してSHAを照合する。

今回の公式ソースcheckoutは `D:/dev-cache/kyoku-loop/Mortal-upstream`。固定commitを確認した上で、そのディレクトリから実行する。

```powershell
$env:CARGO_HOME = 'D:/dev-cache/cargo'
$env:CARGO_TARGET_DIR = 'E:/dev/kyoku-loop/node_modules/.cache/mortal-rust'
$env:PYO3_PYTHON = 'D:/dev-cache/kyoku-loop/mortal-onnx-env/Scripts/python.exe'
cargo build -p libriichi --lib --release --locked
Copy-Item -LiteralPath E:/dev/kyoku-loop/node_modules/.cache/mortal-rust/release/riichi.dll -Destination D:/dev-cache/kyoku-loop/mortal-onnx-env/Lib/site-packages/libriichi.pyd
```

続いてKyokuLoopのcheckoutから実行する。

```powershell
python -m unittest discover -s tests -p test_p9_mortal_local_probe.py
& D:/dev-cache/kyoku-loop/mortal-onnx-env/Scripts/python.exe -m tools.mortal_local_probe --model D:/dev-cache/kyoku-loop/models/hhim8826-mortal3-b40c192/mortal.onnx
```

## 次へ進める条件

1. probe成功後も、本番アプリ・既存の問題・モデル基準は変更しない。
2. 日本サーバーに対応する通常の牌譜取得経路が確認できれば、その利用条件・現行状態を確かめる。新しい第三者送信先を使う場合は、送信範囲を具体化して本人に確認する。
3. ローカル解析を製品へ入れる場合は、モデル選択を確認し、実牌譜の判断・赤牌・副露・槓・リーチ・局境界を原本と照合してから取り込みへ進む。

## 一次資料

- [Mortal公式ソース](https://github.com/Equim-chan/Mortal/tree/0cff2b52982be5b1163aa9a62fb01f03ce91e0d2)
- [Mortal公式ビルド手順](https://github.com/Equim-chan/Mortal/blob/0cff2b52982be5b1163aa9a62fb01f03ce91e0d2/docs/src/user/build.md)
- [モデルカード](https://huggingface.co/hhim8826/mortal3-b40c192)
- [固定モデルのONNXメタデータ](https://huggingface.co/hhim8826/mortal3-b40c192/blob/7784a9deddf63df03f023474116f715850d3c7a0/mortal.onnx.json)
- [同モデルを使う公開SpaceのONNX実装](https://huggingface.co/spaces/hhim8826/mortal-mahjong/blob/7039bd8c428232d389404761ced1a2f9c31a2ac4/onnx_engine.py)
- [牌谱工房の公開状態](https://ninklang.tech/api/v1/public/service-info)
