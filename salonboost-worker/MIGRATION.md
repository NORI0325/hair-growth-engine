# VPS Worker を GitHub管理へ移行する手順

現在 VPS 上で直接ファイル編集してきた `~/salonboost-worker` を、
このリポジトリ（Lovableプロジェクト本体のGitHubリポジトリの `salonboost-worker/` サブディレクトリ）から
`git pull` で更新できる構成に移行します。

---

## 0. 前提

- 現在 VPS で動いている Worker が「正」。壊さないこと。
- このリポジトリ（GitHub）には、最新Worker + Phase1（fetch-staff / fetch-menus）が既に揃っています。
- Lovableプロジェクトを GitHub 接続していない場合は、先に
  Lovable の **Connectors → GitHub → Connect project** で接続してください。
  接続後、リポジトリURLは `https://github.com/<your-org>/<repo-name>.git` の形になります。

> **重要:** 別リポジトリは作りません。Lovableプロジェクト本体のリポジトリの
> `salonboost-worker/` サブディレクトリを使います。これにより、Lovableで編集→GitHub同期→VPSで `git pull` の流れが完結します。

---

## 1. VPS 側：既存をバックアップ

```bash
TS=$(date +%Y%m%d-%H%M%S)

# PM2 を一旦止める（in-flight ジョブが無いことを確認してから）
pm2 stop salonboost-worker

# .env を必ず退避
cp ~/salonboost-worker/.env ~/salonboost-worker.env.bak-${TS}

# フォルダ全体をバックアップ
mv ~/salonboost-worker ~/salonboost-worker-backup-${TS}
```

これで失敗しても `mv ~/salonboost-worker-backup-${TS} ~/salonboost-worker && pm2 start salonboost-worker` で即復旧できます。

---

## 2. VPS 側：GitHub からクローン

リポジトリ全体をクローンし、`salonboost-worker/` サブディレクトリを使います。

```bash
cd ~
git clone https://github.com/<your-org>/<repo-name>.git salonboost-app
ln -s ~/salonboost-app/salonboost-worker ~/salonboost-worker
```

> サブディレクトリだけ取りたい場合は `git sparse-checkout` でも可。シンボリックリンク方式が一番ハマりません。

`.env` を戻します:

```bash
cp ~/salonboost-worker.env.bak-${TS} ~/salonboost-app/salonboost-worker/.env
```

---

## 3. 依存インストール & ビルド

```bash
cd ~/salonboost-worker   # 実体は ~/salonboost-app/salonboost-worker
npm install
npm run build
```

### 今回追加された依存
**無し**。`package.json` の依存は従来と同一です（express / playwright / zod / pino / pino-pretty / dotenv）。

### Phase 1 で追加されたファイル
- `src/salonboard/fetchStaff.ts`
- `src/salonboard/fetchMenus.ts`
- `src/server.ts` に以下のエンドポイントを追加
  - `POST /api/salonboard/fetch-staff`
  - `POST /api/salonboard/fetch-menus`

既存の `create / update / cancel / login / sessionStore` は変更していません。

---

## 4. PM2 再起動

```bash
pm2 restart salonboost-worker --update-env
pm2 save
pm2 logs salonboost-worker --lines 50
```

---

## 5. 動作確認

```bash
# 死活
curl -s http://127.0.0.1:8080/healthz

# fetch-staff (WORKER_API_KEY は .env と同じ)
curl -s -X POST http://127.0.0.1:8080/api/salonboard/fetch-staff \
  -H "Authorization: Bearer $WORKER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"store_id":"<owner_id>","location_id":null}' | head -c 500

# fetch-menus
curl -s -X POST http://127.0.0.1:8080/api/salonboard/fetch-menus \
  -H "Authorization: Bearer $WORKER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"store_id":"<owner_id>","location_id":null}' | head -c 500
```

create/update/cancel は SalonBoost 側 `/integrations` から疎通テストで確認してください。

---

## 6. 今後の更新フロー

```bash
cd ~/salonboost-app
git pull
cd salonboost-worker
npm install            # package.json が変わったときだけ
npm run build
pm2 restart salonboost-worker --update-env
```

---

## .env に必要な環境変数（実値は載せません）

| 変数 | 用途 |
|---|---|
| `PORT` | リッスンポート（既定 8080） |
| `LOG_LEVEL` | `info` 推奨 |
| `WORKER_API_KEY` | SalonBoost 側 `EXTERNAL_WORKER_API_KEY` と同値 |
| `CALLBACK_URL` | `https://<project-ref>.supabase.co/functions/v1/sync-worker-callback` |
| `HEADLESS` | `true` |
| `NAV_TIMEOUT_MS` | `30000` |
| `SALONBOARD_USER_ID` | （任意・フォールバック用。基本は store 別認証情報を使用） |
| `SALONBOARD_PASSWORD` | （任意・フォールバック用） |

> **VPS には `SALONBOARD_ENCRYPTION_KEY` は不要**です。暗号化/復号は Edge Functions 側のみで行います。

---

## ロールバック

問題が出たら即:

```bash
pm2 stop salonboost-worker
rm ~/salonboost-worker
mv ~/salonboost-worker-backup-${TS} ~/salonboost-worker
cd ~/salonboost-worker
pm2 start ecosystem.config.cjs --update-env
```
