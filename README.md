# ChordWiki Personal (Azure Static Web Apps 版)

この README.md は、人間および AI セットアップエージェントが  
**そのまま順番に実行することを想定**しています。  
記載順＝推奨実行順です。

このリポジトリは、**自作曲・自作コード譜**を  
**自前の Azure 環境に Web サイトとして構築・運用する**ためのプロジェクトです。

ソースコードの具体的な仕様については、リポジトリ内の実装を参照してください。  
ここでは **Azure 側で必要となるセットアップ手順**のみを記載します。

---

## 構成概要

本プロジェクトは、以下の Azure サービスを利用して構築されています。

- Azure Static Web Apps
- Azure Functions（Static Web Apps 付属 API）
- Azure Cosmos DB（Core SQL / NoSQL）

---

## この README の進め方

**最初からこの順で進めれば動きます。**

1. ローカルで必要なツールを入れる
2. このリポジトリを取得する
3. ローカルで frontend / API を起動して確認する
4. Azure Cosmos DB を作成する
5. GitHub に push する
6. Azure Static Web Apps を作成して GitHub と連携する
7. 環境変数と認証を設定する
8. 曲データを登録して運用を開始する

---

## 0. 事前に用意するもの

### 必須

- GitHub アカウント
- 個人の Azure アカウント
- Python 3.x
- Node.js **20.x**
- Azure Functions Core Tools **v4**

### 確認コマンド（Windows）

```powershell
python --version
node -v
func --version
```

> `func start` 後に `Node.js v16 reached EOL...` と出る場合は、Node.js が古いです。  
> **Node 20.x に更新**してください。

```powershell
winget install OpenJS.NodeJS.20
```

---

## 1. リポジトリを取得する

```bash
git clone <このリポジトリのURL>
cd chordwiki_personal
```

自分の GitHub アカウント上に新しいリポジトリを作る場合は、この時点で `origin` を差し替えて push します。

---

## 2. まずローカルで動作確認する

Azure に上げる前に、ローカルで表示と API を確認します。

### 2.1 frontend をローカル配信

```bash
cd frontend
python -m http.server 8080
```

ブラウザで以下を開きます。

- `http://localhost:8080`

### 2.2 `func` コマンドがない場合（Windows）

#### 方法1: `winget`

```powershell
winget search "Functions Core Tools"
winget install Microsoft.Azure.FunctionsCoreTools
```

#### 方法2: `npm`

```powershell
npm install -g azure-functions-core-tools@4 --unsafe-perm true
```

#### 方法3: 公式 MSI

- `https://learn.microsoft.com/ja-jp/azure/azure-functions/functions-run-local#install-the-azure-functions-core-tools`

### 2.3 API で使うローカル設定を用意

`api/local.settings.json` を作成し、**`COSMOS_ENDPOINT` と `COSMOS_KEY` は手動入力**します。

```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "COSMOS_ENDPOINT": "<Cosmos DB Endpoint>",
    "COSMOS_KEY": "<Cosmos DB Primary Key>",
    "COSMOS_DB_NAME": "ChordWiki",
    "COSMOS_DB_CONTAINER": "Songs"
  }
}
```

> `api/local.settings.json` はキー情報を含むため、**GitHub にコミットしません**。

### 2.4 依存関係をインストール

```bash
cd api
npm install
```

### 2.5 Azurite を起動

`AzureWebJobsStorage` の警告を避けるため、先に Azurite を起動します。

```bash
cd api
npm run start:storage
```

### 2.6 Azure Functions を起動

別ターミナルで:

```bash
cd api
func start
```

既定では、以下で起動します。

- `http://localhost:7071`

### 2.7 フロントとの接続

`frontend/js/runtime-config.js` により、以下の条件ではフロントが自動的にローカル API を参照します。

- `file://` でページを開いたとき
- `http://localhost:*` / `http://127.0.0.1:*` でページを開いたとき

この場合、`/api/...` への呼び出しは自動で `http://localhost:7071/api/...` に向きます。

### 2.8 API なしで UI だけ試す場合

