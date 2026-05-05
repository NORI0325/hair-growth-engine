# salonboost-worker

サロンボードを Playwright で自動操作する外部ワーカー。
ConoHa VPS（Ubuntu 22.04 / 推奨2GB以上）で動かす想定。

## エンドポイント

- `GET /healthz` — 死活監視
- `POST /api/sync-job` — Bearer認証 (`Authorization: Bearer <WORKER_API_KEY>`)

リクエスト例:
```json
{
  "job_id": "uuid",
  "target_channel": "salonboard",
  "job_type": "create",  // create | update | cancel
  "reservation": { ... },
  "async_callback": false
}
```

`async_callback: true` の場合、即 `202 Accepted` を返し、完了後 `CALLBACK_URL` (= 本アプリの `/functions/v1/sync-worker-callback`) にPOSTします。

## ConoHa VPS セットアップ手順

### 1. Ubuntu 22.04 で初期セットアップ
```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install curl git build-essential ufw nginx certbot python3-certbot-nginx

# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt -y install nodejs

# PM2
sudo npm i -g pm2
```

### 2. ファイアウォール
```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

### 3. 本リポジトリ配置 & ビルド
```bash
sudo mkdir -p /opt && sudo chown $USER /opt
cd /opt
git clone <this-repo>.git salonboost-worker
cd salonboost-worker
cp .env.example .env
nano .env   # WORKER_API_KEY / SALONBOARD_USER_ID / SALONBOARD_PASSWORD などを設定

npm install
# Playwright 依存ライブラリ
sudo npx playwright install-deps chromium
npm run build
```

### 4. PM2 で常駐
```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd   # 表示されたコマンドを実行
```

### 5. Nginx + Let's Encrypt（HTTPS化）
`/etc/nginx/sites-available/worker.conf`:
```
server {
  listen 80;
  server_name worker.your-domain.com;

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 120s;
  }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/worker.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d worker.your-domain.com
```

### 6. SalonBoost(Lovable) 側の設定
**バックエンド設定** に以下のシークレットを登録：
- `EXTERNAL_WORKER_API_URL` = `https://worker.your-domain.com`
- `EXTERNAL_WORKER_API_KEY` = ワーカーの `.env` と同じ値

## 動作確認

```bash
# ローカルから叩いてみる
curl -X POST https://worker.your-domain.com/api/sync-job \
  -H "Authorization: Bearer $WORKER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "job_id": "test-1",
    "target_channel": "salonboard",
    "job_type": "create",
    "reservation": {
      "date":"20260601","time":"1000","stylistId":"0000000000","rsvTerm":"60",
      "nmSei":"テスト","nmMei":"太郎","nmSeiKana":"テスト","nmMeiKana":"タロウ","tel":"09000000000"
    }
  }'
```

## 運用上の注意

- 画像認証 / ログイン失敗 / セッション切れ を検知したら自動停止し `error_type` を返します
- サロンボードの画面構造が変わると `external_site_changed` を返すので、HTML を再取得してセレクタ更新が必要です
- Chromium は1回起動して使い回し（`browser.ts`）。コンテキストはジョブごとに使い捨て
- メモリ使用量が1.2GB超でPM2が自動再起動します
