# Mortal代替経路の調査

調査日: 2026-11-02（JST）
目的: ブラウザ版雀魂へのログイン・外部拡張を使わず、雀魂共有URLからMortalの解析まで到達できる、既存の公開経路を確認する。
制約: 実牌譜の送信、認証情報の入力、課金解析、認証・アクセス制限の回避は行っていない。

## 結論

現時点で、次の条件をすべて満たす、既知のmjai経路以外のホスト型Mortal公開APIは確認できなかった。

- 雀魂共有URLを受け取る
- 雀魂ブラウザのログイン不要
- 拡張機能不要
- Mortalを明示的に使う
- 結果を機械可読な形式で返す、公開・安定したAPI契約がある

ただし、実用候補として **ninkjin/Majsoul-Mortal-Analyzer + ninklang.tech** がある。これは公開リポジトリの説明上、URLを匿名デスクトップ接口へ送信し、サーバー側で牌譜を取得・Tenhou 6 JSONへ変換した後、Mortal自体は利用者PCで実行する経路である。したがって「Mortalのホスト解析API」ではなく、**牌譜取得サービス + ローカルMortal** である。

この候補は雀魂ログイン不要・拡張不要という要件に近く、公開ページで利用規約と保存期間も確認できた。ただし、日本サーバーは現在利用不可で、現行Webフォームは画像認証を要求する。現時点の日本サーバー向けURL取得先としては組み込まない。取得サービスの付属モデルの出所も未確認であり、別の公開コミュニティモデルを独立検証した（[ローカル検証](MORTAL-LOCAL-RESEARCH.md)）。

## 候補A: ninklang.tech + ninkjin/Majsoul-Mortal-Analyzer

### 一次ソースで確認できること

公開READMEは、ツールの目的を「雀魂共有リンクを貼る → 牌譜取得 → Mortal実行 → ローカル復盤」と説明している。取得方式として `ninklang.tech 在线获取` と `tensoul 本地账号密码获取` を選べるが、前者は雀魂アカウントの入力を要求しないと記載されている。

匿名経路についてREADMEが明記する内容:

- API Keyなしで利用できる匿名デスクトップ接口（ただし、現在の公式公開ページは画像验证码を要求する。READMEの「验证码なし」という記述と現行ページには差分がある）
- IPごと、未完了タスク数、全体日次额度による制限
- サーバー側で牌譜を取得・Tenhou 6 JSONへ変換し、ローカルMortalへ渡す
- 復盤データと分析履歴はクライアント側の `viewer-data/` と `tmp/paipu_jobs/` に保存

クライアント実装は、匿名経路を `POST /api/v1/desktop/requests` とし、JSONボディに `share_url` を送る。応答の `request_id` と短期の `request_token` を使って状態をポーリングし、`/api/v1/requests/{id}/result` から結果を取得する。結果は `name` 配列、`log` 配列、`ver` を含むTenhou JSONとして検証され、任意で `_target_actor`（0〜3）も扱う。将来のTenhou→MJAI変換への入力候補になるが、KyokuLoopの既存の解析済みレポート取り込みと同じ形式ではなく、汎用Tenhou入力・解析は未実装である。

### 実装から確認できる契約の詳細（公開クライアントと現行サービスの差分に注意）

公開クライアントの実装・テストには、次の具体的な契約がある（ただし、これはクライアントが期待する契約であり、サービス運営者が公開したAPI仕様書ではない）。

旧クライアントの匿名経路は次の契約を期待する。

```text
POST https://ninklang.tech/api/v1/desktop/requests
Content-Type: application/json
{
  "share_url": "<雀魂共有URL>"
}
```

しかし、2026-11-02にサービスの公開ページと、そのページが参照する公開JavaScriptをGETで確認したところ、現行の公開フォームは次の別経路を使用している。

```text
GET  /api/v1/public/captcha
POST /api/v1/public/requests
Content-Type: application/json
{
  "share_url": "<雀魂共有URL>",
  "captcha_id": "<取得したcaptcha_id>",
  "captcha_answer": "<画像の5文字>"
}
```

現行フォームは`captcha_id`と5文字の画像認証回答を必須にし、作成後は`request_id`/`request_token`を同一オリジンのセッションストレージへ保存して状態確認に使う。したがって、KyokuLoopがブラウザ自動操作やCAPTCHA自動解読を行う経路ではなく、**ユーザーが公開ページで画像認証を入力する手動確認付き経路**としてのみ扱える。画像認証の回避・自動解読は実装しない。

