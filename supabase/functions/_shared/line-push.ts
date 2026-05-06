// LINE Messaging API共通ユーティリティ

// SupabaseClient type alias (importを増やさないため any を使う)
type SBClient = any;

export interface LineCredentials {
  accessToken: string;
  /** 店舗別かオーナー共通か */
  source: "location" | "owner";
  ownerId: string;
  locationId: string | null;
  /** 署名検証用（あれば） */
  hasSecret: boolean;
}

/**
 * LINEアクセストークン取得ヘルパー。
 * - locationId が指定され、locations.line_channel_access_token が設定されていればそれを優先
 * - なければ profiles.line_channel_access_token にフォールバック（オーナー共通LINE）
 * - どちらもなければ null
 *
 * セキュリティ: 戻り値の accessToken はログに絶対出さないこと。診断時は source / hasSecret のみ。
 *
 * 将来的に rich_menu_id を channel_integrations(channel='line') へ移すまでは
 * profiles.line_rich_menu_id / locations.line_rich_menu_id を使う。
 */
export async function getLineCredentials(
  supabase: SBClient,
  ownerId: string,
  locationId?: string | null,
): Promise<LineCredentials | null> {
  if (!ownerId) return null;

  // 1) location 優先
  if (locationId) {
    try {
      const { data: loc } = await supabase
        .from("locations")
        .select("id, line_channel_access_token, line_channel_secret")
        .eq("id", locationId)
        .maybeSingle();
      const tok = (loc as any)?.line_channel_access_token;
      if (tok && typeof tok === "string" && tok.length > 10) {
        return {
          accessToken: tok,
          source: "location",
          ownerId,
          locationId,
          hasSecret: !!(loc as any)?.line_channel_secret,
        };
      }
    } catch (e) {
      console.warn("[getLineCredentials] location lookup failed:", e instanceof Error ? e.message : "unknown");
    }
  }

  // 2) owner 共通へフォールバック
  try {
    const { data: prof } = await supabase
      .from("profiles")
      .select("id, line_channel_access_token, line_channel_secret")
      .eq("id", ownerId)
      .maybeSingle();
    const tok = (prof as any)?.line_channel_access_token;
    if (tok && typeof tok === "string" && tok.length > 10) {
      return {
        accessToken: tok,
        source: "owner",
        ownerId,
        locationId: locationId ?? null,
        hasSecret: !!(prof as any)?.line_channel_secret,
      };
    }
  } catch (e) {
    console.warn("[getLineCredentials] owner lookup failed:", e instanceof Error ? e.message : "unknown");
  }

  return null;
}

export async function sendLinePush(
  token: string,
  userId: string,
  text: string
): Promise<{ ok: boolean; status?: number; err?: string }> {
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: userId,
        messages: [{ type: "text", text: text.slice(0, 4900) }],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, status: res.status, err: `LINE ${res.status}: ${body.slice(0, 300)}` };
    }
    await res.text();
    return { ok: true };
  } catch (e) {
    return { ok: false, err: e instanceof Error ? e.message : "unknown" };
  }
}

export async function replyLine(
  token: string,
  replyToken: string,
  text: string
): Promise<{ ok: boolean; err?: string }> {
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        replyToken,
        messages: [{ type: "text", text: text.slice(0, 4900) }],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, err: `LINE reply ${res.status}: ${body.slice(0, 300)}` };
    }
    await res.text();
    return { ok: true };
  } catch (e) {
    return { ok: false, err: e instanceof Error ? e.message : "unknown" };
  }
}

// 電話番号正規化（ハイフン・全角・空白除去、+81→0変換）
export function normalizePhone(raw: string): string | null {
  if (!raw) return null;
  let s = raw
    .replace(/[\u3000\s\-－ー―‐\(\)（）]/g, "")
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  if (s.startsWith("+81")) s = "0" + s.slice(3);
  if (s.startsWith("81") && s.length >= 12) s = "0" + s.slice(2);
  if (!/^\d{10,11}$/.test(s)) return null;
  return s;
}
