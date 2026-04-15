# 個人用 ChordWiki 設計書

---

## 目的

このリポジトリは建前としては、**自作曲・自作コード譜**を  
**自前の Azure 環境に Web サイトとして構築・運用する**ためのプロジェクトです。

- 閲覧：ログイン必須（誰でも）
- 編集・新規登録：オーナーのみ

---

## 1. 要件整理

### 1.1 機能要件

#### 閲覧機能

- Microsoft アカウント認証後にトップページへアクセスできること
- トップページでは **ランキング表示** を標準とし、以下の順で表示すること
  - `display_score` 降順
  - `last_viewed_at` 降順
- `display_score` は保存済み `score` に対して **7 日ごとの減衰**を適用した派生値とし、古い閲覧履歴が自然に下がること
- 一覧は **画面の縦解像度に応じて 20～60 件 / ページで自動調整**し、最大 6 ページ分まで扱えること
- ページネーションは実在するページ数だけを表示し、トップページでは固定フッターで操作できること
- 検索はトップページから以下を提供すること
  - `target=song`：タイトル / アーティスト検索
  - `target=tag`：タグ検索
  - 1ワード部分一致検索
  - `"..."` での完全一致検索（`target=song` 時）
  - タグ入力時の候補サジェスト
  - URL クエリ `?q=` / `?target=` / `?page=` と連動した状態復元
  - ホーム状態は `/?page=1` ではなく **`/`** に正規化されること
- トップページには、検索結果からランキング初期表示へ戻るための導線（タイトルリンク / クリア操作）があること
- 曲詳細ページでは ChordPro をクライアントサイドで描画し、以下を扱うこと
  - `{title:}` / `{subtitle:}` / `{key:}`
  - `{comment:}` / `{comment_italic:}`
  - `[C] [Am] [G/B]` 形式のコード
- 曲詳細ページでは以下の補助 UI を提供すること
  - 移調（-6 ～ +6）
  - 表記モード切替（♯ / 指定なし / ♭）
  - 表示カスタマイズ（コードサイズ / 記号縦位置 / コード行縦位置 / 行間 / フォント系設定）
  - オートスクロール（Start / End マーカー、時間指定、プリセット、Start/Stop/Marker Reset、可変スクロール切替、速度最大 `3.0x`）
  - 個人用メモ / 手書き（localStorage 保存、複数メモ / 複数ストローク対応）
- 曲詳細ページ表示時に、閲覧スコアを非同期で更新すること
- 曲詳細ページでは `Song Controls` と `Tags / YouTube` の補助パネルを提供し、必要に応じて折りたたみ可能であること
- `Song Controls` 内の各ブロック（移調/表記、メモ / 手書き、オートスクロール、表示カスタマイズ）は個別に縦折りたたみでき、余白変化に応じて `Tags / YouTube` パネルの表示高さも再計算されること
- `移調 / 表記` ブロックは一体で折りたたみ可能とし、折りたたみ時のラベルは `移調/表記` とすること
- `メモ / 手書き` ブロックも一体で折りたたみ可能とすること
- メモ / 手書きは歌詞行やコードにアンカーせず、絶対座標のみを保持し、レイアウト変化時に自動補正しないこと
- メモのピン留め状態は「譜面に固定してスクロールに追従する」意味とし、ピンを外した状態では画面固定で表示すること
- 手書きツールは曲表示時は既定でシュリンク状態・OFF とし、右上フロート UI から ON/OFF、ピン切替、太さ変更、色変更、任意削除、Undo を提供すること
- YouTube は曲ごとに複数登録でき、右下ミニプレイヤーで同一タブ再生できること
- 狭い画面では、譜面の長い行は **横スクロール fallback** を用いてコードと歌詞の重なりを避けること

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
- 推定 API へ渡す検索語は、**Cosmos DB の `title` / `artist` フィールド**を正として用い、`title` は括弧書きを除去してから使用すること
- `YouTubeで検索` ボタンも、同じく **Cosmos DB の `title` + `artist`** を別タブの YouTube 検索へ渡すこと
- 推定はヒューリスティックであり、失敗しても UI を壊さず 4 分のまま使えること
- ローカルプレビュー時は、API が未起動でも `.local` 配下のサンプルデータでトップ / 検索 / 曲表示を検証できること

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

  - `COSMOS_ENDPOINT`
  - `COSMOS_KEY`
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
| --- | --- | --- |
| `/` | `authenticated` | トップページ |
| `/song.html`, `/song/*` | `authenticated` | 曲詳細表示 |
| `/add.html` | 公開（302 リダイレクト） | `/edit.html?mode=add` へ誘導 |
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
| --- | --- | ---: | --- |
| `id` | string | ○ | 一意 ID |
| `slug` | string | ○ | URL 用 ID |
| `title` | string | ○ | 曲名 |
| `artist` | string | ○ | アーティスト名 / Partition Key |
| `tags` | string[] | - | タグ一覧 |
| `youtube` | object[] | - | YouTube ID と開始秒 |
| `chordPro` | string | ○ | コード譜本文 |
| `createdAt` | string | - | 作成日時（ISO 8601） |
| `updatedAt` | string | - | 更新日時（ISO 8601） |
| `score` | number | - | 保存スコア（`0` ～ `100`） |
| `display_score` | number | - | 表示用の派生スコア |
| `last_viewed_at` | string/null | - | 最終閲覧日時 |

