# LINE配信機能 完全実装プラン

## 🎯 最終的に実現すること

1. **設定画面で「LINEテスト送信」ボタン**を押すと、自分のLINEに即座に届く（トークン検証）
2. **顧客が公式LINEを友だち追加 → 電話番号を返信するだけで自動的にDB紐付け**（手動入力ゼロ）
3. **予約完了の瞬間にLINEで通知**（メールより速く、確実に開封される）
4. **「LINE登録済みのお客様にはLINEのみ送信」** ルールで、メール・SMSとの重複を完全防止

---

## 🔔 通知チャネル決定ルール（最重要）

| シーン | LINE登録済み | LINE未登録 |
|---|---|---|
| 予約確認（顧客向け） | LINEのみ ＋ メール（控えとして） | メール |
| サンクス24h後 | LINEのみ | メール |
| 誕生月クーポン | LINEのみ | メール |
| レビュー依頼 | LINEのみ | メール |
| 新規予約アラート（オーナー向け） | メール固定 | メール固定 |

→ お客様には **「同じ内容が2回届く」が絶対に起きない** 設計

---

## 📦 実装内容

### 1. LINEテスト送信機能（Settings画面）
- テスト送信先のLINE UserIDを入力する欄を追加
- 「LINEテスト送信」ボタン → トークンの有効性を即座に確認
- エラー時は「トークンが無効です」「ユーザーIDが間違っています」など具体的に表示

### 2. LINE Webhookエンドポイント（新規Edge Function: `line-webhook`）
- LINE Developers Consoleの「Webhook URL」に設定するURL
- **followイベント**：友だち追加時に「お電話番号をこのトークに送信してください📱」と自動返信
- **messageイベント**：受信したテキストが電話番号形式なら、`customers`テーブルから検索→`line_user_id`を自動セット → 「✅ 連携完了！」と返信
- **署名検証**（X-Line-Signature）でなりすまし防止

### 3. 予約完了時の即時LINE通知
- `create-booking` 関数を改修：予約成功時に顧客がLINE連携済みなら即LINE Push
- オーナーには既存のメール通知（変更なし）

### 4. 重複防止ロジック（process-thank-you-jobs改修）
- 現状の「メールもLINEも両方送る」を「LINE優先・なければメール」に変更
- 1件のジョブにつき1チャネルだけ送信

### 5. 顧客一覧UIに「LINE連携済み」バッジ表示
- 緑のLINEアイコンで一目でわかる

---

## 🛠 技術的な詳細

### 新規ファイル
- `supabase/functions/line-webhook/index.ts` — Webhook受信
- `supabase/functions/_shared/line-push.ts` — LINE送信の共通ユーティリティ

### 改修ファイル
- `supabase/functions/create-booking/index.ts` — 予約完了時のLINE通知追加
- `supabase/functions/process-thank-you-jobs/index.ts` — 重複防止ロジック
- `src/pages/Settings.tsx` — LINEテスト送信ボタン追加
- `src/pages/Customers.tsx` — LINE連携済みバッジ

### LINE Developers Consoleで設定が必要なこと
- Webhook URL: `https://miyedioemkzhetphjzzg.supabase.co/functions/v1/line-webhook`
- Webhook の利用：オン
- 応答メッセージ：オフ（自動返信が二重になるのを防ぐ）
- あいさつメッセージ：オフ（Webhookで送るため）

### セキュリティ
- LINE署名検証（HMAC-SHA256）で偽リクエスト遮断
- チャネルシークレットは `profiles.line_channel_secret` カラムを新設して保存
- すべてのEdge FunctionでCORS設定済み

---

## 🧪 動作確認の流れ

1. 設定画面でテスト送信 → 自分のLINEに届くか確認
2. 自分で友だち追加 → 電話番号返信 → 「連携完了」が返ってくる
3. 自分の予約を入れる → LINEに予約確認が届く（メールは控えとして併送）
4. 顧客一覧で自分にLINEバッジが付いているか確認

---

## 💰 コストへの影響
- LINE Messaging API：月200通まで無料、それ以降は従量課金（フリープラン超過時のみ）
- Edge Function呼び出し：誤差レベル

実装を開始してよろしいでしょうか？
