# Autoscroll / Duration Migration（実装済みメモ）

本ドキュメントは、Chordwiki-AutoScroller 由来の能力を `chordwiki_personal` の曲ページへ取り込む計画と、その後の**実装結果**をまとめたものです。

## 1. 当初のゴール

1. 自動スクロール再生中のハイライトオーバーレイ
2. 曲長推定のプロバイダ優先順（iTunes → MusicBrainz → YouTube）

## 2. 制約（当時の方針）

- Azure Functions + 静的フロントの既存構成を維持する
- `{t:}` / `{s:}` からタイトル・歌手を取らず、**Cosmos の `title` / `artist`** を正とする
- ブラウザ拡張と同じアーキテクチャにはしない

## 3. 現状（実装後）

### 3.1 フロント

- `frontend/js/song-autoscroll.js` が **`GET /api/duration/estimate`** を呼び出し、
  `found` / `durationSec` / `source`（`itunes` | `musicbrainz` | `youtube`）に応じて UI を更新する
- ハイライト切替・オーバーレイは曲ページに実装済み（計画 §7 相当）

### 3.2 バックエンド

- **統合エンドポイント**: `GET /api/duration/estimate`（`api/duration-estimate`）
- `api/youtube-search-duration` は **レガシー個別エンドポイント**として残存しうるが、
  曲ページの自動推定フローからは参照しない

## 4. 当初の「目標アーキテクチャ」（参照用）

以下は計画時点のメモであり、**現在の実装の正本は `ChordWiki-Architecture.md` §6.7** とする。

- 統合 API: `GET /api/duration/estimate?title=...&artist=...`
- サーバー側の試行順: iTunes → MusicBrainz → YouTube → `found: false`

## 5. リスク・緩和（計画時）

1. iTunes / MusicBrainz の誤マッチ → トークン重なり等の軽い検証
2. 外部 API 遅延 → タイムアウト
3. オーバーレイと付箋・手書きの視覚的重なり → 装飾レイヤとして分離

## 6. ドキュメント

- `ChordWiki-Architecture.md` … API 一覧・§6.7 を実装に合わせて更新済み
- `USER_GUIDE.md` … 自動推定のユーザー向け説明を追記済み

## 7. 受け入れ条件（計画時）と照合

1. プロバイダ順は iTunes → MusicBrainz → YouTube で統合 API に実装済み
2. ChordPro タグからのメタデータ抽出に依存しない → 維持
3. ステータス表示が実際の `source` と一致 → 実装済み
4. ハイライトは曲単位で永続化可能 → 実装済み（詳細はソース参照）