### 5.2 補足

- `youtube` は **順序を保持する配列** とする
- `youtube[].id` は videoId（11 文字想定）
- `youtube[].start` は 0 以上の整数秒
- タイトル・サブタイトル・キーは、`chordPro` 内の
  `{title:}` / `{subtitle:}` / `{key:}` からも取得できる
- 外部検索や参考時間推定に使う正データは
  Cosmos DB の `title` / `artist` とする
- 個人用のメモ / 手書きはサーバー保存せず、以下の localStorage キーを用いる
  - Sticky notes: `annotations:v1:{artist}:{id}`
  - 手書き: `annotations-ink:v1:{artist}:{id}`
  - 手書き色設定: `inkColorPreference`
  - 手書き太さ設定: `inkWidthPreference`

### 5.3 サンプル

```json
{
  "id": "test-uuid",
  "slug": "test-song",
  "title": "テスト曲",
  "artist": "テスト",
  "tags": ["test", "pop"],
  "youtube": [
    { "id": "XXXXXXXXXXX", "start": 42 }
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
| --- | --- | --- | --- |
| GET | `/api/songs` | authenticated | 最小一覧 |
| GET | `/api/songs/ranking` | authenticated | ランキング |
| GET | `/api/songs/search` | authenticated | 曲検索 / タグ検索 |
| GET | `/api/song` | authenticated | 曲詳細取得 |
| POST | `/api/songs/{id}/view` | authenticated | 閲覧スコア更新 |
| POST / PUT / DELETE | `/api/edit/song` | editor | 作成 / 更新 / 削除 |
| GET | `/api/youtube/search-duration` | authenticated | 参考時間推定 |

### 6.2 曲取得 API

- `GET /api/song?artist=...&id=...`
- Cosmos DB の `id + partitionKey(artist)` で Point Read
- 見つからない場合は `404`
- フロント側は `buildApiUrl()` を介し、
  本番とローカルで同じ呼び出し形を使う

### 6.3 一覧・ランキング API

#### `GET /api/songs`

- `id / artist / title / slug` の最小情報だけを返す
- クロスパーティションクエリを使う

#### `GET /api/songs/ranking`

- `display_score DESC` → `last_viewed_at DESC` でソート
- `display_score = max(score - floor(elapsedDays / 7), 0)`
  の減衰ロジックを適用する
- `pageSize` は **20～60 件**、既定値は `30`
- 返却対象は **最大 6 ページ分**に制限する
- レスポンスには `songs`, `page`, `pageSize`,
  `totalSongs`, `totalPages`, `totalLimit` を含む

### 6.4 検索 API

- `GET /api/songs/search?q=...&target=song|tag&page=n&pageSize=m`
- `target=song`（既定）では `title` と `artist` を検索する
- `target=tag` では `tags` 配列を検索する
- `q="..."` の場合は完全一致（`target=song` 時）
- それ以外は 1 ワード部分一致
- AND / OR 検索や全文検索は行わない
- 結果は `display_score` ベースの順序で返す
- `suggest=1&target=tag` ではタグ候補だけを返す

### 6.5 閲覧スコア更新 API

- `POST /api/songs/{id}/view`
- リクエスト body で `artist` を受け取る
- 曲ページ表示後に非同期呼び出しし、閲覧体験はブロックしない
- 更新内容

  - `score = min(score + 1, 100)`
  - `last_viewed_at = now()`

- ランキング表示では、保存済み `score` ではなく
  減衰済み `display_score` を利用する

### 6.6 編集 API

- `POST /api/edit/song`

  - 新規作成
  - `createdAt` / `updatedAt` / `score=0` /
    `last_viewed_at=null` をサーバーで初期化

- `PUT /api/edit/song?artist=...&id=...`

  - 既存曲の更新
  - `id` は edit 時に変更不可
  - `artist` を変更した場合は、新パーティションに upsert 後、
    旧パーティションから削除

- `DELETE /api/edit/song?artist=...&id=...`

  - 既存曲を削除

#### 入力正規化

- `tags`：配列または改行文字列を受け付け、空要素を除外
- `youtube`：`{ id, start }[]` に正規化し、不正データを除外
- `chordPro`：改行コードを正規化して保存

### 6.7 オートスクロール参考時間推定 API

- `GET /api/youtube/search-duration?title=...&artist=...`
- 用途は **参考値取得のみ**。DB には保存しない
- タイトルは Cosmos DB の `title` を正とし、
  `（...）`, `(...)`, `【...】`, `[...]` は検索前に除去する
- アーティスト名は Cosmos DB の `artist` をそのまま使用し、
  ChordPro の `subtitle` には依存しない
- YouTube 検索結果を上位数件だけ参照し、
  以下で簡易スコアリングする

  - 曲タイトル一致を優先
  - アーティスト名一致を強く優先
  - `live`, `cover`, `remix`, `instrumental` などは減点

- 最も妥当な 1 件の `duration` を返し、
  フロント側で参考時間へ補正する
- タイムアウトや解析失敗時は `found: false` で
  安全にフォールバックする

---

## 7. フロントエンド設計

### 7.1 ページ構成

| パス | 役割 |
| --- | --- |
| `/` | トップページ（ランキング / 検索） |
| `/song.html` | 曲詳細表示 |
| `/edit.html?mode=add` | 新規登録 |
| `/edit.html?mode=edit&artist=...&id=...` | 既存曲編集 |
| `/403.html` | 権限エラー |

### 7.2 トップページ（`frontend/index.html`）

- 初期表示はランキング API を使い、`display_score` をベースに順位を出す
- 検索文字列がある場合のみ検索 API を使う
- 検索対象は `曲名 / アーティスト` と `タグ` を切り替えられる
- 検索状態は `?q=` / `?target=` / `?page=` と同期する
- ホーム状態は `/?page=1` ではなく `/` で表現する
- ヘッダーは固定表示、ページネーションは固定フッター表示とし、
  縦解像度に応じて `pageSize` を自動調整する
- ページボタンは **実在するページ数だけ** を表示する
- `ChordWiki Personal` タイトルと `✕ クリア` から
  ランキング初期表示へ戻れる
- `editor` ロール時のみ「新規追加」ボタンを表示する
- ローカルプレビュー時は `runtime-config.js` により
  `http://localhost:7071` を自動参照し、API が使えない場合は
  `.local/local-test-songs.js` へフォールバックする

