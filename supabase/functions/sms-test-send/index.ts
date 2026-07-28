// 設定画面からのSMSテスト送信。認証必須（オーナー本人のみ）
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { sendSmsWithLog, toE164JP } from "../_shared/twilio-sms.ts";
import { authenticateRequest, canAccessOwner } from "../_shared/request-auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const identity = await authenticateRequest(req, supabaseAdmin);
    if (identity.kind !== "user") {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const ownerId = String(body?.owner_id || "").trim();
    const locationId = body?.location_id ? String(body.location_id) : null;
    const phoneRaw = String(body?.phone || "").trim();
    const customBody = String(body?.body || "").trim();

    if (!ownerId || !await canAccessOwner(supabaseAdmin, identity.userId, ownerId, ["owner", "manager", "super_admin"])) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (locationId) {
      const { data: location } = await supabaseAdmin
        .from("locations")
        .select("id")
        .eq("id", locationId)
        .eq("tenant_id", ownerId)
        .maybeSingle();
      if (!location) {
        return new Response(JSON.stringify({ error: "invalid_location" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const e164 = toE164JP(phoneRaw);
    if (!e164) {
      return new Response(JSON.stringify({
        error: "invalid_phone",
        message: "電話番号の形式が正しくありません。日本の携帯番号（例: 090-1234-5678）または +で始まる国際番号を入力してください。",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("salon_name")
      .eq("id", ownerId)
      .maybeSingle();

    const salonName = profile?.salon_name || "サロン";
    const text = customBody || `【${salonName}】SMS接続テストです🌸 このメッセージが届いていれば設定は正常です。`;

    const result = await sendSmsWithLog(supabaseAdmin, {
      owner_id: ownerId,
      location_id: locationId,
      customer_id: null,
      phone: phoneRaw,
      message: text,
      source: "sms_test",
      job_type: "sms_test",
      metadata: {
        normalized_phone: e164,
      },
    });

    if (result.skipped) {
      const messageMap: Record<string, string> = {
        twilio_not_connected: "❌ Twilioが未接続です。先にTwilio接続を完了してください。",
        twilio_from_number_missing: "❌ TWILIO_FROM_NUMBER（送信元電話番号）が未設定です。",
        invalid_phone: "❌ 電話番号の形式が正しくありません。",
      };
      return new Response(JSON.stringify({
        error: result.reason,
        message: messageMap[result.reason || ""] || `送信できません: ${result.reason}`,
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!result.ok) {
      let hint = "";
      const err = result.err || "";
      if (err.includes("21408") || err.includes("not enabled")) {
        hint = "\n→ Twilio Console の「Geo Permissions」で日本(Japan)の送信許可をONにしてください。";
      } else if (err.includes("21211") || err.includes("invalid")) {
        hint = "\n→ 電話番号の形式を確認してください（例: +819012345678）。";
      } else if (err.includes("21610")) {
        hint = "\n→ 送信先がSTOPでオプトアウトしています。";
      } else if (err.includes("21614")) {
        hint = "\n→ 送信先番号がSMSに対応していない可能性があります。";
      } else if (err.includes("20003") || err.includes("authenticate")) {
        hint = "\n→ Twilio認証情報が無効です。Auth Tokenを再ローテートしてください。";
      } else if (err.includes("21606") || err.includes("From")) {
        hint = "\n→ TWILIO_FROM_NUMBER（送信元番号）が無効、またはSMS未対応です。Twilioで購入した番号を確認してください。";
      }
      return new Response(JSON.stringify({
        error: "send_failed",
        message: `❌ 送信に失敗しました${hint}`,
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ success: true, sid: result.sid, to: e164 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("sms-test-send error:", e);
    return new Response(JSON.stringify({
      error: "internal",
      message: "SMSテスト送信に失敗しました。",
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