Azure Functions や Cosmos DB をまだ起動していない場合でも、
トップページは `frontend/.local/local-test-songs.js` の
テストデータへ自動フォールバックします。

ローカル配信だけで、以下を確認できます。

- ランキング表示
- 曲名 / アーティスト検索
- タグ検索とサジェスト

> `/.auth/me` はローカル HTTP 配信では使えないため、editor 権限表示は未ログイン扱いです。

### 2.9 このフェーズの完了確認

以下が確認できれば、**Phase 1（AI 主導で実行しやすいフェーズ）は完了**です。

- `http://localhost:8080` がブラウザで開ける
- `func start` 後に `http://localhost:7071` が表示される
- 必要なら `http://localhost:8080` でトップページ表示と API 応答を確認できる

ここまで終わったら、次は **Azure Portal を人が操作するフェーズ** に進みます。

---

## 3. Azure Cosmos DB を作成する

⚠️ このセクションは Azure Portal を人が操作します（AI はナビゲートのみ）

Azure Portal で **Cosmos DB** を作成します。

### 設定の目安

- API: **Core (SQL / NoSQL)**
- Free Tier: **有効化推奨**
- Database 名: `ChordWiki`
- Container 名: `Songs`
- Partition Key: `/artist`

作成後、**Keys** 画面から以下を控えます。

- Endpoint URI
- Primary Key

これらを Static Web Apps の環境変数に設定します。

### Songs コンテナの参考スキーマ

Cosmos DB はスキーマレスですが、`Songs` コンテナでは以下のような曲ドキュメントを想定しています。

#### 必須フィールド

- `id`
- `artist`
- `title`
- `slug`
- `chordPro`

#### よく使う任意フィールド

- `tags` (`string[]`)
- `youtube` (`[{ id, start }]`)
- `createdAt`
- `updatedAt`
- `score`
- `last_viewed_at`

#### 参考ドキュメント例

```json
{
  "id": "sample-song-001",
  "artist": "Sample Artist",
  "title": "Sample Title",
  "slug": "sample-title",
  "tags": ["pop", "worship"],
  "chordPro": "{title: Sample Title}\n{subtitle: Sample Artist}\n[C]hello [G]world",
  "youtube": [
    { "id": "dQw4w9WgXcQ", "start": 0 }
  ],
  "createdAt": "2026-04-10T00:00:00.000Z",
  "updatedAt": "2026-04-10T00:00:00.000Z",
  "score": 0,
  "last_viewed_at": null
}
```

> `id + artist` の組み合わせで曲を特定し、Partition Key は `/artist` を使います。  
> `youtube.id` は YouTube 動画ID（11文字）を入れます。

### このフェーズの完了確認

以下が揃えば、このフェーズは完了です。

- Azure 上に `ChordWiki / Songs` コンテナが作成されている
- Partition Key が `/artist` になっている
- Endpoint URI と Primary Key を控えた

ここで **人の Azure Portal 操作が一区切り** となり、次に GitHub / デプロイ設定へ進みます。

---

## 4. GitHub に push する

1. 自分の GitHub アカウントで新しいリポジトリを作成
2. このソースコードを push

```bash
git remote set-url origin <自分のGitHubリポジトリURL>
git push -u origin main
```

---

## 5. Azure Static Web Apps を作成する

⚠️ このセクションは Azure Portal を人が操作します（AI はナビゲートのみ）

Azure Portal で **Static Web Apps** を作成し、GitHub リポジトリと連携します。

### 指定値

- プラン: `Free` または `Standard`
- ソース: `GitHub`
- リポジトリ: 上で push したもの
- ブランチ: `main`

### ビルド設定

- **App location**: `frontend`
- **API location**: `api`
- **Output location**: 空欄

保存すると、GitHub Actions による自動デプロイが構成されます。

### 5. Azure Static Web Apps 作成フェーズの完了確認

以下が確認できれば、このフェーズは完了です。

- Azure Static Web Apps リソースが作成された
- GitHub リポジトリ / ブランチ `main` と接続された
- GitHub Actions のワークフローが自動生成された

