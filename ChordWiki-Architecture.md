# ChordWiki 個人バックアップ（限定公開）設計書

---

## 目的

このリポジトリは、**自作曲・自作コード譜**を  
**自前の Azure 環境に Web サイトとして構築・運用する**ためのプロジェクトです。

- 閲覧：ログイン必須（誰でも）
- 編集・新規登録：オーナーのみ

---

## 1. 要件整理

### 1.1 機能要件

#### 閲覧機能

- Microsoft アカウント認証後にトップページへアクセスできること
- トップページでは **ランキング表示** を標準とし、以下の順で表示すること
  - `score` 降順
  - `last_viewed_at` 降順
- 一覧は **最大 300 件 / 100 件ごとに 3 ページ** まで表示すること
- 検索は **タイトル・アーティストのみ** を対象とし、トップページから以下を提供すること
  - 1ワード部分一致検索
  - `"..."` での完全一致検索
  - URL クエリ `?q=` / `?page=` と連動した状態復元
- 曲詳細ページでは ChordPro をクライアントサイドで描画し、以下を扱うこと
  - `{title:}` / `{subtitle:}` / `{key:}`
  - `{comment:}` / `{comment_italic:}`
  - `[C] [Am] [G/B]` 形式のコード
- 曲詳細ページでは以下の補助 UI を提供すること
  - 移調（-6 ～ +6）
  - 表記モード切替（♯ / 指定なし / ♭）
  - オートスクロール（Start / End マーカー、時間指定、プリセット、Start/Stop/Reset）
- 曲詳細ページ表示時に、閲覧スコアを非同期で更新すること
- 曲詳細ページでは Tags / YouTube の補助パネルを提供し、必要に応じて折りたたみ可能であること
- YouTube は曲ごとに複数登録でき、右下ミニプレイヤーで同一タブ再生できること

#### 編集機能

- `editor` ロールのみが新規登録・更新・削除できること
- 編集画面では以下を管理できること
  - `id`（edit 時は固定）
  - `title`
  - `slug`
  - `artist`
  - `tags`（1 行 1 タグ）
  - `youtube`（1 行 1 動画、URL / `id?t=42` / `start=42` を許容）
  - `chordPro`
- 曲ページ上からも Tags / YouTube の簡易メンテナンスをモーダルで行えること（保存先は既存の編集 API）

#### 推定・補助機能

- オートスクロール時間の初期値は 4 分（240 秒）とする
- 表示中の時間が **3:55 ～ 4:05** のときのみ、YouTube 検索結果から参考時間の自動推定を 1 回だけ行うこと
- 推定はヒューリスティックであり、失敗しても UI を壊さず 4 分のまま使えること

#### 非対応

- 歌詞本文に対する全文検索
- 一般ユーザー向けの管理画面
- DB に動画タイトルを保存する運用

### 1.2 非機能要件

- 限定公開（Microsoft Entra ID / Static Web Apps 認証）
- 権限制御（閲覧と編集の分離）
- Free/低コスト枠を中心とした運用
- クライアント・API のいずれかが失敗しても閲覧体験を大きく壊さないこと
- 長期放置しても保守しやすい、単純な HTML / CSS / JavaScript + Azure Functions 構成であること

---

## 2. 全体アーキテクチャ

[ Browser ]  
↓（Microsoft 認証 / `.auth`）  
[ Azure Static Web Apps ]  

- Frontend（HTML / CSS / JavaScript）
- ロール制御（`authenticated` / `editor`）
- API ルーティング

↓ `/api/*`  

[ Azure Functions ]  

- 曲取得 API
- 一覧 / ランキング / 検索 API
- 編集 API
- 閲覧スコア更新 API
- オートスクロール参考時間推定 API

↓  

[ Azure Cosmos DB（NoSQL） ]  
- 曲ドキュメント保存
- `score` / `last_viewed_at` によるランキング情報保持

↘（外部参照・保存なし）  
[ YouTube Search / YouTube IFrame Player API ]

---

## 3. Azure サービス構成

### 3.1 Azure Static Web Apps（Free）

- フロントエンド配信
- Microsoft Entra ID 認証
- `/login` / `/logout` の簡易導線
- API ゲートウェイとして Azure Functions を内包
- ロール
  - `authenticated`：閲覧可
  - `editor`：編集可

