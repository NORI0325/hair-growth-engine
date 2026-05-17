// _shared/invoke-internal.ts
// Edge Function 同士の内部呼び出し用ヘルパー。
//
// 背景:
//   Lovable Cloud の新形式 API キー (sb_publishable_* / sb_secret_*) は
//   verify_jwt=true な edge function のゲートで「Invalid JWT」と扱われ、
//   supabase.functions.invoke() からの呼び出しが 401 で落ちることがある。
//   この事象により notify-owner-booking, cron-check-unsynced-bookings,
//   notify-sync-failure 等の通知系が無言で失敗していた (2026-05-14 失客事故)。
//
// 対策:
//   - Authorization: legacy 形式の anon JWT (env または publishable) を使用
//   - apikey: SERVICE_ROLE_KEY を使用
//   - 直接 fetch で送信し、失敗時は status / body / target を呼び出し元に返す
//
// 注意:
//   - 通知送信失敗で本処理 (予約作成/同期/承認 etc.) を止めないこと。
//   - 呼び出し元で result.ok を見てログ/フォールバックすること。
//
// 将来の改善 (TODO):
//   - 本来は内部呼び出し専用の HMAC 署名 (X-Internal-Signature) や
//     共有 secret 方式に移行し、誰でも呼べる verify_jwt=false の通知系を
//     保護する。今回は失客防止優先のため最小実装。
//   - JWT rotate 時はこの helper の ANON_JWT 取得ロジックだけ差し替えれば良い。

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Lovable Cloud は新形式キーが配られる環境でも、verify_jwt=true ゲートには
// 旧 anon JWT 形式が必要。SUPABASE_ANON_KEY が legacy JWT 形式で配られている
// 場合はそれを使い、そうでなければハードコードの publishable JWT を使う。
const ENV_ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const LEGACY_ANON_JWT_FALLBACK =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1peWVkaW9lbWt6aGV0cGhqenpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMDQ1NjgsImV4cCI6MjA5Mjg4MDU2OH0.Eol9UKE46E0TXJdw84ro3csac4ah3RVUsOhVGcT4HRc";

function pickAnonJwt(): string {
  // 旧形式 JWT は "eyJ" で始まる 3 セグメント。新形式 (sb_publishable_*) は除外。
  if (ENV_ANON.startsWith("eyJ") && ENV_ANON.split(".").length === 3) return ENV_ANON;
  return LEGACY_ANON_JWT_FALLBACK;
}

export type InvokeInternalResult<T = unknown> = {
  ok: boolean;
  status: number;
  data?: T;
  errorBody?: string;
  errorMessage?: string;
  target: string;
  requestId?: string;
  idempotencyKey?: string;
};

export async function invokeInternal<T = unknown>(
  functionName: string,
  payload: Record<string, unknown>,
  opts: { idempotencyKey?: string; timeoutMs?: number; caller?: string; context?: Record<string, unknown> } = {},
): Promise<InvokeInternalResult<T>> {
  const url = `${SUPABASE_URL}/functions/v1/${functionName}`;
  const idempotencyKey =
    opts.idempotencyKey ?? (payload.idempotencyKey as string | undefined);
  const caller = opts.caller ?? "unknown";
  const ctx = opts.context ? JSON.stringify(opts.context) : "-";
  const anon = pickAnonJwt();
  const ctrl = new AbortController();
  const timer = opts.timeoutMs ? setTimeout(() => ctrl.abort(), opts.timeoutMs) : null;

  try {
    const resp = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        // verify_jwt=true 対策: anon JWT を Bearer に。
        "Authorization": `Bearer ${anon}`,
        // 認可は service_role 経由。
        "apikey": SERVICE_ROLE_KEY,
      },
      body: JSON.stringify(payload),
    });
    const text = await resp.text();
    const requestId = resp.headers.get("sb-request-id") ?? resp.headers.get("x-request-id") ?? undefined;

    if (!resp.ok) {
      console.error(
        `[invokeInternal] FAIL caller=${caller} target=${functionName} status=${resp.status} reqId=${requestId ?? "-"} idem=${idempotencyKey ?? "-"} ctx=${ctx} body=${text.slice(0, 500)}`,
      );
      return {
        ok: false, status: resp.status, errorBody: text.slice(0, 2000),
        target: functionName, requestId, idempotencyKey,
      };
    }
    let data: T | undefined;
    try { data = text ? (JSON.parse(text) as T) : undefined; } catch { /* non-json */ }
    return { ok: true, status: resp.status, data, target: functionName, requestId, idempotencyKey };
  } catch (e) {
    const msg = (e as Error).message;
    console.error(
      `[invokeInternal] EXCEPTION caller=${caller} target=${functionName} idem=${idempotencyKey ?? "-"} ctx=${ctx} err=${msg}`,
    );
    return {
      ok: false, status: 0, errorMessage: msg,
      target: functionName, idempotencyKey,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// 便利ラッパー: send-transactional-email 専用
export async function sendTransactionalEmailInternal(payload: {
  templateName: string;
  recipientEmail: string;
  idempotencyKey: string;
  templateData?: Record<string, unknown>;
  [k: string]: unknown;
}) {
  return invokeInternal("send-transactional-email", payload, {
    idempotencyKey: payload.idempotencyKey,
    timeoutMs: 15000,
  });
}