ここでも **Azure Portal 上の作業結果を人が確認してから**、環境変数設定に進むのが安全です。

---

## 6. Static Web Apps の設定を入れる

### 6.1 環境変数（必須）

Static Web Apps → **Configuration** → **Application settings** に、以下を追加します。

| 変数名 | 内容 |
| ------ | ---- |
| `COSMOS_ENDPOINT` | Cosmos DB Endpoint |
| `COSMOS_KEY` | Cosmos DB Primary Key |
| `COSMOS_DB_NAME` | Database 名 |
| `COSMOS_DB_CONTAINER` | Container 名 |

> 本番環境・プレビュー環境それぞれに設定が必要です。  
> 設定後は自動で再デプロイされます。

### 6.2 認証を有効化

Static Web Apps → **Authentication** から認証を有効化します。

- 本プロジェクトでは **Microsoft アカウント認証** を想定します
- 想定しているのは **Windows サインインにも使う個人の Microsoft アカウント** です

### 6. 設定投入フェーズの完了確認

以下が確認できれば、このフェーズは完了です。

- `COSMOS_ENDPOINT` / `COSMOS_KEY` / `COSMOS_DB_NAME` / `COSMOS_DB_CONTAINER` を設定した
- 必要な環境（本番 / プレビュー）に同じ設定を入れた
- 認証設定を有効化した

ここが **人の設定入力フェーズの最後の山場** です。設定反映後、初回デプロイ確認へ進みます。

---

## 7. 初回デプロイを確認する

- GitHub Actions が正常に完了すること
- Static Web Apps の URL にアクセスできること
- ログイン後に曲一覧・曲詳細が表示できること

を確認します。

### 7. 初回デプロイ確認フェーズの完了確認

- デプロイ後の URL にアクセスできる
- トップページから曲一覧が見える
- 曲詳細ページが開ける
- 必要なら編集画面から曲を登録・更新できる

---

## 8. 曲データを登録して運用開始

### 曲データの登録方法

- Web UI の編集画面から登録
- 必要なら Cosmos DB Data Explorer から直接登録

### 運用方法

- ソース修正後に GitHub へ push
- GitHub Actions により自動デプロイ
- 曲データは Cosmos DB に保持され続ける

---

## ローカル専用でコミットしないもの

以下はローカル専用です。

- `api/local.settings.json`
- `api/.azurite/`
- `node_modules/`

---

## 使用しない Azure サービス

本プロジェクトでは、以下の Azure サービスは使用しません。

- Azure App Service
- Azure API Management
- Azure SQL Database
- Azure Storage Blob
- CDN（Static Web Apps に内包）

---

## まとめ

- **ローカル確認 → Cosmos DB 作成 → GitHub push →**
  **Static Web Apps 作成 → 環境変数設定**
  の順で進めれば動きます
- データは Azure Cosmos DB に保存されます
- 表示・API・デプロイは Azure Static Web Apps に集約されています
- GitHub に push するだけで継続運用が可能です

---

## AI セットアップエージェント向け補足

このリポジトリには、ローカル実行型 AI エージェント向けの補助ガイドとして
`CLAUDE_CODE_SETUP.md` を同梱しています。

- **セットアップ手順の正本は README.md** です
- `CLAUDE_CODE_SETUP.md` は、README.md を安全に実行するための
  **行動指針・役割分担・注意事項** を補足するものです
- 内容が矛盾した場合は、**README.md を優先**してください

人が読む場合はこの README.md を基準に進めれば十分であり、
AI エージェントを併用する場合のみ `CLAUDE_CODE_SETUP.md` を参照してください。

（例: Claude Code など）向けの行動指針として  
`CLAUDE_CODE_SETUP.md` を含めています。

- セットアップを AI に支援させる場合は  
  **README.md + CLAUDE_CODE_SETUP.md の両方**を参照させてください
- README.md は **唯一の公式仕様書**です
- `CLAUDE_CODE_SETUP.md` は  
  AI が README.md を安全に順番通り実行するための補助ガイドです
