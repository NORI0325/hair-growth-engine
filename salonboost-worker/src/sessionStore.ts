// 本アプリ(SalonBoost) と通信して、店舗別の認証情報・保存セッションを取得/保存
import { logger } from "./logger.js";
import { allowEnvironmentCredentialFallback } from "./config.js";

const rawCallback = process.env.CALLBACK_URL || "";
const baseUrl = rawCallback.replace(/\/sync-worker-callback\/?$/, "");
const apiKey = process.env.WORKER_API_KEY!;

if (!baseUrl) {
  logger.warn(
    { CALLBACK_URL_set: !!rawCallback, rawCallback },
    "[sessionStore] CALLBACK_URL is empty or invalid — saveSession/fetchSession will fall back to env credentials and SKIP persisting salonboard_sessions. Set CALLBACK_URL=https://<project-ref>.supabase.co/functions/v1/sync-worker-callback in the Worker .env",
  );
} else {
  logger.info({ baseUrl }, "[sessionStore] initialized");
}

export interface SessionInfo {
  login_id: string | null;
  password: string | null;
  storage_state: any | null;
}

export async function fetchSession(owner_id: string, location_id: string | null): Promise<SessionInfo> {
  if (!baseUrl) {
    if (!allowEnvironmentCredentialFallback()) {
      throw new Error("session store is not configured and credential fallback is disabled");
    }
    logger.warn({ owner_id, location_id }, "[sessionStore.fetchSession] baseUrl empty — using env fallback credentials (no DB lookup)");
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
  if (!baseUrl) {
    logger.error(
      { owner_id, location_id, login_status },
      "[sessionStore.saveSession] SKIPPED because baseUrl is empty. salonboard_sessions will NOT be created. Fix: set CALLBACK_URL in Worker .env",
    );
    return;
  }
  try {
    const res = await fetch(`${baseUrl}/salonboard-session-save`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ owner_id, location_id, storage_state, login_status, last_error }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      logger.error({ status: res.status, body: txt, owner_id, location_id }, "[sessionStore.saveSession] HTTP error");
    } else {
      logger.info({ owner_id, location_id, login_status }, "[sessionStore.saveSession] ok");
    }
  } catch (e) {
    logger.error({ err: e instanceof Error ? e.message : String(e), owner_id, location_id }, "[sessionStore.saveSession] fetch failed");
  }
}
