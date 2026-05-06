## 棚卸し結果（既存 vs 不足）

| # | 要件 | 既存 | 不足 |
|---|---|---|---|
| 1 | 店舗ごとの連携設定 | `channel_integrations`（owner_id+location_id, enabled, sync_enabled, last_status, failure_count, last_error） | `connection_status` / `default_rsv_route_id` / `storage_state_path` / `last_login_at` / `last_success_at` / `mapping_complete` / `test_passed_at` カラム |
| 2 | サロンボード認証保存 | `salonboard_credentials`（tenant単位・login_id/password/cookie_session 暗号化） | **location単位ではない**（tenant単位）。`storage_state_encrypted` 列なし（Playwright storageState 用）。Worker側で店舗別に読み出す仕組みなし |
| 3 | staff/menu マッピング | `staff_channel_mappings` / `menu_channel_mappings`（owner_id, location_id, channel, external_id, external_name） | `enabled` フラグ無し。menu側に `external_setmenu_id` / `rsv_term` 専用列なし（external_id に setmenuId を入れている運用） |
| 4 | 公開予約での絞り込み | なし（`public_create_booking_v3` は全 active staff/menu 対象） | sync_enabled 店舗ではマッピング済みのみ表示 / 仮受付許可フラグ `allow_unmapped_booking` |
| 5 | ステータス管理 | `last_status` のみ（success/failed/pending） | `connection_status` enum（未接続/接続済/マッピング未完了/テスト未完了/本番ON/停止中/要再認証）+ 本番ON判定 RPC |
| 6 | Worker店舗分離 | Worker は `.env` の単一 `SALONBOARD_USER_ID/PASSWORD` 固定 | **致命的ギャップ**: job ごとに owner_id/location_id から credentials を取得 → 店舗別 storageState で実行する仕組みが無い |
| 7 | 予約作成→確定フロー | `staff-create-booking` は `pending` で作成、`sync-job-dispatch` は同期invoke | `pending_sync` ステータス・10〜20秒待機ロジック・confirmed昇格・タイムアウト時 syncing 維持 |
| 8 | 再試行/needs_review | `sync-job-retry`、`SyncReview.tsx` 一覧 | error_type 別の再試行可否分類、needs_review 行アクション（再同期 / 手動済み / 予約キャンセル）、通知 |
| 9 | 権限・RLS | tenant member/manager で全テーブル分離 OK | Worker の job 検証（owner_id/location_id 突合）。ログマスク（`storageState`/`Cookie`/`password`） |
| 10 | オンボーディング画面 | `ChannelIntegrations.tsx`（一覧/ON-OFF/再同期）、`Staff.tsx`/`MenuItems.tsx` にマッピングUI（`ChannelMappingDialog`） | サロンボード専用ウィザード（接続→セッション→staff/menu マッピング→経路設定→3種テスト→本番ON）。`/onboarding/salonboard/:locationId` |
| 11 | 導入フロー | バラバラに存在 | 上記ウィザードで順序強制、各ステップ完了でフラグ更新 |

---

## 実装提案（フェーズ分け）

### Phase A: DB拡張（マイグレーション 1本）

1. **`channel_integrations` 列追加**
   - `connection_status TEXT DEFAULT 'disconnected'`（disconnected/connected/mapping_incomplete/test_pending/live/paused/reauth_required）
   - `default_rsv_route_id TEXT DEFAULT 'K000000001'`
   - `storage_state_path TEXT`（"salonboard/{owner_id}/{location_id}/state.json"）
   - `last_login_at`, `last_success_at TIMESTAMPTZ`
   - `test_create_passed_at`, `test_update_passed_at`, `test_cancel_passed_at TIMESTAMPTZ`
   - `allow_unmapped_booking BOOLEAN DEFAULT false`
   - `live_enabled_at TIMESTAMPTZ`（明示ON時刻）

2. **`salonboard_credentials` 拡張**（tenant単位 → location単位）
   - 新規 `salonboard_sessions` テーブル：`owner_id, location_id, login_id_encrypted, password_encrypted, storage_state_encrypted, last_login_at, login_status, last_error`
   - UNIQUE(`owner_id, location_id`)
   - 既存 `salonboard_credentials` は互換のため残し、移行スクリプトで location_id=primary に詰め直す

3. **`staff_channel_mappings` / `menu_channel_mappings`**
   - `enabled BOOLEAN DEFAULT true` 追加
   - menu側に `external_setmenu_id TEXT`, `rsv_term INT`（既存 `external_id` を `external_setmenu_id` にコピー）

4. **`bookings` 拡張**
   - `last_sync_error TEXT`, `sync_attempt_count INT DEFAULT 0`
   - `booking_status` enum に `pending_sync` 追加（`syncing` は `sync_status` 側で表現）