匿名作成応答で期待される値は `request_id`、`request_token`（`rq_`で始まり20〜256文字）、`status`、任意の `poll_after_ms`。状態確認は以下の形式で行う。

```text
GET https://ninklang.tech/api/v1/requests/{request_id}
Authorization: Request <request_token>
```

`status` はクライアント上、`queued` / `fetching` / `retry_wait` / `converting` / `ready` / `failed` / `expired` を想定する。`ready` 後に次を取得する。

```text
GET https://ninklang.tech/api/v1/requests/{request_id}/result
Authorization: Request <request_token>
```

結果は `ver`、`name`（配列）、`log`（配列）が必須で、任意の `_target_actor` は0〜3の座席番号である。`failed` の `error` は `code` と `message` を持つ構造を想定し、テストには `ACCOUNT_REAUTH_REQUIRED`（対応プラットフォームの再認証要求）が記録されている。これは匿名利用でも、サービス側の取得用アカウント／セッションが失効し得ることを示すが、アカウントの所有者・運用主体までは証明しない。

README／クライアントにはAPI Keyを設定した管理者向け経路も残っており、匿名経路ではなく次を使う。

```text
POST https://ninklang.tech/api/v1/client/requests
Authorization: Bearer <pk_...>
Content-Type: application/json
{
  "share_url": "<雀魂共有URL>"
}
```

作成時に `Idempotency-Key` を付与し、以降は同じ `request_id` を `Bearer` でポーリングする。クライアントは HTTP 408/425/429 と5xxを一時エラーとして扱い、`Retry-After`（最大30秒）と待機を利用する。全体待機の既定値は900秒、結果JSONの上限は64 MiBである。

### 「専用アカウント」か、mjai/Cloudflareのプロキシか

READMEには `ninklang.tech` が「后台专用账号」を使う旨の説明がある。また、クライアントの失敗テストには `ACCOUNT_REAUTH_REQUIRED` があるため、バックエンドに取得用の認証状態があることは示唆される。しかし、公開ソースにはそのアカウント、取得処理、雀魂側のAPI呼び出し、保持処理の実装は含まれていない。

一方、公開クライアントのリモート取得コードは送信先を設定値（既定 `https://ninklang.tech`）に限定し、`mjai.ekyu.moe`、Cloudflare回避用のエンドポイント、プロキシ設定を参照していない。したがって、**このクライアントコードだけからmjai/Cloudflareへの転送を示す証拠はない**。ただし、ninklangサーバー側が何をしているかは同コードでは判定できず、「専用アカウントで自前取得」と「他サービス経由」のどちらかを確定しない。

現行公開ページ（一次ソース）は「后台専用账号が読み取り」「個人アカウント不要」と明記し、国服四麻の状態を`/api/v1/public/service-info`で公開している。2026-11-02のGETでは国服が`operational`、日服・国際服が`unavailable`だった。これは通常の公開サービスとしての動作説明を補強するが、雀魂提供元からの個別許諾を意味しない。

### 確認できない／採用を止める理由

- 公開ページ・プライバシー・利用規約は保存期間と禁止事項を示すが、サービス運営者の法人名／連絡先、数値化されたレート制限、SLAは確認できない。
- API Key付きの `/api/v1/client/requests` も実装されているが、個人利用者が取得できる公開プランや契約は確認していない。内蔵共有キーを配布する方式は推奨されていない。
- 付属の `mj_model/mortal.pth` はリポジトリに存在するとの説明だけで、学習元・Mortal公式モデルとの同一性・ライセンスを独立確認できない。README自身もモデル差し替え時はライセンス確認を求めている。
- 利用規約は「自分が閲覧・分析する権利を持つ牌譜」「個人復盤・学習または許可されたツール」を許可し、批量抓取・レート制限回避・他人への嫌がらせを禁止する。個人利用の範囲には整合するが、雀魂提供元からの個別許諾があるとは扱わない。
- READMEに対して現行公開ページのエンドポイントと画像認証が変わっているため、旧クライアントをそのままKyokuLoopへ移植できない。
- APIの正式なOpenAPI、全エラーコード一覧、匿名URLの個別削除機能は確認できない。

### 互換性・実装評価

