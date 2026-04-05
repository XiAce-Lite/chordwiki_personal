# ChordWiki 個人バックアップ（限定公開）設計書

---

## 目的

ChordWiki のコード譜（ChordPro）を個人用にバックアップし、  
知人には限定公開する。

- 閲覧：ログイン必須（誰でも）
- 編集・新規登録：オーナーのみ

---

## 1. 要件整理

### 1.1 機能要件

- **閲覧**
  - タイトル / アーティスト / タグ（OR）検索
  - 曲詳細表示（ChordPro レンダリング）
- **編集**
  - コード譜の新規登録・更新（オーナーのみ）
- **非対応**
  - 歌詞本文の全文検索
  - ユーザー管理画面

### 1.2 非機能要件

- 限定公開（Microsoft アカウント認証）
- 権限制御（閲覧と編集の分離）
- 無料枠中心で運用
- 長期放置しても壊れにくい構成

---

## 2. 全体アーキテクチャ

[ Browser ]  
↓（Microsoft 認証）  
[ Azure Static Web Apps ]  

- Frontend（HTML / CSS / JS）
- Auth / Role 管理  
- API ルーティング  

↓  

[ Azure Functions ]  

- 検索 API  
- 曲取得 API  
- 編集 API  

↓  

[ Azure Cosmos DB（NoSQL） ]

---

## 3. Azure サービス構成

### 3.1 Azure Static Web Apps（Free）

- フロントエンド配信
- Microsoft Entra ID 認証
- API ゲートウェイ
- ロール
  - authenticated：閲覧
  - editor：編集

---

### 3.2 Azure Functions（Consumption）

- HTTP API のみ使用
- 認証・認可は SWA 側で実施
- Functions 自体は stateless

---

### 3.3 Azure Cosmos DB（Core SQL / Free Tier）

- Database：ChordWiki
- Container：Songs
- Partition Key：/artist
- RU：1000 RU/s（Free Tier）

---

## 4. 認証・認可設計

### 4.1 認証フロー

1. 未ログインでアクセス
2. /login → Microsoft ログイン
3. authenticated ロール付与

---

### 4.2 ロール付与

- オーナー：editor
- ゲスト：authenticated

---

### 4.3 ルーティング制御（staticwebapp.config.json）

- / → authenticated
- /song/* → authenticated
- /edit/* → editor
- /api/edit/* → editor

---

## 5. データモデル（Cosmos DB）

### 5.1 ドキュメント構造

- id：UUID
- slug：URL 用
- title：曲名
- artist：アーティスト名（Partition Key）
- tags：検索用タグ
- chordPro：本文
- updatedAt：更新日

### 5.2 サンプル

{
  "id": "test-uuid",
  "slug": "test-song",
  "title": "テスト曲",
  "artist": "テスト",
  "tags": ["テスト"],
  "chordPro": "{title:テスト曲}\n[C]テストです",
  "updatedAt": "2026-04-05"
}

---

## 6. API 設計

### 6.1 曲取得 API（Point Read）

- GET /api/song/{artist}/{id}
- Cosmos DB の id + partition key で取得
- 権限：authenticated

---

### 6.2 検索 API

- GET /api/search
- クエリ
  - q：部分一致
  - tags：OR 検索
- クロスパーティション前提

---

### 6.3 編集 API

- POST /api/edit/song
- PUT /api/edit/song/{id}
- 権限：editor

---

## 7. フロントエンド設計

### 7.1 ページ構成

- /：検索
- /song.html：曲表示
- /edit/{id}：編集
- /403.html：権限エラー

---

### 7.2 表示制御

- /.auth/me でロール判定
- editor のみ編集 UI 表示

---

### 7.3 レンダリング

- API は JSON のみ
- ChordPro → HTML はクライアントサイド

---

### 7.4 フロントエンド構成

frontend/

- index.html
- song.html
- edit.html
- 403.html
- css/
- js/
- staticwebapp.config.json

---

## 7.5 ChordPro → HTML 変換設計

### 対象記法

- {title:}
- {artist:}
- {comment:}
- [C] [Am] [G/B]

### 方針

- クライアントサイドのみ
- 未対応記法でも壊れない
- CSS で整形

---

## 8. デプロイ

- GitHub push
- GitHub Actions
- Azure Static Web Apps 自動反映

---

## 9. コスト

- Static Web Apps：¥0
- Azure Functions：¥0
- Cosmos DB：¥0（Free Tier）

---

## 10. 将来拡張

- タグ AND 検索
- Markdown / JSON エクスポート
- 移調機能

---

## 付録

- 設計：本ドキュメント
- 実装：VS Code + GitHub Copilot
- 管理：個人
