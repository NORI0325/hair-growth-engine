## 目的

既存 SalonBoost に「外部予約媒体との同期管理」レイヤーを段階追加し、二重予約リスクを下げる。
既存DB・UI・認証はそのまま、追加のみ。実ブラウザ自動操作は外部ワーカー側、本アプリはジョブ／ログ／確認UIのみ担当。

---

## 既存資産（確認済み・再利用）

- `bookings` には既に `external_source` / `external_reservation_id` あり → 再利用
- 認証・RLS は `is_tenant_member(owner_id)` ベース → 全新規テーブルに同パターン適用
- 既存ページ：`Reservations.tsx` `CalendarPage.tsx` `Staff.tsx` `MenuItems.tsx` `Settings.tsx` `Dashboard.tsx` に追記
- LINE/サロンボード関連の既存 Edge Function は触らない

---

## Phase 1（今回実装する範囲）

### A. DB 拡張（マイグレーション 1 本）

1. **`bookings` 追記**
   - `source_channel TEXT`（既存 `external_source` と並走。値域：`salonboard / rakuten_beauty / line_reservation / google_reservation / own_web / phone / manual`）
   - `sync_status TEXT DEFAULT 'not_required'`（`not_required/pending/syncing/success/failed/needs_review`）
   - `sync_error_message TEXT`
   - `last_synced_at TIMESTAMPTZ`
   - `needs_manual_review BOOLEAN DEFAULT false`
   - ※ `external_reservation_id` は既存カラムを流用

2. **`channel_integrations`**（店舗×媒体 設定）
   - `id, owner_id, location_id, channel, enabled, sync_enabled, last_synced_at, last_status, failure_count, last_error, note, created_at, updated_at`
   - UNIQUE(`owner_id, location_id, channel`)
   - **ログイン情報は保存しない**（カラム自体作らない）

3. **`sync_jobs`**
   - `id, owner_id, location_id, reservation_id, target_channel, job_type, status, retry_count INT DEFAULT 0, request_payload JSONB, response_payload JSONB, error_type, error_message, created_at, updated_at`

4. **`sync_logs`**
   - `id, owner_id, sync_job_id, reservation_id, channel, level, message, metadata JSONB, created_at`

5. **`staff_channel_mappings`** / **`menu_channel_mappings`**
   - `id, owner_id, location_id, staff_id|menu_id, channel, external_name, external_id, created_at, updated_at`
   - UNIQUE(`staff_id|menu_id, channel`)

6. **RLS**：全テーブル `is_tenant_member(owner_id, auth.uid())` で SELECT/INSERT/UPDATE/DELETE。
7. **トリガー**：`updated_at` 自動更新（既存 `set_updated_at()` 流用）。

### B. Edge Functions

- **`sync-job-dispatch`**：予約作成時に呼ぶ。`channel_integrations` を見て対象媒体ごとに `sync_jobs` を作成 → 外部ワーカーAPIへ POST → レスポンスで `sync_jobs` / `bookings.sync_status` 更新 → `sync_logs` 追記。
- **`sync-job-retry`**：要確認画面の「手動再同期」用。`retry_count < 3` のみ。
- **`sync-worker-callback`**（公開 / 共有シークレットで認証）：外部ワーカーが非同期に結果を返す用。

外部ワーカーURLとシークレットは Secrets：
- `EXTERNAL_WORKER_API_URL`
- `EXTERNAL_WORKER_API_KEY`

POST/レスポンス形式は要件通り。エラー種別 8 種をそのまま `error_type` に保存。

### C. 予約作成への組込み

既存の予約作成パス（`create-booking` Edge Function、管理画面の手動登録、`public_create_booking_v3`）の **後段** で：
1. 同スタッフ・同時間の重複チェック（既存 `bookings` を tsrange で）
2. 重複あり → `sync_status='needs_review'`, `needs_manual_review=true`、ジョブは作らない
3. 重複なし → 各 `sync_enabled=true` 媒体に `sync_jobs` 作成
4. `sync-job-dispatch` を非同期 invoke（fire-and-forget、失敗してもブロックしない）

> 既存トリガー（thank_you / reminder 等）には触らない。

### D. UI 追加（既存デザイントークン踏襲）

1. **`Settings.tsx` にタブ「外部媒体連携」追加**
   - 6 媒体カード：ON/OFF・同期対象・最終同期・失敗数・エラー表示・手動再同期・備考
2. **`Staff.tsx` / `MenuItems.tsx`**：各行に「媒体別マッピング」アコーディオン追加（媒体名／外部名／外部ID）
3. **新ページ `SyncReview.tsx`（ルート `/sync-review`）**：要確認キュー
   - フィルタ：媒体／エラー種別／日付
   - 行アクション：手動再同期 / 確認済みにする
4. **`CalendarPage.tsx` / `Reservations.tsx`**：予約セルに `sync_status` バッジ（success=和グリーン小ドット、pending=ゴールド、failed/needs_review=赤・目立つ）
5. **`Dashboard.tsx`**：Eyebrow「同期ステータス」セクション追加
   - 本日の失敗件数 / 要確認件数 / 媒体別件数 / 最終同期時刻 / 同期エラー Top 5

### E. セキュリティ

- 認証情報カラム無し（外部ワーカーが Vault 管理する前提）
- `sync_logs.metadata` は保存前に `password/token/cookie/authorization` キーをマスク
- RLS で店舗分離
- 自動リトライなし、手動 3 回まで

---

## 段階 ON/OFF

`channel_integrations.sync_enabled=false` の店舗では一切の `sync_jobs` を作らない＝既存挙動と完全互換。
`EXTERNAL_WORKER_API_URL` 未設定時はジョブを `pending` のまま保持しエラーにしない。

---

## Phase 2 以降（今回はやらない）

- 外部ワーカー本体（Playwright）
- 双方向同期（外部→本アプリの取り込み拡張）
- 楽天ビューティーAPI連携
- Google予約 API 連携

---

## 技術メモ

- ENUM ではなく TEXT + CHECK（後から媒体追加が容易）
- `sync_jobs` `(status, created_at)` にインデックス
- `bookings(sync_status) WHERE sync_status IN ('failed','needs_review')` 部分インデックス（要確認画面高速化）
- 既存 `external_source / external_reservation_id` と `source_channel / sync_status` は別軸として共存。マイグレーションで既存行は `source_channel := COALESCE(external_source,'manual')`、`sync_status := 'not_required'` で初期化。
