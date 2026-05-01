## 🎯 ゴール
1ユーザー（オーナー）が複数店舗を1ログインで管理できるようにし、店舗数に応じた段階的課金を実現する。

---

## 📐 アーキテクチャ変更の核心

### 現状の問題
現在は `profiles.id = auth.users.id = tenant_id` という1対1の構造で、「テナント = 店舗 = ユーザー」が完全に同義。複数店舗を持てない。

### 新構造
```text
auth.users (オーナー個人)
    │
    └─ tenant_members (所属関係)
            │
            └─ tenants (組織) ← 新規テーブル ⭐
                  │
                  └─ locations (店舗) ← 新規テーブル ⭐
                        │
                        ├─ customers, bookings, staff, menu_items 等
                        │   (全て location_id を持つ)
                        └─ subscriptions は tenants 単位
```

**重要な決定**:
- `subscriptions` は **tenant単位**（オーナー1人が払う）
- `customers`, `bookings`, `staff`, `menu_items`, `coupons`, `incentives`, `salon_hours`, `staff_schedules`, `campaigns` などの業務データは **location単位**
- `profiles` は legacy として残しつつ、新しい `locations` に主要設定を引き継ぐ

---

## 🗄️ DB マイグレーション

### Phase A: テーブル新設
1. **`tenants`** — 組織（会社・個人事業主）
   - `id`, `name`, `owner_user_id`, `created_at`
2. **`locations`** — 店舗
   - `id`, `tenant_id`, `name`, `public_slug`, `salon_settings...`（profilesから引き継ぐ営業時間・LINE設定等）
   - `is_primary` フラグ（最初の店舗）
3. **`location_members`** — 店舗別スタッフ権限
   - `location_id`, `user_id`, `role`（マネージャーは特定店舗のみ管理可能等）
   - **オーナーは tenant_members 経由で全店アクセス**

### Phase B: 既存テーブルへの `location_id` 追加
- `customers`, `bookings`, `staff`, `menu_items`, `coupons`, `incentives`, `salon_hours`, `staff_schedules`, `campaigns`, `line_templates`, `template_overrides`, `customer_message_templates`, `line_inbound_messages`, `line_pending_friends`, `external_reservation_logs`, `scheduled_jobs`, `staff_time_off`, `customer_ai_insights`, `booking_tokens`, `tenant_usage_counters` に `location_id uuid` を追加。

### Phase C: 既存データ移行
- 既存の各 `profiles` レコードに対し、対応する `tenants` + `locations`（is_primary=true）を1件ずつ作成
- 既存業務データの `owner_id` から `location_id` を逆引きして埋める
- `tenant_members.tenant_id` を新 `tenants.id` に張り替え

### Phase D: スキーマ調整
- `subscriptions` を `tenant_id` ベースに変更（`owner_id` → `tenant_id`）
- RLS ポリシーを全面改訂：
  - `is_tenant_member(tenant_id, user_id)` を維持
  - 新規 `is_location_accessible(location_id, user_id)` を追加（オーナー＝全店、マネージャー＝指定店、スタッフ＝指定店）
- 全業務テーブルの RLS を `is_location_accessible(location_id, auth.uid())` に変更

### Phase E: DB関数の更新
- `public_create_booking_v3` などの予約系関数に `location_slug` パラメータを追加（または `location_public_slug` で切り替え）
- `handle_new_user()` を「tenant + 1店舗目を自動作成」に変更
- `current_tenant_id()` は維持

---

## 💰 課金変更（段階的料金）

### 価格構造
- **1店舗目**: ¥9,800/月（既存 `salon_boost_standard` 流用）
- **2店舗目以降**: ¥7,800/月（新規プロダクト `salon_boost_additional_location`）

### 実装方法
Stripe の **メータード課金 or サブスク数量** を使用：
- 1つの Subscription に2つのプロダクトを line_items として乗せる
- `salon_boost_standard` × 1（固定）
- `salon_boost_additional_location` × N（N = 店舗数 - 1、店舗追加時に `subscription.update` で数量変更）

### Edge Function 更新
- `create-checkout-session`: 初回チェックアウトは Standard×1 のみ
- 新規 `add-location`: 店舗追加 → Stripe サブスクの additional_location 数量を +1 → DB に locations 追加
- 新規 `remove-location`: 店舗削除 → Stripe 数量を -1
- `payments-webhook`: line_items の各 quantity を読み取り `tenants.location_quota` を同期

