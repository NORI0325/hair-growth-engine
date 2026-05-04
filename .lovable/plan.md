# A案：LINEワンタイムリンク承認の実装プラン

## 概要

予約通知LINEに「✅ 承認」「📅 別日時提案」「❌ 却下」の署名付きURLを埋め込み、オーナーがLINEからタップ→ブラウザの専用ページで操作完結できるようにする。

## ユーザー体験

1. お客様がLINEで予約希望 → 仮予約登録
2. オーナーのLINE通知者に通知届く（既存）＋ **3つのアクションリンクが追加**
   ```
   📩 新しい予約リクエスト
   山田花子様 / 11/8(土) 14:00 / カット+カラー
   
   👉 承認: https://saronboost.com/r/a/eyJhbG...
   👉 別日時提案: https://saronboost.com/r/p/eyJhbG...
   👉 却下: https://saronboost.com/r/r/eyJhbG...
   ```
3. オーナーがタップ → ブラウザで専用ページが開く
   - **承認**: 内容確認 → ワンクリックで確定 → 完了画面
   - **提案**: 候補日時入力フォーム → 送信
   - **却下**: 理由選択 → 送信
4. 操作後、お客様のLINEに自動返信（既存フローを再利用）

## セキュリティ設計

- **署名付きトークン (HS256 JWT)**:
  - payload: `{ request_id, action, tenant_id, exp }`
  - 有効期限: **48時間**
  - シークレット: `RESERVATION_ACTION_SECRET`（新規追加）
- **使い捨て**: `reservation_action_tokens` テーブルで `used_at` を記録、再利用防止
- **監査ログ**: 誰が（=トークン発行先のowner_id）/ いつ / どのIP / どのUAで操作したかを記録
- **認証なしでアクセス可能**だが、トークンが正当でなければ何もできない

## 技術詳細

### DB（migration）
```sql
-- 新規シークレット用テーブル
CREATE TABLE reservation_action_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES reservation_requests(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,  -- SHA-256(token)
  action text NOT NULL,             -- 'approve' | 'propose' | 'reject'
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  used_ip text,
  used_ua text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_rat_request ON reservation_action_tokens(request_id);
ALTER TABLE reservation_action_tokens ENABLE ROW LEVEL SECURITY;
-- RLSは「アクセス禁止」のみ（Edge Function経由のみ）
```

### Edge Functions（新規 / 変更）
1. **`reservation-action-resolve`** (新規・public, no JWT)
   - GET `?token=xxx` → トークン検証して `{ request_id, action, request_data }` を返す
   - 表示用情報のみ返す（操作はしない）
2. **`reservation-action-execute`** (新規・public, no JWT)
   - POST `{ token, payload }` → トークン消費 + 既存の `reservation-approve` ロジックを内部呼び出し
3. **`line-webhook`** または通知生成箇所 (変更)
   - 仮予約発生時、`reservation_action_tokens` に3件INSERT＋通知文に短縮URL付与

### Frontend（新規ページ）
- **`/r/a/:token`** (Approve確認ページ)
- **`/r/p/:token`** (Propose 提案フォーム)
- **`/r/r/:token`** (Reject 理由選択)
- 認証不要、SEO除外（`<meta name="robots" content="noindex">`）
- デザイン: 既存の和モダン・ゴールド基調に合わせる

### Secrets
- `RESERVATION_ACTION_SECRET`（新規・自動生成して保存）

## ロールアウト

- 既存の `/reservations` 画面は引き続き使用可能（並行運用）
- LINEからの操作が完了すると `/reservations` 画面にも即時反映

## 想定工数

- DB migration: 1 ファイル
- 新規 Edge Function: 2 つ
- 既存 Edge Function 改修: 1 つ（line-webhook 通知文）
- 新規 React ページ: 1 ファイル（3ルートを内部分岐）

承認いただければ、まず `RESERVATION_ACTION_SECRET` の追加からスタートします。