5. **RPC追加**
   - `is_salonboard_live(_owner_id, _location_id) RETURNS boolean`
     条件: `connection_status='live'` AND `sync_enabled` AND セッション有効 AND staff/menu マッピング1件以上 AND 3テスト合格
   - `recompute_channel_status(_owner_id, _location_id)`：上記条件で connection_status を更新（マッピング保存・テスト通過時に呼ぶ）

### Phase B: Worker 店舗分離（最重要）

- 本アプリ側に新Edge Function `salonboard-session-fetch`（Worker専用Bearer認証）を作成
  - 入力: `owner_id, location_id`
  - 出力: 復号した `login_id` / `password` / `storage_state`（JSON）
- Worker `src/server.ts`:
  - job スキーマに `owner_id, location_id` 必須化
  - `loginSalonboard` を呼ぶ前に `fetchSession(owner_id, location_id)` で取得
  - `storage_state` があれば `browser.newContext({ storageState })` で再利用
  - ログイン成功後の `context.storageState()` を本アプリの `salonboard-session-save` で暗号化保存
- ファイルシステム保存はせず DB 暗号化に統一（VPS 障害耐性のため）
- `.env` の `SALONBOARD_USER_ID/PASSWORD` は撤去（dev フォールバックのみ）
- ログ出力に `password / cookie / authorization / storage_state` のキーをマスクする helper を `logger.ts` に追加

### Phase C: 予約作成フロー強化

- `staff-create-booking` / `public_create_booking_v3` を改修：
  - `is_salonboard_live` が true の店舗 → `booking.status='pending_sync'`, `sync_status='pending'`
  - sync-job-dispatch を invoke、最大15秒ポーリング（500ms間隔）で `sync_jobs.status` 監視
  - 成功 → `confirmed` + `synced` + `external_reservation_id`
  - 失敗 → `needs_review` + `last_sync_error`
  - タイムアウト → `pending_sync` 維持、バックグラウンド処理に委譲
- `sync-worker-callback` でバックグラウンド完了時に bookings を更新

### Phase D: 公開予約 UI 絞り込み

- `public_create_booking_v3` / `get_available_slots_by_staff` を改修：
  - sync_enabled かつ NOT allow_unmapped_booking なら staff/menu に `EXISTS staff_channel_mappings/enabled` を JOIN
- `PublicBooking.tsx` の staff/menu 取得側でも同条件
- `Settings` に「未マッピング予約を仮受付として許可する」トグル

### Phase E: 再試行・needs_review 強化

- `sync-job-retry` に再試行可否マップを追加
  - 可: `network_error / timeout / temporary_external_error`
  - 不可: `mapping_not_found / captcha_required / duplicate_risk / capacity_exceeded / out_of_business_hours / required_field_missing`
- `SyncReview.tsx` に行アクション3種（再同期 / 手動済 / 予約キャンセル）と失敗理由表示
- 失敗時オーナーへ通知（`notify-owner-booking` 流用、新 type `sync_failed`）

### Phase F: オンボーディングウィザード

- 新ページ `/onboarding/salonboard/:locationId`（`SalonboardOnboarding.tsx`）
  - ステップ1: 接続（ID/PW入力 → `salonboard-credentials-save` → ログインテスト）
  - ステップ2: セッション保存確認
  - ステップ3: staff マッピング（既存 `ChannelMappingDialog` 流用）
  - ステップ4: menu マッピング
  - ステップ5: rsvRouteId 設定
  - ステップ6: create→update→cancel テスト（テスト顧客で実行 → 各成功で `test_*_passed_at` 更新）
  - ステップ7: 本番同期ON ボタン（`is_salonboard_live` 条件満たす時のみ活性）
- `ChannelIntegrations.tsx` から「サロンボードを設定する」ボタンで遷移

### Phase G: セキュリティ確認

- 新 `salonboard_sessions` の RLS: `is_tenant_member(owner_id) AND has_location_role(location_id, 'manager')`
- Worker→本アプリ呼び出しは Bearer (`WORKER_API_KEY`) かつ owner_id/location_id 検証
- `sync_logs.metadata` insert 前にマスク関数を通す（既存 plan.md にあるが未実装ならここで実装）

---

## 技術メモ

```text
[公開予約画面]
   │ submit
   ▼
[public_create_booking_v3] ── is_salonboard_live? ──No──▶ confirmed (即時)
   │ Yes
   ▼
[booking: pending_sync / sync_status: pending]
   │ invoke sync-job-dispatch
   ▼
[sync_jobs: pending] ──HTTP──▶ [Worker] ──┐
                                          │ session DB から取得
                                          │ storageState で再ログイン省略
                                          ▼
                                    [salonboard create]
                                          │
   ┌─ ≤15s polling ◀──── result ──────────┘
   │
   ├─ success → confirmed + synced + external_reservation_id
   ├─ failure(non-retry) → needs_review
   └─ timeout → pending_sync (callback待ち)
```

実装順序の推奨: A → B（最重要・現状全店舗で同じ認証情報になるリスク）→ C → D → E → F。
Phase A のマイグレーション内容を承認いただき次第、順次着手します。