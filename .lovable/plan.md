## 現状調査結果

### 1. LINE基本連携 — ほぼ実装済み
| 項目 | 状態 | 備考 |
|---|---|---|
| Webhook処理（`line-webhook` 1255行） | 実装済 | follow / unfollow / message / postback すべて分岐あり |
| 電話番号登録フロー | 実装済 | `find_customer_by_normalized_phone` RPC（先日整備）で既存顧客マッチ |
| `customers.line_user_id` 紐付け | 実装済 | 4状態（success / link_existing / needs_review / failed）対応 |
| `line_registration_logs` | 実装済 | 4状態すべて記録 |
| `line_inbound_messages` | 実装済 | 自由テキスト全件保存。`intent / urgency / handled / suggested_action` 列あり |
| `line_message_log` | 実装済 | 送信成否・error 記録 |
| RLS / service role | 実装済 | service_role で書込、テナントメンバーで読取 |

### 2. リッチメニュー — 基本3ボタンのみ
- `line-setup-rich-menu`：800x270/2500x843 単一画像、3ボタン（予約URI / 「特典を見る」message / 「お問合せ」message）。`/user/all/richmenu` で**全ユーザー一律**設定。
- **未実装**：状態別alias、`linkRichMenuToUser`、`line_user_id↔rich_menu_id` 管理テーブル、postback action。

### 3. 問い合わせ対応 — テキスト案内のみ
- 「お問合せ」押下時：単一テキスト返信のみ。**クイックリプライなし**。
- 自由テキスト：`line_inbound_messages` に保存 →`ai-classify-inbound` がAI分類（`booking_request / reschedule / cancel / question / complaint / thanks / chitchat / other` の8値）。
- `classifyMessageKind`：`urgent / booking / question / casual` の4種（返信遅延の長さ調整用）。
- 管理画面 `Inbox` / `InboundLogs` で `intent / urgency / handled` 表示済。
- `critical / high` 時にオーナー宛メール通知済。
- **未実装**：`booking_change / price / parking / hours / staff_consult / style_consult` の細分類、ユーザー明示intent優先ロジック。

### 4. 予約リマインド・お礼 — DB triggerで自動化済
- `bookings` triggers：
  - `trg_schedule_reminder`（INSERT）→ `schedule_reminder_on_booking()` が **前日19時 JST に reminder enqueue**、`booking_id+job_type` 重複防止＋`scheduled_jobs_dedupe_pending` UNIQUE併用、`ON CONFLICT DO NOTHING`
  - `trg_schedule_thank_you`（UPDATE→completed）→ thank_you / aftercare / next_suggestion / review_request / VIP昇格 を一括 enqueue（580行超の複雑実装）
  - `trg_cancel_reminder`、`trg_activate_customer_on_booking`、`trg_award_points_on_complete` も稼働中
- 実績 enqueue 数：welcome 51 / reminder 20 / thank_you 2 / reactivation 2 / aftercare 1 / next_suggestion 1
- `process-thank-you-jobs`：12種すべて捌く。LINE優先、なければEmail。`opt_out_automation / quiet_until / frequency_cap_*` 尊重済。
- **結論：Phase 1-7/1-8 の trigger 整備は不要**（既に網羅的に実装済）。

### 5. セグメント配信 — 高機能
- `bulk-broadcast` / `broadcast-preview` 稼働中。
- `_shared/segment-filter.ts` 対応条件：`gender / age_group / days_since / vip_only / visit_count / total_spent / staff_ids / birthday_months / menu_keyword（部分一致）/ tag_ids_any / exclude_tag_ids / has_email / has_phone / has_line / recommended_cycle_days±tolerance / 直近予約除外`
- `frequency_cap_days / frequency_cap_per_month / quiet_until / opt_out_automation` すべて尊重。
- **未実装**：「顧客ランク」「失客リスク」「来店周期超過」「メニュータグ」を直接指す名前付き条件。ただし `vip_only` / `days_since_min/max` / `menu_keyword` 等の組合せで近似可能。

### 6. 顧客ランク — DB列なし、フロント計算のみ
- DB：`customers.rank` 等の列は**存在しない**。
- フロント：`src/lib/vip.ts` の `calculateVipTier(visits, spent)` が唯一の定義。
  - 4段階：`bronze / silver / gold / platinum`
  - 閾値：`platinum ≥ ¥300k or 30回` / `gold ≥ ¥150k or 15回` / `silver ≥ ¥50k or 5回` / `bronze` その他
- DB関数 `calculate_vip_tier` も存在（types.ts に登録あり）。
- 自動計算（visits/spent から純関数）。手動上書き不可。
- **「一見/ライト/失客予備軍/失客済み」概念は未定義**。
- セグメントには `vip_only`（gold以上相当）しか露出していない。
- リッチメニュー切替・jobs作成条件には未活用。

### 7. 年齢・性別 — 完備
- `customers.gender`（USER-DEFINED enum）/ `birthday`（date）あり。
- セグメント・テンプレートで `genders[] / age_groups[]` が利用可能（`teens/20s/30s/40s/50s/60s+`）。

