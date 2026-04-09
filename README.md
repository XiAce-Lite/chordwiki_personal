# ChordWiki Personal (Azure Static Web Apps 版)

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

## 1. Azure リソースの準備

### 1.1 Azure アカウント

- 個人の Azure アカウントを用意します
- 無料枠（Free Tier）で構築可能です

---

### 1.2 Azure Cosmos DB の作成

1. Azure Portal で **Cosmos DB** を作成します  
2. API は **Core (SQL / NoSQL)** を選択します  
3. Free Tier を有効化します（推奨）  

作成後、以下を設定します。

#### データベース・コンテナ

- **Database 名**：任意（例：`ChordWiki`）  
- **Container 名**：任意（例：`Songs`）  
- **Partition Key**：`/artist`  

> 曲情報はドキュメントとして保存され、  
> スキーマ制約はアプリケーション側で管理します。

---

### 1.3 Cosmos DB 接続情報の取得

Cosmos DB → **Keys** 画面で、以下の値を控えます。

- Endpoint URI  
- Primary Key  

これらは後続の Static Web Apps 設定で使用します。

---

## 2. GitHub リポジトリの準備

### 2.1 リポジトリの取得

以下のコマンドで、本リポジトリを取得します。

```bash
git clone <このリポジトリのURL>
```

### 2.2 GitHub への push

1. 自分の GitHub アカウント上に、新しいリポジトリを作成します  
2. clone したソースコードを、そのリポジトリへ push します  

---

## 2.5 ローカル動作確認（commit / deploy 前）

GitHub へ push する前に、ローカル環境で表示と API の動作確認ができます。

### 2.5.1 frontend をローカル配信

```bash
cd frontend
python -m http.server 8080
```

ブラウザで以下を開きます。

- `http://localhost:8080`

### 2.5.2 API をローカル起動

別ターミナルで以下を実行します。

```bash
cd api
npm install
func start
```

既定では Azure Functions は `http://localhost:7071` で起動します。

### 2.5.3 フロントとの接続

`frontend/js/runtime-config.js` により、以下の条件ではフロントが自動的にローカル API を参照します。

- `file://` でページを開いたとき
- `http://localhost:*` / `http://127.0.0.1:*` でページを開いたとき

この場合、`/api/...` への呼び出しは自動で `http://localhost:7071/api/...` に向きます。

### 2.5.4 API なしで表示・検索だけ試す

Azure Functions や Cosmos DB をまだ起動していない場合でも、トップページは `frontend/.local/local-test-songs.js` のテストデータへ自動フォールバックします。

- ランキング表示
- 曲名 / アーティスト検索
- タグ検索とサジェスト

をローカル配信 (`file://` / `http://localhost:*`) だけで確認できます。

テスト内容を増やしたい場合は、`frontend/.local/local-test-songs.js` の `title` / `artist` / `tags` / `score` を編集してください。

> 補足  
>
> - `/.auth/me` はローカル HTTP 配信では利用できないため、editor 権限の表示は未ログイン扱いになります  
> - Cosmos DB を使う機能は、`COSMOS_ENDPOINT` などの環境変数が未設定だと 500/設定エラーになります

---

## 3. Azure Static Web Apps の作成

### 3.1 Static Web Apps の作成

Azure Portal で **Static Web Apps** を作成し、以下を指定します。

- **プラン**：Free または Standard  
- **ソース**：GitHub  
- **リポジトリ**：上記で作成したもの  
- **ブランチ**：`main` など  

#### ビルド設定

- **App location**：`frontend`  
- **API location**：`api`  
- **Output location**：空欄（ビルドなし）  

保存すると、GitHub Actions による自動デプロイが設定されます。

---

### 3.2 初回デプロイの確認

- GitHub Actions が正常に完了することを確認します  
- Static Web Apps に割り当てられた URL へアクセスできることを確認します  

---

## 4. Static Web Apps の設定

### 4.1 環境変数の設定（必須）

Static Web Apps → **Configuration** → Application settings に  
以下の環境変数を追加します。

| 変数名 | 内容 |
| ------ | ------ |
| `COSMOS_ENDPOINT` | Cosmos DB Endpoint |
| `COSMOS_KEY` | Cosmos DB Primary Key |
| `COSMOS_DB_NAME` | Database 名 |
| `COSMOS_DB_CONTAINER` | Container 名 |

> **注意**  
>
> - 本番環境・プレビュー環境それぞれに設定が必要です  
> - 設定後、Static Web Apps は自動的に再デプロイされます  

---

### 4.2 認証の有効化

Static Web Apps → **Authentication** から認証を有効化します。

- 任意の認証プロバイダ（Microsoft / GitHub など）を設定します  
- 認証有効化後、未ログイン状態ではログイン画面へ誘導されます  

---

## 5. データ登録と運用

### 5.1 曲データの登録

- Web UI の編集画面から、曲とコード譜を登録します  
- 管理用途として、Cosmos DB の Data Explorer から直接登録することも可能です  

---

### 5.2 運用

- ソースを修正し GitHub に push します  
- GitHub Actions により Azure 環境へ自動デプロイされます  
- 曲データは Cosmos DB に保持され続けます  

---

## 6. 使用しない Azure サービス

本プロジェクトでは、以下の Azure サービスは使用しません。

- Azure App Service  
- Azure API Management  
- Azure SQL Database  
- Azure Storage Blob  
- CDN（Static Web Apps に内包）  

---

## まとめ

- 自作コード譜を **個人用 Web サイト**として構築する構成です  
- データはすべて自前の Azure Cosmos DB に保存されます  
- 表示・API・デプロイは Azure Static Web Apps に集約されています  
- GitHub に push するだけで継続運用が可能です  
