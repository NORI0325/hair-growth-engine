## 目的

サロンボード連携を「疎通テスト経由でしか live に昇格しない」安全な自動昇格パイプラインにする。
手動の強制 live は使わない。失敗理由は管理画面で可視化。

## 現状の問題

- `bookings` 5/7 10:00 テスト太郎 は作成されたが、`channel_integrations.salonboard.connection_status='disconnected'` のため `staff-create-booking` の `liveIntegrations` フィルタで除外され、`sync_jobs` が作られず Worker にも送られていない。
- 既存の `worker-dry-run` Edge Function は、新しい Worker JobSchema が要求する `store_id` を含んでいないため、現状そのままでは Worker で 400 になる。
- 疎通テストの結果を保存し可視化する仕組みがない。

## 実装内容

### 1. `worker_request_logs` テーブル新規作成（マイグレーション）

カラム:
- `owner_id` / `location_id` / `channel`
- `kind`（`dry_run_create` / `dry_run_update` / `dry_run_cancel` / `live_create` 等）
- `request_payload` / `response_status` / `response_body` / `latency_ms`
- `success`（boolean）/ `error_message`
- `created_at`

RLS: テナントメンバーのみ自店分を閲覧可。書き込みは Edge Function の service role のみ。

### 2. Edge Function: `salonboard-connection-test` 新規作成

入力: `{ owner_id, location_id }`

処理（順番に実行、失敗即停止）:

1. `salonboard-session-fetch` 相当のロジックで login_id / password を復号取得  
   失敗時 → `connection_status='error'`, `last_error='credentials_decrypt_failed'`
2. Worker `/api/sync-job` に **dry_run create** をPOST（`store_id`/`location_id` 付き、`reservation.dry_run=true`）
3. Worker に **dry_run update** をPOST
4. Worker に **dry_run cancel** をPOST
5. すべて success の場合のみ:
   - `channel_integrations` を以下に更新:
     - `connection_status='live'`
     - `test_create_passed_at` / `test_update_passed_at` / `test_cancel_passed_at = now()`
     - `live_enabled_at = now()`
     - `last_error = null`
6. 失敗があった場合:
   - `connection_status='needs_review'`（または `'error'`）
   - `last_error` に失敗内容を保存

各ステップで `worker_request_logs` に request/response/latency を保存。
レスポンスでフロントへ各ステップの ok/ng と理由を返す。

### 3. `staff-create-booking` の判定緩和

現状 `connection_status === "live"` のみ通すのは正しいので維持。
ただし `disconnected` でスキップされた場合の `bookings.sync_status` を、現在の `not_required` から **`skipped_disconnected`**（または同等）に変えて、管理画面で「連携未完了のため未送信」と区別可能にする。

### 4. 管理画面: チャンネル連携ページに「疎通テスト実行」ボタン

`src/pages/ChannelIntegrations.tsx` に:

- 「疎通テストを実行」ボタン（manager+ のみ）
- 実行中スピナー
- 結果表示（create/update/cancel それぞれの ok/ng と理由）
- `connection_status` バッジ（disconnected / needs_review / error / live）
- `last_error` の文章表示
- 直近の `worker_request_logs` 数件をリスト表示（latency, status, success, error_message）

### 5. 5/7 10:00 テスト太郎の取り扱い

既存予約は `sync_jobs` が無く `not_required` 確定済みなので、Worker 経由の同期は走らない。
連携 live 化後に同等の予約をもう1件作ってE2Eテストする。
（既存予約を再キックするのは別タスク。今回は触らない）

## 実装順序

1. マイグレーション: `worker_request_logs` テーブル + RLS
2. Edge Function `salonboard-connection-test` 新規作成
3. `staff-create-booking` の `sync_status` ラベル調整
4. `ChannelIntegrations.tsx` に疎通テストUI追加
5. ユーザーが画面から疎通テスト → 全パスで自動 live 化 → もう1件公開予約してE2E

## ユーザー側で必要な操作

- 実装後、チャンネル連携画面の「疎通テストを実行」ボタンを押すだけ。
- VM Worker 側は既に最新版で稼働済みなので変更不要。

## 確認

このプランで進めて良いですか？ 特に「失敗時のステータス名」を `needs_review` にするか `error` にするかは2案あります（plan承認時にどちらか教えてください。デフォルトは `needs_review`）。