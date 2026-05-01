# Phase 1：SaaS化 完全実装計画

このアプリを「自社専用ツール」から「全国のサロンが使える月額SaaS」に進化させる、最初の本格実装フェーズです。

---

## 🎯 ゴール

新規サロンオーナーがランディングページから登録 → 2ヶ月無料で全機能利用 → 自動またはメール案内で月額¥9,800の課金開始 → スタッフを招待してチームで運用、までを完全自動化する。

あなた自身（arunehair）は1テナントとして使い続けながら、マルチテナント化の最初のリアルユーザーになる。

---

## 📋 実装内容

### 1. マルチテナント基盤の整備

**サブスクリプション管理テーブル新設**
`subscriptions` テーブルを作り、各オーナーの契約状態を管理する。
- `owner_id`、`status`（trialing / active / past_due / canceled / paused）
- `trial_ends_at`、`current_period_end`
- `stripe_customer_id`、`stripe_subscription_id`
- `plan`（最初は "standard" のみ）

`status` を見て、画面とAPIで機能制限をかける。

**トライアル自動付与**
新規ユーザー登録時のトリガー（既存 `handle_new_user`）を拡張し、`subscriptions` レコードを自動作成する。`trial_ends_at = now() + 60 days` で開始。

**グローバル状態の整理**
`email_send_state`（id=1の単一行）はメール配信のレート制御用なので、SaaS化後もグローバル共有でOK。ただしテナント別の送信上限カウンタを別途追加する：
- 新テーブル `tenant_usage_counters`（owner_id, period_start, emails_sent, sms_sent, line_sent）
- 月次でリセット、超過時は `process-thank-you-jobs` 等が拒否

**読み取り専用モード（"locked"）**
未払い・キャンセル後の閲覧専用モードを実装。RLSは変えず、エッジ関数とフロント側で書き込み系操作をブロック。データは消さない（再開時に即復旧）。

---

### 2. 3階層スタッフ権限

既存の `user_roles` テーブル + `app_role` enum を拡張する。

**役割定義**
- `owner`：契約者本人。全機能 + 課金 + メンバー招待 + 削除
- `manager`：店長クラス。設定変更・売上分析・全テンプレ編集は可、課金とメンバー削除は不可
- `staff`：日常業務のみ。予約閲覧/作成、自分担当の顧客閲覧、メッセージ送信のみ

**新テーブル `tenant_members`**
- `tenant_id`（= オーナーのowner_id）、`user_id`、`role`、`invited_at`、`accepted_at`
- これがあると「同じサロンの複数アカウント」が成立する

**RLSの大幅改修**
今までは `auth.uid() = owner_id` 一発で済んでいたが、これからは「自分が所属するテナントのデータか」で判定する必要がある。SECURITY DEFINER関数 `is_tenant_member(_tenant_id, _user_id)` を作り、全テーブルのRLSを書き換える。

**権限チェック関数**
- `has_tenant_role(_tenant_id, _user_id, _role)` で「○○できるか」を判定
- フロント側は `useTenantRole()` フックで現在のロールを取得し、ボタン/タブを出し分け

**招待フロー**
オーナーがメンバーのメールアドレスを入力 → 招待メール送信 → 受信者が登録/ログイン → 自動でテナントに参加。

---

### 3. セルフサーブ登録

**`Auth.tsx` の刷新**
現在のログイン専用画面を「ログイン / 新規登録」のタブ式に変更。

**新規登録フォーム**
- メールアドレス、パスワード、サロン名、オーナー氏名
- Google認証も併設
- 登録直後に確認メール、確認後にダッシュボードへ
- メール認証は有効化（auto_confirm_email = false）

**初回ログイン後のオンボーディング**
新規オーナーは強制的に5ステップウィザードに誘導：
1. サロン基本情報（営業時間・住所）
2. メニュー登録（最低3つ）
3. スタッフ登録
4. LINE連携（スキップ可、後でいつでも）
5. 公開予約URLの確認とコピー