### 7.3 曲ページ（`frontend/song.html` / `frontend/js/song.js`）

#### 譜面表示

- `#sheet.cw-sheet` に ChordPro を描画する
- コメント行・空行・歌詞行・コードを DOM 化して整形する
- 狭い画面では、長い行は **横スクロール fallback** で
  コードと歌詞の重なりを避ける

#### Song Controls / サイド UI

- `song-header` は `← Top` → 曲名 → 管理ボタンの順で並ぶ
- `Song Controls` と `Tags / YouTube` は同じサイドカラムに収め、
  常に `Song Controls` が上、`Tags / YouTube` が下になる
- 広い画面では **右端固定のフロート UI** とし、ミニプレイヤーと同じ右端基準で揃える
- 狭い画面では本文下へ折り返し、縦積みに戻す
- `Song Controls` では以下を扱う

  - `移調 / 表記` ブロック（`- / + / Reset`、♯ / 指定なし / ♭）
  - `メモ` ブロック（`📝 Memo`）
  - 右上の手書きフロート UI（既定で縮小表示、`draw`、ピン切替、太さ変更、色変更、任意削除、Undo）
  - オートスクロール時間入力（分・秒）
  - 時間プリセット（2:30 / 3:00 / 3:30 / 4:00 / 4:30 / 5:00）
  - 可変スクロール切替（OFF 時は等速モード）
  - 表示カスタマイズ
  - Start / Stop / Marker Reset

- 各ブロックの折りたたみ状態を localStorage に保存する

#### オートスクロール

- `Start` / `End` マーカーを譜面左側に表示する
- マーカーはドラッグ可能
- 可変スクロール（行ごとの重み付き進行）と等速モードを切り替えられる
- `End` マーカーの上端がビューポート下端から 100px 内側に入った時点で自動停止する
- `End` 到達後は、次の左クリックだけ `Start` 位置へ戻す one-shot 挙動とし、そのクリックで到達フラグをクリアする
- その後の再スタートは、現在スクロール位置から再開する（`Start` マーカーを再調整した場合を除く）
- メモ / 手書き の操作中や注釈 UI のクリックでは、オートスクロール開始/停止を発火させない
- 速度倍率は `0.50x` ～ `3.00x` の範囲で調整できる
- 狭い画面では **2 段階 compact mode** を使う

  - `compact`：ラベル非表示、ピンを小型化、左余白を縮小
  - `compact-tight`：極小幅ではさらに一段圧縮

