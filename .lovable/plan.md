
## 概要
SALON BOARDメールのISO-2022-JPデコード対応、AIハルシネーション防止、賢い重複処理（同一予約は更新／別予約は別IDで作成）、誤登録された既存予約の修復、そして予約一覧の受信時刻順ソートを実装します。

## 1. メール本文の文字コード自動判定とデコード（最重要）
`inbound-reservation-email/index.ts` に以下を実装：
- Resend Inbound APIから取得した本文/Content-Typeヘッダーから charset を検出
- `iconv-lite` 相当（Deno: `https://esm.sh/iconv-lite`）で **ISO-2022-JP / Shift_JIS / EUC-JP → UTF-8** に変換
- raw bodyに `\x1B$B`（ISO-2022-JP escape sequence）が含まれる場合は強制デコード
- デコード結果に化け文字（U+FFFDや制御文字過多）が残るならAI呼び出しをスキップして `failed: encoding_error` を記録

## 2. AIハルシネーション防止
- AIプロンプトに「本文に明示的に書かれていない情報は必ずnullを返す」ルールを追記
- 抽出後の検証：`customer_name` が本文（デコード済み）に部分一致しない場合は `extracted.customer_name = null` にして登録名を「お客様」にフォールバック
- 信頼度フラグ `extraction_confidence: high|low` を AIに返させ、low の場合はステータス `needs_review` で記録（自動登録しない）

## 3. 賢い重複処理ロジックの再設計
現在: `external_reservation_id` 一致で即duplicate
新規:
```
既存予約あり?
├─ Yes: 顧客名が一致 or 既存名が "お客様"/空 → 更新（顧客差し替え含む）
│       不一致（明らかに別人）→ external_reservation_id に suffix(`-v2`) を付けて新規作成 + needs_review
└─ No: 通常作成
```
特に「既存予約の顧客が誤登録（高橋 → 実は松藤）」のケースでは、新しい正しいデータで上書きできるようにする。

## 4. 過去の誤登録データの修復ワンショット
`reprocess-inbound-logs` を拡張：
- 過去の `created` ログでも、後から `duplicate` で来た同じexternal_idのログがあり、かつデコード済み版の方が情報量が多い場合に、bookingsを更新
- 今回の `BE88531128`（高橋→松藤）は手動修正用SQLを発行

## 5. 予約一覧に「受信日時」表示と並び替え
`src/pages/Bookings.tsx`：
- テーブルに「登録日時」列を追加（`created_at` 表示）
- ソート可能に：予約日時 / 登録日時（降順がデフォルト）
- 外部取込（`external_source != 'manual'`）には小さなバッジを表示

## 6. 受信ログ画面（`InboundLogs.tsx`）の強化
- `needs_review` ステータスを追加表示
- 「この予約を修正」ボタン → 既存bookingにマージ

---

## 技術詳細
- iconv: `import iconv from "https://esm.sh/iconv-lite@0.6.3"` または `TextDecoder("iso-2022-jp")` （DenoはICU入り）
- DenoのTextDecoderは `iso-2022-jp`, `shift_jis`, `euc-jp` をネイティブサポート → 外部依存不要
- Resend Inbound APIレスポンスの `headers` から `Content-Type: text/plain; charset=ISO-2022-JP` を取得
- デコード失敗検出: `decoded.includes("\uFFFD")` の数が一定以上なら失敗扱い

## 影響範囲
- Edge Function: `inbound-reservation-email`, `reprocess-inbound-logs`
- Frontend: `src/pages/Bookings.tsx`, `src/pages/InboundLogs.tsx`
- DB migration: `external_reservation_logs.status` に `needs_review` 値を許可（CHECKがあれば緩和）
- 既存データ: `BE88531128` の bookings レコードを松藤様データに更新（同意のうえ実行）

## 実装順
1. ISO-2022-JPデコード実装＋デプロイ（最優先・即効）
2. ハルシネーション防止プロンプト
3. 重複ロジック再設計
4. 過去データ修復スクリプト + 該当予約手動修正
5. 予約一覧UI改善