### 3.2 Azure Functions

- Node.js ベースの HTTP Trigger のみを利用
- `@azure/cosmos` を使って Cosmos DB へ接続
- Function 自体は stateless に保つ
- 実効上の認可は Static Web Apps 側の route 制御に依存する
- 主な環境変数
  - `COSMOS_DB_ENDPOINT` / `COSMOS_ENDPOINT`
  - `COSMOS_DB_KEY` / `COSMOS_KEY`
  - `COSMOS_DB_NAME`（既定値: `ChordWiki`）
  - `COSMOS_DB_CONTAINER`（既定値: `Songs`）

### 3.3 Azure Cosmos DB（Core SQL / Free Tier 想定）

- Database：`ChordWiki`
- Container：`Songs`
- Partition Key：`/artist`
- 曲 1 件 = 1 ドキュメント
- ランキングに必要な `score` / `last_viewed_at` を同一ドキュメント内で管理する

---

## 4. 認証・認可設計

### 4.1 認証フロー

1. 未ログインで保護ページへアクセス
2. Static Web Apps が `/login` → `/.auth/login/aad` へ誘導
3. サインイン後、`authenticated` ロールで閲覧可能
4. オーナーアカウントには追加で `editor` ロールを付与し、編集 UI を表示

### 4.2 ロール付与

- オーナー：`editor`
- 一般閲覧者：`authenticated`

### 4.3 ルーティング制御（`frontend/staticwebapp.config.json`）

| ルート | 実効ロール | 用途 |
|---|---|---|
| `/` | `authenticated` | トップページ |
| `/song.html`, `/song/*` | `authenticated` | 曲詳細表示 |
| `/edit.html`, `/edit/*` | `editor` | 登録・編集画面 |
| `/api/edit/*` | `editor` | 更新・削除 API |
| `/login` | 公開 | `/.auth/login/aad` へリダイレクト |
| `/logout` | 公開 | `/.auth/logout` へリダイレクト |

### 4.4 フロントエンドの権限反映

- `frontend/js/auth.js` で `/.auth/me` を参照し、`editor-only` 要素の表示/非表示を切り替える
- これにより、同じ HTML を `authenticated` / `editor` で出し分ける

---

## 5. データモデル（Cosmos DB）

### 5.1 Songs ドキュメント構造

| フィールド | 型 | 必須 | 説明 |
|---|---|---:|---|
| `id` | string | ○ | UUID 等の一意 ID |
| `slug` | string | ○ | URL 表示用 ID |
| `title` | string | ○ | 曲名 |
| `artist` | string | ○ | アーティスト名（Partition Key） |
| `tags` | string[] | - | タグ一覧。1 行 1 タグ入力を配列化 |
| `youtube` | `{ id: string, start: number }[]` | - | YouTube 動画 ID と開始秒の配列 |
| `chordPro` | string | ○ | コード譜本文 |
| `createdAt` | string | - | 作成日時（ISO 8601） |
| `updatedAt` | string | - | 更新日時（ISO 8601） |
| `score` | number | - | 閲覧スコア（`0` ～ `100`） |
| `last_viewed_at` | string / null | - | 最終閲覧日時 |

### 5.2 補足

- `youtube` は **順序を保持する配列** とする
- `youtube[].id` は YouTube videoId（11 文字想定）
- `youtube[].start` は 0 以上の整数秒
- 画面表示に必要なタイトル・サブタイトル・キーは、`chordPro` 内の `{title:}` / `{subtitle:}` / `{key:}` からも取得可能

### 5.3 サンプル

```json
{
  "id": "test-uuid",
  "slug": "test-song",
  "title": "テスト曲",
  "artist": "テスト",
  "tags": ["test", "pop"],
  "youtube": [
    { "id": "kZZstk3dGvQ", "start": 42 }
  ],
  "chordPro": "{title:テスト曲}\n{key:C}\n[C]テストです",
  "createdAt": "2026-04-08T00:00:00.000Z",
  "updatedAt": "2026-04-08T00:00:00.000Z",
  "score": 3,
  "last_viewed_at": "2026-04-08T12:34:56.000Z"
}
```

---

## 6. API 設計

### 6.1 API 一覧