完了率を `profiles.onboarding_progress`（jsonb）で記録、ダッシュボード上部に進捗バー。

---

### 4. Stripe決済（Lovable built-in）

**enable_stripe_payments で接続**
Lovableの組み込みStripeを有効化。テスト環境が即座に立ち上がるので、本番運用前に十分テストできる。

**プランは1つ：standard ¥9,800/月**
Stripe側にProductとPriceを1つだけ作成。シンプル。

**ハイブリッド・トライアル動線**
- 登録時：「クレカ登録」ボタン（任意）と「あとで登録」ボタンの両方を提示
- クレカ登録済み：トライアル終了時に自動課金（Stripe trial機能を使用）
- クレカ未登録：終了7日前に「もうすぐ無料期間が終わります」メール、終了時に「locked」状態に移行 → 課金画面で再開可能

**Webhook処理**
`stripe-webhook` エッジ関数を作成し、`invoice.paid`、`customer.subscription.deleted`、`invoice.payment_failed` を処理して `subscriptions.status` を更新。

**支払い失敗時のリカバリー**
- 1回目失敗：`past_due` 状態、警告メール
- 3日後再試行 → ダメなら `locked`
- 30日経過で `canceled`、データは保持（90日後に削除予告メール）

---

### 5. 管理者ダッシュボード（あなた専用）

**新ページ `/admin`**
あなた（特定のuser_idまたは新role `super_admin`）のみアクセス可能。
- 全テナント一覧（サロン名、契約状態、MRR、最終ログイン、メール送信数）
- 月次MRR推移グラフ
- 解約率、トライアル→有料転換率
- 個別テナントの「成り代わりログイン」（サポート用）

これがないと「誰が困っているか」が見えず、初期サポートで詰みます。

---

### 6. 法務まわりの最低限

**新ページ**
- `/terms`（利用規約）
- `/privacy`（プライバシーポリシー）
- `/tokushoho`（特定商取引法に基づく表記）

雛形を生成して配置。実際の内容（事業者名・住所等）はあなたが後で埋める前提。

新規登録フォームに「利用規約に同意」チェックボックス必須。

---

## 🔧 技術詳細

### データベース変更（マイグレーション1本）

```sql
-- サブスクリプション
CREATE TABLE subscriptions (
  owner_id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'trialing',
  plan TEXT NOT NULL DEFAULT 'standard',
  trial_ends_at TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  ...
);

-- テナントメンバー
CREATE TABLE tenant_members (
  tenant_id UUID NOT NULL,  -- オーナーのID
  user_id UUID NOT NULL,
  role app_role NOT NULL,
  invited_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, user_id)
);

-- 招待トークン
CREATE TABLE tenant_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  email TEXT NOT NULL,
  role app_role NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  accepted_at TIMESTAMPTZ
);

-- 使用量カウンター
CREATE TABLE tenant_usage_counters (
  owner_id UUID NOT NULL,
  period_start DATE NOT NULL,
  emails_sent INT DEFAULT 0,
  sms_sent INT DEFAULT 0,
  line_sent INT DEFAULT 0,
  PRIMARY KEY (owner_id, period_start)
);

-- app_role enum 拡張
ALTER TYPE app_role ADD VALUE 'manager';
ALTER TYPE app_role ADD VALUE 'staff';
ALTER TYPE app_role ADD VALUE 'super_admin';

-- 既存テーブル群のRLSを is_tenant_member() ベースに書き換え
```

### RLS書き換え対象テーブル
`bookings`, `customers`, `coupons`, `incentives`, `staff`, `staff_schedules`, `staff_time_off`, `salon_hours`, `menu_items`, `customer_message_templates`, `template_overrides`, `line_templates`, `campaigns`, `customer_ai_insights`, `line_inbound_messages`, `line_pending_friends` — 全部 `is_tenant_member(owner_id, auth.uid())` ベースに変更。

