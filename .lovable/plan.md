
# サロン設定画面 全面刷新プラン

## ゴール
「説明と実装の食い違い」を完全解消し、UIを再構成、オーナーが本当に必要な設定を全部編集できる「日本一の設定画面」へ。

---

## Phase A — 整合性修復（虚偽表示の撲滅）

### A-1. 離脱客ステップ：JSONB方式で「4段階デフォルト＋自由カスタマイズ」併用
- `profiles` に `reactivation_stages JSONB` を追加
  - デフォルト値：
    ```json
    [
      {"days": 30,  "discount_percent": 10, "label": "お久しぶり"},
      {"days": 60,  "discount_percent": 15, "label": "そろそろ"},
      {"days": 90,  "discount_percent": 20, "label": "おかえりなさい"},
      {"days": 150, "discount_percent": 30, "label": "特別ご招待"}
    ]
    ```
- `create_reactivation_jobs` を JSONB配列ループ方式に書き換え
  - 各ステージの `±3日`ウィンドウでヒットした顧客にジョブ生成
  - `payload` に `stage_index / discount_percent / label` を含める
- `process-thank-you-jobs` の `reactivation` テンプレ送信時に `payload.discount_percent` を反映
- `reactivation.tsx` テンプレを `discount_percent` props 受け取り対応に
- **設定変更時の安全装置**：
  - 段階を削除すると、該当する未送信 `reactivation` ジョブを自動キャンセル
  - 「変更を保存」前にプレビュー（「次回実行で◯名対象、合計◯通配信されます」）

### A-2. 説明文を実装に合わせて修正
- 「90〜120日…20%OFF」→ オーナー設定値を**動的に表示**（例：「30/60/90/150日後に10/15/20/30%OFFで配信」）
- リマインドの「{時}時に配信」→「**当日のバッチ実行時刻（10〜20時の間）**に配信」と正直に表記
  - もしくは `process-thank-you-jobs` を `reminder_hour` 厳密化（jstHour === reminder_hour のときだけ送信）に修正

### A-3. 保存ボタン1個に統合
- 「予約ルールを保存」ボタンを撤去 → 一番下の「設定を保存する」のみに

---

## Phase B — UX刷新（タブ式再構成）

### B-1. 5タブ構成
```
🏪 店舗基本情報    │ サロン名 / 営業時間 / 予約ルール
📨 お客様への配信  │ リマインド / サンクス / 離脱復活 / 誕生日 / 自動応答
🔔 オーナー通知    │ 通知メール / テスト送信
🔗 外部連携        │ LINE / Google / ホットペッパー等
🛠️ 開発者ツール    │ テストモード / データ削除（隔離）
```
- shadcn `Tabs` で実装、URLハッシュ連動（`#hours` で直接ジャンプ可）

### B-2. デザイン体系を統一
- 全セクションを「罫線型」に揃える（外部予約サイト連携のカード型を罫線型に）
- セクション見出しに `eyebrow + display + 説明文` の3層構造を統一

### B-3. デンジャラスゾーンを隔離
- テストモード・テストデータ削除を独立タブ（🛠️ 開発者ツール）へ
- 赤枠＋警告アイコンで誤操作防止

---

## Phase C — プロ級機能の追加

### C-1. 誕生日クーポン設定UI
- `profiles.birthday_enabled` (boolean) と `birthday_discount_percent` (int) を追加
- ON/OFFトグルと割引率（10/20/30%）の選択UI
- `create_birthday_jobs_for_month` を `birthday_enabled = false` ならスキップに改修

### C-2. サンクスメール送信日数のカスタマイズ
- `profiles.thank_you_delay_days` (int, default=1) を追加
- `schedule_thank_you_on_complete` がこの値を参照
- UIで「来店◯日後に送信」を選択可能（1〜7日）

### C-3. アフターケア・次回提案日数のカスタマイズ
- `profiles.aftercare_delay_days` (default=7)
- メニュー別 `next_suggestion_days_*`（カラー/カット/その他）
- 上級者向けセクションとして折りたたみ表示

### C-4. 「次に何が起きるか」プレビュー
- 設定保存前に「この設定で次の30日間に配信される予定」を可視化
  - 「明日 19:00 — リマインド × 5件」
  - 「3日後 10:00 — 離脱復活ステージ1 × 12件」
- オーナーが「うっかり全員に送信」を防げる

### C-5. 設定の変更履歴（軽量版）
- `profiles_audit` テーブルに保存時のスナップショットを残す
- 「2日前にreminder_hourを18時→19時に変更」が見える

---

## 技術的な詳細（実装順）

### Step 1: マイグレーション
```sql
-- 1. JSONB列追加
ALTER TABLE profiles ADD COLUMN reactivation_stages JSONB DEFAULT 
  '[{"days":30,"discount_percent":10,"label":"お久しぶり"},
    {"days":60,"discount_percent":15,"label":"そろそろ"},
    {"days":90,"discount_percent":20,"label":"おかえりなさい"},
    {"days":150,"discount_percent":30,"label":"特別ご招待"}]'::jsonb;

ALTER TABLE profiles ADD COLUMN birthday_enabled BOOLEAN DEFAULT true;
ALTER TABLE profiles ADD COLUMN birthday_discount_percent INTEGER DEFAULT 30;
ALTER TABLE profiles ADD COLUMN thank_you_delay_days INTEGER DEFAULT 1;
ALTER TABLE profiles ADD COLUMN aftercare_delay_days INTEGER DEFAULT 7;

-- 2. 既存ユーザーにデフォルト値を埋める
UPDATE profiles SET reactivation_stages = '[...]'::jsonb WHERE reactivation_stages IS NULL;

-- 3. create_reactivation_jobs を JSONB ループ版に書き換え
-- 4. 設定変更時の未送信ジョブキャンセル関数を追加
```

### Step 2: テンプレート改修
- `reactivation.tsx` を props 動的化
- `birthday.tsx` を割引率動的化

### Step 3: process-thank-you-jobs 改修
- `payload.discount_percent` `payload.label` を反映してテンプレ送信

### Step 4: Settings.tsx 全面書き換え
- Tabs構造に再構成
- `ReactivationStagesEditor` コンポーネント新規作成（行追加/削除/並び替え）
- プレビューパネル `NextEventsPreview` 新規作成

### Step 5: 動作確認
- テストモードONにして「離脱客を今すぐ抽出」→ JSONB通りのジョブが入るか
- 段階を3個に減らして再保存 → 削除ステージのジョブが自動キャンセルされるか

---

## 想定作業時間
- Phase A: 約45分（DB関数書き換え＋テンプレ改修が肝）
- Phase B: 約45分（Tabs再構成＋デザイン統一）
- Phase C: 約60分（4機能の追加＋プレビュー）
- **合計：約2.5時間**

## リスクと対策
- **リスク1**：JSONB方式に変えた瞬間、既存の進行中ジョブ（payload.stage=1〜4で動いてる）が止まる
  - 対策：移行時に旧payload.stageを新しい discount_percent にマッピングするバックフィル
- **リスク2**：オーナーが段階を0個にしてしまう
  - 対策：UI側で最低1段階の保証＋保存時バリデーション
- **リスク3**：プレビュー機能が重い
  - 対策：最初の30件だけ表示、それ以降は「他に◯件」とサマリ

---

承認いただければこの順番で実装します。