| 項目 | 判定 |
|---|---|
| 雀魂ブラウザログイン | 不要。公開ページは后台専用账号方式と説明 |
| 外部拡張 | 不要 |
| 人間操作 | 現行公開フォームは画像验证码（5文字）を要求。KyokuLoopによる自動解読・回避は不可 |
| Mortal | ローカル実行。リモートMortal解析結果を返すサービスではない |
| 結果形式 | Tenhou JSON（`name`/`log`/`ver`）を取得。分析結果は別途ローカル生成 |
| API契約 | クライアントコードに具体的な作成・状態・結果エンドポイントあり。サービス公式仕様書・SLAは未確認 |
| 費用 | 公開ページは公開サービスと表示。料金請求・課金導線は確認できず、可用性保証はない |
| 個人情報／牌譜 | 共有URL、タスク状態を処理。変換結果は最大7日、要求記録・tokenは最大24時間。非限流失敗の診断・取得済みデータは暗号化して最大30日（最大200件・64MiB）保持し得る |
| KyokuLoop採用 | 手動CAPTCHA付きの確認経路として技術検証候補。自動URL送信は、ユーザーが受信先・保持方針を確認して明示同意した後 |

一次ソース:

- [ninkjin/Majsoul-Mortal-Analyzer README](https://github.com/ninkjin/Majsoul-Mortal-Analyzer)
- [同リポジトリの匿名サービス設定例](https://raw.githubusercontent.com/ninkjin/Majsoul-Mortal-Analyzer/main/paipu-service.example.json)
- [同リポジトリの remote_service_fetcher.py](https://raw.githubusercontent.com/ninkjin/Majsoul-Mortal-Analyzer/main/tools/paipu_server/remote_service_fetcher.py)
- [同リポジトリの remote_service_fetcher テスト](https://raw.githubusercontent.com/ninkjin/Majsoul-Mortal-Analyzer/main/tools/paipu_server/test_remote_service_fetcher.py)
- [牌谱工房 公開ページ](https://ninklang.tech/)
- [牌谱工房 サービス状態JSON](https://ninklang.tech/api/v1/public/service-info)
- [牌谱工房 隠私说明](https://ninklang.tech/privacy)
- [牌谱工房 使用条款](https://ninklang.tech/terms)
- [牌谱工房 公開フォームJavaScript](https://ninklang.tech/static/app.js?v=20260906-shared-messages)

## 候補B: Mahjong Paipu Assistant（近似候補、採用不可）

[AwakeFantasy/mahjong-paipu-assistant](https://github.com/AwakeFantasy/mahjong-paipu-assistant) は雀魂URLの貼付とローカル回放UIを持ち、Mortal等のローカルエンジンをHTTP sidecarで接続できる。しかしREADMEは「完全なオンラインサービスではない」と明記し、雀魂の取得には `.env.local` の自分のアカウントまたはセッション情報が必要としている。またMortalモデル重み・ローカルエンジンは同梱しない。従って、今回の「雀魂ログインなし・URLだけ・Mortalまで」の候補にはならない。

## 候補C: Majsoul-Plugin（近似候補、採用不可）

[Xcheng-dada/Majsoul-Plugin](https://github.com/Xcheng-dada/Majsoul-Plugin) は `#牌譜Review <URL>` からMortalレビューを起動できると説明するが、同READMEは牌譜分析に本地APIの雀魂ログインが必須であること、さらにReplay House Bearer tokenが必要な構成を説明している。Bot/プラグインであり、KyokuLoopの「ログイン不要・拡張不要・公開API」要件を満たさない。

## 比較対象だが代替ではないもの

- `mjai-reviewer` / Mahjong AI Utilities は、Mortalを使う既知のWeb経路であり、今回探している「別の方法」ではない。既存経路のアクセス制限を迂回する目的で再試行しない。
- 雀魂公式のMAKAは独自の解析システムでありMortalではない。Mortal結果の互換取り込み候補として扱わない。
- NAGAは別エンジンであり、今回のMortal代替サービスの要件には含めない。

## KyokuLoopで可能な安全な次の検証

1. **実データを送らず**、候補Aの公開クライアントコードから、旧匿名契約と現行公開フォーム契約の差分、およびTenhou JSON取り込み変換だけをfixtureで再現する。
2. 実URLを扱う場合は、KyokuLoopから自動POSTせず、公開ページを開いてユーザー本人が画像验证码を入力する手動経路に限定する。CAPTCHA自動解読・回避はしない。
3. 送信前に「第三者サービスへ共有するURL」「結果最大7日、要求記録/token最大24時間、非限流失敗時は取得済みデータが最大30日暗号化保留され得る」ことを表示し、明示確認を取る。
4. サービス状態が`unavailable`の区服へ再送しない。2026-11-02時点で確認できた公開状態は国服のみ`operational`、日服・国際服は`unavailable`だった。
5. 実牌譜URL・結果・認証情報はGitへ保存せず、結果はユーザーのprivate領域へ保存する。

## 最終判定

候補Aは、要件に最も近い公開実装であり、**「后台専用アカウントによる牌譜取得 + ローカルMortal」の技術検証候補**である。公開ページで利用条件・保存期間・禁止事項が確認できたため、問題は「個人利用だから一律停止」ではなく、現行API差分とCAPTCHAを含むUX設計、モデル出所、可用性保証の評価に絞られる。

ただし、KyokuLoopからの自動依頼経路としてはまだ組み込まない。現行公開フォームは画像验证码を要求し、さらに日本サーバーは現在利用できない。中国サーバーで使う場合の候補は「URLを正規化して保存 → 公開ページをユーザー操作で開く → ユーザーが送信 → 取得したTenhou JSONをKyokuLoopへ取り込む」という手動同意付きの補助経路である。日本サーバー用の現行導線として提案しない。

## 日本サーバー（`game.mahjongsoul.com`）に絞った追加調査

調査範囲: 2026-11-02、公開一次ソース（公式サービスの公開ページ/API状態、公開GitHubリポジトリのREADME・コード）だけを確認。実URLの送信、CAPTCHA入力、mjai/Cloudflare経路の再試行は行っていない。

### 確認結果

1. `ninklang.tech` の現行公開状態APIは、国服（`game.maj-soul.com`）を`operational`、日服（`game.mahjongsoul.com`）と国際服を`unavailable`として返した。公開ページも「現在可提交：国服」とし、日服・国際服は不可と表示する。したがって、ninklangを日本サーバー牌譜の現在の取得先として採用できない。
2. [Equim-chan/tensoul](https://github.com/Equim-chan/tensoul) はMortal作者による雀魂ログ→Tenhou 6変換ツールであり、雀魂運営公式のツールではない。READMEの利用条件は「任意サーバーにログインして `GameMgr.Inst.access_token` を取得し、`ACCESS_TOKEN` と `ENDPOINT` を設定する」である。ログイン不要の共有URL取得サービスではない。
3. [MahjongRepository/mahjong_soul_api](https://github.com/MahjongRepository/mahjong_soul_api) のREADMEは、中国サーバーではユーザー名・パスワードでログインし、日服・国際服ではメールコードまたはソーシャルログインによる認証実装が必要と明記する。これもゲストURL取得ではない。
4. [NikkeTryHard/tenhou-to-mjai の雀魂取得ドキュメント](https://github.com/NikkeTryHard/tenhou-to-mjai/blob/main/docs/majsoul-scraper.md) は、雀魂のUUID解決・公開牌譜取得に認証が必要と明記しており、公開日服共有URLを無認証で取得するサービスではない。
5. 検索で見つかる「日服対応」AI補助ツールは、ゲームクライアント内の補助、拡張、ブラウザ注入、または既知のmjai経路であり、KyokuLoopの「ログイン・拡張不要の別公開サービス」には該当しない。

### 結論（日本サーバー）

現時点で、**日本サーバーの雀魂共有URLを、本人ログイン・拡張機能なしで受け取り、Mortal用データへ変換する別の公開一次実装は見つからなかった**。確認できた公開実装は、ninklang（現在JP不可）、tensoul（アクセストークン必須）、Mahjong Soul API系（JP認証必須）に整理できる。

従って、JP牌譜については次のいずれかが新たに確認されるまで、URLだけの自動経路を成立済みと扱わない。

- ninklangがJPを`operational`に戻し、現行公開フォームの手動CAPTCHA経路を個人同意付きで利用する。
- JP共有URLを受け付ける別サービスが、運営者・利用条件・保存方針・認証要件を一次資料で明示する。
- ユーザーが自分のJPセッション／アクセストークンを明示的に提供し、ローカル取得する（ただし現在の「ログイン不要」方針から外れるため、KyokuLoopでは自動採用しない）。