### 新規エッジ関数
- `stripe-webhook`：Stripe イベント受信
- `create-checkout-session`：契約開始用Checkout
- `create-portal-session`：契約管理画面へのリダイレクト
- `accept-tenant-invitation`：招待トークン検証 + メンバー追加
- `cron-trial-reminder`：トライアル終了7日前/1日前通知
- `cron-trial-expiry`：終了時のlocked移行

### 新規フロントページ
- `/landing`（製品紹介LP、SEO対応）
- `/signup`（新規登録）
- `/onboarding`（5ステップウィザード）
- `/billing`（契約・支払い管理）
- `/team`（メンバー招待・管理）
- `/admin`（あなた専用ダッシュボード）
- `/invite/:token`（招待受諾）
- `/terms`, `/privacy`, `/tokushoho`

### 新規フックとガード
- `useTenant()`：現在のテナントID（オーナーIDと同じか、所属先）
- `useTenantRole()`：自分のロール
- `useSubscription()`：契約状態
- `<RequireRole role="manager">`：権限ベースのコンポーネントガード
- `<RequireActiveSubscription>`：未払い時はlocked画面へ

---

## 📦 実装順序（このプランの中での進行順）

1. **マイグレーション**（DB全部いっぺんに） — 既存データ無傷で `tenant_members` に owner_id を自己参照で投入、RLS切り替え
2. **types.ts 更新待ち + フック群作成** — useTenant, useTenantRole, useSubscription
3. **権限ガード実装 + 既存ページの読み取りロール対応** — Settings, Templates, Performance はmanager以上、Billing/Teamはownerのみ
4. **新規登録 + オンボーディング** — Auth刷新、Wizard追加
5. **Stripe接続 + Checkout/Webhook/Portal**
6. **トライアル監視Cron + Locked画面**
7. **チーム招待フロー**
8. **管理者ダッシュボード `/admin`**
9. **ランディング + 法務ページ**
10. **既存データ移行確認**（あなたのデータが全部見えること、機能が動くこと）

---

## ⚠️ リスクと対策

**リスク1：RLS書き換えで既存データが見えなくなる**
→ マイグレーション内でまず `tenant_members` に既存全オーナーを `owner` ロールで自己登録 → 新RLS適用、の順で実行。テスト的に1テーブルずつ切り替えるのではなく、トランザクションで全部一気にやる。

**リスク2：Stripe Webhook の署名検証ミスで不正リクエスト受付**
→ `STRIPE_WEBHOOK_SECRET` を必須化、署名検証失敗時は400で即返却。

**リスク3：あなた自身がlocked状態になる**
→ あなたのowner_idは `subscriptions.status = 'active'` で永続フリー、または `super_admin` ロール持ちは課金チェックをスキップする例外を入れる。

**リスク4：招待メールがスパム判定**
→ 既存の `send-transactional-email` 経由で Resend から送る。専用テンプレートを `_shared/transactional-email-templates/team-invitation.tsx` で作成。

---

## 📝 このフェーズで「やらないこと」（次フェーズ送り）

- アフィリエイト・紹介機能
- 公開ランディングのSEO最適化深堀り（最低限のページだけ作る）
- LINE OAuth による Channel Token 自動取得（手入力のまま）
- 解約防止アンケート
- カスタムドメイン対応（各サロンが独自ドメインで予約ページを持つ）
- 2要素認証

これらは Phase 2 で対応。今は「セルフサーブで売れる最小構成」に集中。

---

## 💰 想定コスト構造（あなた側）

- Lovable Cloud：使用量ベース、現状の延長
- Stripe：3.6% + ¥0/件
- Resend：3,000通まで無料、以降従量
- 1契約あたりのあなたの粗利：¥9,800 - 約¥500（インフラ） = **約¥9,300/契約/月**

50契約で月¥465,000、200契約で月¥1,860,000。十分な事業規模になります。

---

承認いただければ、まず**マイグレーション1本**から着手します（既存データを壊さない設計で慎重に）。それをユーザーに承認いただいた後、コード側の実装を一気に進めます。