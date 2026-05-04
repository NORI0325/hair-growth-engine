// 予約アクション用 署名付きトークン (HS256 JWT風 + DBで使い捨て管理)
import { create, verify, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

const SECRET = Deno.env.get("RESERVATION_ACTION_SECRET") || "";

async function getKey(): Promise<CryptoKey> {
  const enc = new TextEncoder().encode(SECRET);
  return await crypto.subtle.importKey(
    "raw", enc, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"],
  );
}

export interface TokenPayload {
  request_id: string;
  action: "approve" | "propose" | "reject";
  owner_id: string;
}

export async function signActionToken(payload: TokenPayload, ttlSeconds = 60 * 60 * 48): Promise<string> {
  const key = await getKey();
  return await create(
    { alg: "HS256", typ: "JWT" },
    { ...payload, exp: getNumericDate(ttlSeconds), iat: getNumericDate(0) },
    key,
  );
}

export async function verifyActionToken(token: string): Promise<TokenPayload | null> {
  try {
    const key = await getKey();
    const payload = await verify(token, key) as any;
    if (!payload?.request_id || !payload?.action || !payload?.owner_id) return null;
    return { request_id: payload.request_id, action: payload.action, owner_id: payload.owner_id };
  } catch (e) {
    console.error("[verifyActionToken] error:", e);
    return null;
  }
}

export async function hashToken(token: string): Promise<string> {
  const enc = new TextEncoder().encode(token);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function publicAppOrigin(): string {
  return Deno.env.get("PUBLIC_APP_ORIGIN") || "https://saronboost.com";
}