| Method | Route | 実効ロール | 用途 |
|---|---|---|---|
| GET | `/api/songs` | authenticated | 最小一覧（互換・簡易取得） |
| GET | `/api/songs/ranking?page=n` | authenticated | ランキング一覧 |
| GET | `/api/songs/search?q=...&page=n` | authenticated | タイトル / アーティスト検索 |
| GET | `/api/song/{artist}/{id}` | authenticated | 曲詳細取得（Point Read） |
| POST | `/api/songs/{id}/view` | authenticated | 閲覧スコア更新 |
| POST / PUT / DELETE | `/api/edit/song/{artist?}/{id?}` | editor | 作成 / 更新 / 削除 |
| GET | `/api/youtube/search-duration?title=...&artist=...` | authenticated | オートスクロール参考時間の推定 |

### 6.2 曲取得 API

- `GET /api/song/{artist}/{id}`
- Cosmos DB の `id + partitionKey(artist)` で Point Read
- 見つからない場合は `404`

### 6.3 一覧・ランキング API

#### `GET /api/songs`
- `id / artist / title / slug` の最小情報だけを返す簡易 API
- クロスパーティションクエリを使う

#### `GET /api/songs/ranking?page=n`
- `score DESC` → `last_viewed_at DESC` でサーバー側ソート
- 返却は 100 件 / ページ、最大 3 ページ（300 件）
- レスポンスには `totalSongs` / `pageSize` / `totalPages` を含む

### 6.4 検索 API

- `GET /api/songs/search?q=...&page=n`
- 検索対象は `title` と `artist` のみ
- `q="..."` の場合は完全一致
- それ以外は 1 ワード部分一致
- AND / OR 検索や全文検索は行わない
- 検索結果もランキングと同じ順序で返す

### 6.5 閲覧スコア更新 API

- `POST /api/songs/{id}/view`
- リクエスト body で `artist` を受け取る
- 曲ページ表示後に非同期呼び出しし、閲覧体験はブロックしない
- 更新内容
  - `score = min(score + 1, 100)`
  - `last_viewed_at = now()`

### 6.6 編集 API

- `POST /api/edit/song`
  - 新規作成
  - `createdAt` / `updatedAt` / `score=0` / `last_viewed_at=null` をサーバーで初期化
- `PUT /api/edit/song/{artist}/{id}`
  - 既存曲の更新
  - `id` は edit 時に変更不可
  - `artist` を変更した場合は新パーティションに upsert 後、旧パーティションから削除
- `DELETE /api/edit/song/{artist}/{id}`
  - 既存曲を削除

#### 入力正規化
- `tags`：配列または改行文字列を受け付け、空要素を除外
- `youtube`：`{ id, start }[]` に正規化し、不正データを除外
- `chordPro`：改行コードを正規化して保存

### 6.7 オートスクロール参考時間推定 API

- `GET /api/youtube/search-duration?title=...&artist=...`
- 用途は **参考値取得のみ**。DB には保存しない
- タイトル中の `（...）`, `(...)`, `【...】`, `[...]` は検索前に除去する
- YouTube 検索結果を上位数件だけ参照し、以下で簡易スコアリングする
  - 曲タイトル一致を優先
  - アーティスト名一致を強く優先
  - `live`, `cover`, `remix`, `instrumental` などは減点
- 最も妥当な 1 件の `duration` を返し、フロント側で参考時間へ補正する
- タイムアウトや解析失敗時は `found: false` で安全にフォールバックする

---

## 7. フロントエンド設計

### 7.1 ページ構成

| パス | 役割 |
|---|---|
| `/` | トップページ（ランキング / 検索） |
| `/song.html` | 曲詳細表示 |
| `/edit.html?mode=add` | 新規登録 |
| `/edit.html?mode=edit&artist=...&id=...` | 既存曲編集 |
| `/403.html` | 権限エラー |

### 7.2 トップページ（`frontend/index.html`）

- 初期表示はランキング API を使用
- 検索文字列がある場合のみ検索 API を使用
- ランキング番号、曲名、アーティスト、Score を一覧表示
- ページボタンは 1～3 を表示し、存在しないページは disabled にする
- `editor` ロール時のみ「新規追加」ボタンを表示

### 7.3 曲ページ（`frontend/song.html` / `frontend/js/song.js`）