---

## 🎨 UI 変更

### 1. 店舗切り替えドロップダウン（AppLayout）
ヘッダー左上に現在の店舗名を表示し、クリックで他店舗に切り替え。`useCurrentLocation()` フックで全画面が自動的に該当店舗のデータを表示。

### 2. 店舗管理ページ `/locations` （新規）
- 店舗一覧（カード表示）
- 「+ 店舗を追加」ボタン → モーダルで店舗名入力 → Stripe数量更新 → 新店舗作成
- 店舗削除（確認ダイアログ＋データ移行/削除選択）
- オーナーのみアクセス可能

### 3. オンボーディング更新
- 「店舗名」入力時に「複数店舗をお持ちですか？」のチェックを追加（後で追加も可能と明記）

### 4. チーム管理 `/team` 拡張
- スタッフ招待時に「アクセス可能な店舗」を選択（複数選択可）
- マネージャーは特定店舗のみ、オーナーは自動的に全店

### 5. 請求ページ `/billing` 更新
- 現在の店舗数と次回請求額を表示
- 内訳: 「Standard ¥9,800 + 追加店舗 ¥7,800 × N = 合計」

### 6. 公開予約ページ
- URL を `/book/{tenant_slug}/{location_slug}` に変更（または `/book/{location_slug}` で全店ユニーク）
- 既存 `public_slug` は location 単位に移行

---

## 🔧 React側のコード変更

### 新規フック
- `useCurrentLocation()`: localStorage に現在選択中の location_id を保存、Context経由で全画面に提供
- `useLocations()`: ユーザーがアクセス可能な店舗一覧を取得

### 既存クエリの更新
全ての `.eq("owner_id", ...)` を `.eq("location_id", currentLocationId)` に置き換え（顧客、予約、メニュー、スタッフ、クーポン、キャンペーン、AI insight、テンプレート）。

### 影響を受ける主要ファイル
- `src/hooks/useTenant.tsx` → `useTenant` + `useCurrentLocation` に分割
- `src/components/AppLayout.tsx` → 店舗切替ドロップダウン追加
- `src/pages/Customers.tsx`, `Bookings.tsx`, `Calendar.tsx`, `Menu.tsx`, `Staff.tsx`, `Campaigns.tsx`, `Coupons.tsx` 他、ほぼ全画面
- 公開予約ページ `BookingPublic.tsx` のスラッグ解決ロジック

---

## 📋 実装フェーズ（推奨実行順）

| # | フェーズ | 内容 | 所要 |
|---|---------|------|------|
| 1 | **DB基盤** | tenants/locations テーブル新設、location_id追加、データ移行、RLS刷新 | 大 |
| 2 | **DB関数** | 予約RPC、handle_new_user、ヘルパー関数の更新 | 中 |
| 3 | **Stripe課金** | 追加店舗プロダクト作成、Checkout/Webhook更新 | 中 |
| 4 | **Reactフック** | useCurrentLocation, useLocations, Context整備 | 中 |
| 5 | **UI: 店舗切替** | AppLayoutドロップダウン | 小 |
| 6 | **UI: 店舗管理** | /locations ページ + 追加/削除モーダル | 中 |
| 7 | **UI: 既存画面移行** | 全画面のクエリを location_id ベースに | 大 |
| 8 | **UI: チーム/請求** | スタッフ店舗権限、料金内訳表示 | 中 |
| 9 | **公開予約** | location_slug ベースに変更 | 小 |

---

## ⚠️ リスク & 注意

1. **既存データのマイグレーション失敗リスク**: 必ずトランザクション内で実行し、ロールバック可能に
2. **RLS刷新による一時的なアクセス不能**: 関数を先にデプロイし、ポリシーを段階的に切り替え
3. **公開予約URLの変更**: 既存の `/book/{old-slug}` を新URLにリダイレクトする互換性レイヤを設置
4. **Stripeの請求タイミング**: 店舗追加は即時、削除は期末処理（pro-ration設定）

---

## ✅ 承認後の進め方
このプランは規模が大きいため、**Phase 1（DB基盤）から順次マイグレーションを提示**し、各段階で承認をいただきながら進めます。一度に全てを変更するとロールバックが困難になるためです。

承認いただければ、まず **Phase 1: tenants/locations テーブル新設とデータ移行のマイグレーション** を提示します。