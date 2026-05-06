// 本アプリ(SalonBoost) と通信して、店舗別の認証情報・保存セッションを取得/保存
const baseUrl = (process.env.CALLBACK_URL || "").replace(/\/sync-worker-callback\/?$/, "");
const apiKey = process.env.WORKER_API_KEY!;

export interface SessionInfo {
  login_id: string | null;
  password: string | null;
  storage_state: any | null;
}

export async function fetchSession(owner_id: string, location_id: string | null): Promise<SessionInfo> {
  if (!baseUrl) {
    // フォールバック: 環境変数のシングル認証情報
    return {
      login_id: process.env.SALONBOARD_USER_ID || null,
      password: process.env.SALONBOARD_PASSWORD || null,
      storage_state: null,
    };
  }
  const res = await fetch(`${baseUrl}/salonboard-session-fetch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ owner_id, location_id }),
  });
  if (!res.ok) throw new Error(`fetchSession failed: HTTP ${res.status}`);
  const data = await res.json();
  return {
    login_id: data.login_id ?? null,
    password: data.password ?? null,
    storage_state: data.storage_state ?? null,
  };
}

export async function saveSession(owner_id: string, location_id: string | null, storage_state: any, login_status: string = "ok", last_error: string | null = null) {
  if (!baseUrl) return;
  await fetch(`${baseUrl}/salonboard-session-save`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ owner_id, location_id, storage_state, login_status, last_error }),
  }).catch(() => {});
}