- 幅が広い場合は `Start / End` ラベル付き表示に戻る
- 曲ごとに以下を localStorage に保存する

  - `startY`
  - `endY`
  - `durationSec`

#### Tags / YouTube 補助パネル

- 折りたたみ可能
- `Tags` と `YouTube` を縦に並べる
- `editor` の場合、ヘッダークリックで簡易編集モーダルを開く
- `Tags` はクリックで `/?q=...&target=tag` へ遷移する
- `Song Controls` 側の折りたたみ状態に応じて利用可能な縦余白を再計算し、不要なスクロールバーを避ける

#### YouTube 再生 / 検索

- `youtube` 配列をリスト表示する
- 初期ラベルは `▶ 再生` / `▶ 再生 (0:42)` のように簡潔に表示する
- 右下ミニプレイヤーは YouTube IFrame Player API を使う
- 再生した動画タイトルはセッション内メモリにキャッシュし、
  以後のラベル表示に反映する
- `YouTubeで検索` ボタンは Cosmos DB の `title` + `artist` を使って
  別タブ検索する
- オートスクロール参考時間推定も、同じく
  Cosmos DB の `title` / `artist` を使う
- ローカルプレビュー時は `.local/local-test-song.js` の
  サンプル曲ライブラリから一致する曲を読み込める

### 7.4 編集ページ（`frontend/edit.html` / `frontend/js/edit.js`）

- add / edit をクエリで切り替える
- `slug` は初期状態では `title` 入力に追従する
- `youtube` は複数行 textarea で受け付け、
  保存時に `{id,start}` 配列へ正規化する
- API 呼び出しは `runtime-config.js` の `buildApiUrl()` を通して
  本番 / ローカルを切り替える
- 削除ボタンは edit モードのみ表示する

### 7.5 クライアントサイド保持データ

| キー | 用途 |
| --- | --- |
| `prefs:v1:{artist}:{id}` | 移調量・表記モード |
| `autoscroll:v1:{artist}:{id}` | マーカー位置・オートスクロール時間・速度倍率 |
| `annotations:v1:{artist}:{id}` | 個人用付箋メモ |
| `annotations-ink:v1:{artist}:{id}` | 個人用手書き |
| `inkColorPreference` | 手書き色の既定値 |
| `inkWidthPreference` | 手書き太さの既定値 |
| `autoscrollCollapsed` | Song Controls 全体の折りたたみ状態 |
| `transposeNotationCollapsed` | `移調 / 表記` ブロックの折りたたみ状態 |
| `annotationSectionCollapsed` | `メモ / 手書き` ブロックの折りたたみ状態 |
| `autoscrollSectionCollapsed` | `オートスクロール` ブロックの折りたたみ状態 |
| `displayPrefsCollapsed` | `表示カスタマイズ` ブロックの折りたたみ状態 |
| `songExtrasCollapsed` | `Tags / YouTube` パネルの折りたたみ状態 |
| `songExtrasCollapsed` | Tags / YouTube パネルの折りたたみ状態 |
| `displayPrefs:v1` | 表示カスタマイズ設定 |
| `displayPrefsCollapsed` | 表示カスタマイズパネルの折りたたみ状態 |
| `chordwiki:apiOrigin` | ローカル検証時の API 接続先 override |

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
- ChordWiki 互換を意識し、`p.line`, `p.comment`, `span.chord`,
  `span.word`, `span.wordtop` を中心に整形する

---

## 8. デプロイ / 運用

- GitHub リポジトリをソースオブトゥルースとする
- push をトリガーに Azure Static Web Apps の CI/CD でデプロイする
- 構成がシンプルなため、フロントエンドと API の差分を追いやすい

### 8.1 ローカル確認

- フロントエンドだけを確認する場合は、`frontend/` で
  `py -m http.server 8080` を使う
- API まで含めて確認する場合は、`api/` で `npm install` 後に
  `npm run start:storage` と `func start` を使う
- `runtime-config.js` により、`file://`, `localhost`, `127.0.0.1`
  では API 接続先を既定で `http://localhost:7071` に切り替える
- API が未起動でも、トップ / 検索 / 曲ページの主要 UI は
  `.local/local-test-songs.js` と `.local/local-test-song.js` の
  サンプルデータで検証できる
- 必要に応じて `window.__CHORDWIKI_API_ORIGIN__` または
  `localStorage['chordwiki:apiOrigin']` で接続先を上書きできる

### 8.2 運用上の注意

- Cosmos DB の Primary Key を変更した場合は、
  SWA / Functions のアプリ設定も更新すること
- 環境変数名は `COSMOS_ENDPOINT` / `COSMOS_KEY` に統一する

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