### 8. メニュー履歴 — 自由テキストのみ
- `chart_treatments.menu_summary`（自由テキスト）が唯一の履歴。
- `bookings.menus`（配列）/ `menu` あり。
- カット/カラー/パーマ/縮毛矯正/トリートメントの**正規化タグ列は無し**。
- セグメントは `menu_keyword` の部分一致のみ。

### 既存の `customer_tags`（自由タグ） は流用可。

---

## まとめ表

| 要望 | 状態 |
|---|---|
| LINE基本連携・電話登録・ログ | ✅ 実装済 |
| 予約 reminder / thank_you 自動enqueue | ✅ 実装済（DB trigger） |
| `process-thank-you-jobs` でLINE優先送信 | ✅ 実装済 |
| セグメント配信（年齢/性別/VIP/タグ/周期） | ✅ 実装済 |
| 顧客ランク（4段階tier） | 🟡 一部（フロント関数のみ、DB列・LINE活用なし） |
| 問い合わせ7分類クイックリプライ | ❌ 未実装 |
| 細分類 intent 値 | ❌ 未実装 |
| カテゴリ別一次返信＋スタッフ通知強化 | ❌ 未実装 |
| ランク別/状態別 リッチメニュー | ❌ 未実装（Phase 3） |
| メニュータグ正規化 | ❌ 未実装（Phase 2-5） |

---

## Phase 1 実装計画

ご指示通り、Phase 1 は以下4点に絞ります。**reminder / thank_you の trigger は既に完備のため新規実装ナシ**（動作確認のみ）。

### 1-A. クイックリプライ7分類（webhook修正のみ）

**ファイル**：`supabase/functions/line-webhook/index.ts`

- `text === "お問合せ"` 分岐を、テキスト返信＋ **quickReply（postback 8択）** に差し替え：
  ```
  予約変更 / キャンセル / 料金確認 / 駐車場 / 営業時間 / 担当者相談 / 髪型相談 / その他
  ```
  postback data: `inq:booking_change` 等。
- `event.type === "postback"` ハンドラに `inq:*` 分岐を追加：
  1. `line_inbound_messages` に `intent / urgency / message_text="(quickreply選択: ラベル)" / ai_processed=true / handled=false / raw_event_id=postback.id` を保存
  2. カテゴリ別一次返信（reply）を返す
  3. urgency 設定：`cancel=high` / `booking_change/staff_consult=high` / その他 normal
  4. `cancel / booking_change / staff_consult / style_consult / other` はオーナーへメール通知（既存 `send-transactional-email` 流用、`ai-classify-inbound` の通知ロジック切出し）

### 1-B. AI分類との優先順位

- ユーザーが quickReply で intent を選んだ場合は `ai_processed=true` で確定保存し `ai-classify-inbound` を**呼ばない**。
- 自由テキストフローは現状維持。

### 1-C. 一次返信テンプレート（DBに登録）

`customer_message_templates` に `kind = inquiry_*` の8件をシード。
- ただし**ハードコードのフォールバック**を webhook 側に持たせる（テンプレート未登録でも動くように）。
- 管理画面でオーナーがテキストを上書き可能（既存テンプレート管理画面が使える）。

→ 初期値 INSERT は migration ではなく `supabase--insert` 用シードSQL を別途実行。

### 1-D. reminder / thank_you 自動enqueue 動作確認

- migration 不要。
- `scheduled_jobs` の現状件数と過去 trigger 動作ログを口頭で確認するのみ。
- LINE優先送信（line_user_id あり時 LINE、なければ Email）は `process-thank-you-jobs` で既に正しく動作中。

---

## 変更ファイル一覧（Phase 1）

| 種別 | ファイル | 変更内容 |
|---|---|---|
| Edge Function 編集 | `supabase/functions/line-webhook/index.ts` | お問合せ分岐をquickReplyに差替＋postback `inq:*` ハンドラ追加 |
| データシード | `customer_message_templates` に kind=inquiry_* を8件 INSERT | `supabase--insert` 経由 |
| DBマイグレーション | **不要** | テーブル/列追加なし |
| 管理画面変更 | **任意（後回し可）** | `Inbox` の intent 表示に新7値の日本語ラベル対応（既に汎用表示なら無修正でも可） |

---

## Phase 2 以降のメモ（着手しない）

- 顧客ランクをDB列化するか、`vip.ts` の現行ロジックを `segment-filter` に組み込んで「rank in [...]」条件を新設するか方針決定が必要。**推奨：後者**（DB側に `customer_rank_view` を作り、segment-filter から JOIN）。
- 「一見 / 2回目未満 / ライト / 失客予備軍 / 失客済み」を加えた 7段階に再定義する案を Phase 2 着手時に提案。
- メニュータグ正規化は `chart_treatments` への `menu_tags text[]` 追加＋ `menu_summary` からの自動分類トリガで対応予定。

---

ご承認いただければ、Phase 1 の実装（webhook修正＋テンプレシード）に着手します。