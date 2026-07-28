// _shared/invoke-internal.ts
// Edge Function 同士の内部呼び出し用ヘルパー。
//
// New-format Lovable keys are not JWTs. Internal targets therefore use
// verify_jwt=false and authenticate the service-role key (or the optional
// EDGE_INTERNAL_SECRET) inside the function. No project-specific public JWT is
// embedded in source code.
//
// 注意:
//   - 通知送信失敗で本処理 (予約作成/同期/承認 etc.) を止めないこと。
//   - 呼び出し元で result.ok を見てログ/フォールバックすること。
//
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_SECRET = Deno.env.get("EDGE_INTERNAL_SECRET") ?? "";

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
  const ctrl = new AbortController();
  const timer = opts.timeoutMs ? setTimeout(() => ctrl.abort(), opts.timeoutMs) : null;

  try {
    const resp = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "apikey": SERVICE_ROLE_KEY,
        ...(INTERNAL_SECRET ? { "x-internal-secret": INTERNAL_SECRET } : {}),
      },
      body: JSON.stringify(
        idempotencyKey && payload.idempotencyKey === undefined && payload.idempotency_key === undefined
          ? { ...payload, idempotencyKey }
          : payload,
      ),
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