#### 譜面表示
- `#sheet.cw-sheet` に ChordPro を描画
- コメント行・空行・歌詞行・コードを DOM 化して CSS で整形する

#### Song Controls（右上フロート）
- 移調ボタン（`- / + / Reset`）
- 表記モード（♯ / 指定なし / ♭）
- オートスクロール時間入力（分・秒）
- 時間プリセット（2:30 / 3:00 / 4:00 / 5:00）
- Start / Stop / Reset
- 折りたたみ状態を localStorage に保存

#### オートスクロール
- `Start` / `End` マーカーを譜面左側に表示
- マーカーはドラッグ可能
- `End` が画面の 2/3 ラインに到達したら自動停止
- 曲ごとに以下の状態を localStorage に保存
  - `startY`
  - `endY`
  - `durationSec`

#### Tags / YouTube 補助パネル
- `Song Controls` とは別の右フロートとして表示
- 折りたたみ可能
- `Tags` と `YouTube` を縦に並べる
- `editor` の場合、ヘッダークリックで簡易編集モーダルを開く
- `Tags` はクリックで `/?q=tag` へ遷移

#### YouTube 再生
- `youtube` 配列をリスト表示
- 初期ラベルは `▶ 再生` / `▶ 再生 (0:42)` のように簡潔に表示
- 右下ミニプレイヤーは YouTube IFrame Player API を使う
- 再生した動画タイトルはセッション内メモリにキャッシュし、以後のラベル表示に反映する
- `YouTubeで検索` ボタンは **title のみ** で別タブ検索する

### 7.4 編集ページ（`frontend/edit.html` / `frontend/js/edit.js`）

- add / edit をクエリで切り替える
- `slug` は初期状態では `title` 入力に追従する
- `youtube` は複数行 textarea で受け付け、保存時に `{id,start}` 配列へ正規化する
- 削除ボタンは edit モードのみ表示する

### 7.5 クライアントサイド保持データ

| キー | 用途 |
|---|---|
| `prefs:v1:{artist}:{id}` | 移調量・表記モード |
| `autoscroll:v1:{artist}:{id}` | マーカー位置・オートスクロール時間 |
| `autoscrollCollapsed` | Song Controls の折りたたみ状態 |
| `songExtrasCollapsed` | Tags / YouTube パネルの折りたたみ状態 |

### 7.6 ChordPro → HTML 変換（`frontend/js/chordwiki-render.js`）

#### 対象記法
- `{title:}` / `{t:}`
- `{subtitle:}` / `{st:}`
- `{key:}`
- `{comment:}` / `{c:}`
- `{comment_italic:}` / `{ci:}`
- `[C] [Am] [G/B]` 形式のコードトークン

#### 方針
- クライアントサイドのみで描画する
- 未対応記法は無視し、表示全体を壊さない
- ChordWiki 互換を意識し、`p.line`, `p.comment`, `span.chord`, `span.word`, `span.wordtop` を中心に整形する

---

## 8. デプロイ / 運用

- GitHub リポジトリをソースオブトゥルースとする
- push をトリガーに Azure Static Web Apps の CI/CD でデプロイする
- 構成がシンプルなため、フロントエンドと API の差分を追いやすい

### 運用上の注意
- Cosmos DB の Primary Key（アクセスキー）を変更した場合は、SWA / Functions のアプリ設定も更新すること
- `COSMOS_DB_*` と `COSMOS_*` の両系統を参照するコードがあるため、値は揃えておくのが安全

---

## 9. コスト想定

- Azure Static Web Apps：Free 想定
- Azure Functions：従量課金 / 軽負荷想定
- Azure Cosmos DB：Free Tier 想定
- YouTube 連携は API キーを常用せず、IFrame API と検索結果参照を補助的に利用

---

## 10. 将来拡張候補

- タグ AND 検索、複数条件検索
- 曲一覧の絞り込み強化（タグ / 更新日 / お気に入り）
- ChordPro 対応記法の拡張
- インポート / エクスポート（Markdown / JSON）
- 曲情報のメタデータ拡張（メモ、難易度、キー候補など）

---

## 付録

- 設計：本ドキュメント
- 実装：VS Code + GitHub Copilot
- 管理：個人
