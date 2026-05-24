import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

type LinkContext = {
  ownerId?: string;
  locationId?: string | null;
  customerId?: string;
  lineUserId?: string;
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const fail = async (
  supabase: ReturnType<typeof createClient>,
  error: string,
  message: string,
  context: LinkContext = {},
) => {
  if (context.ownerId) {
    await supabase.from("line_registration_logs").insert({
      owner_id: context.ownerId,
      location_id: context.locationId ?? null,
      customer_id: context.customerId ?? null,
      line_user_id: context.lineUserId ?? null,
      action: "liff_link_customer",
      success: false,
      error_code: error,
      error_message: message,
    });
  }

  return json({ success: false, error, message });
};

const verifyLineIdToken = async (idToken: string) => {
  const clientId =
    Deno.env.get("LINE_LIFF_CHANNEL_ID") ||
    Deno.env.get("LINE_LOGIN_CHANNEL_ID") ||
    Deno.env.get("LINE_CHANNEL_ID");

  if (!clientId) {
    return { error: "liff_not_configured" as const };
  }

  const params = new URLSearchParams();
  params.set("id_token", idToken);
  params.set("client_id", clientId);

  const response = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });

  if (!response.ok) {
    return { error: "invalid_id_token" as const };
  }

  const payload = await response.json();
  const lineUserId = typeof payload?.sub === "string" ? payload.sub : "";
  if (!/^U[0-9a-f]{32}$/i.test(lineUserId)) {
    return { error: "invalid_id_token" as const };
  }

  return { lineUserId };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ success: false, error: "method_not_allowed" }, 405);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { token, idToken } = await req.json();
    const normalizedToken = typeof token === "string" ? token.trim().toUpperCase() : "";

    if (!/^[A-Z0-9]{8}$/.test(normalizedToken)) {
      return json({
        success: false,
        error: "invalid_token",
        message: "連携コードが正しくありません。",
      });
    }

    if (typeof idToken !== "string" || !idToken) {
      return json({
        success: false,
        error: "id_token_missing",
        message: "LINEの本人確認情報を取得できませんでした。",
      });
    }

    const verified = await verifyLineIdToken(idToken);
    if ("error" in verified) {
      return json({
        success: false,
        error: verified.error,
        message: "連携に失敗しました。店舗スタッフへお知らせください。",
      });
    }

    const lineUserId = verified.lineUserId;

    const { data: tokenRow, error: tokenError } = await supabase
      .from("customer_line_link_tokens")
      .select("id, owner_id, customer_id, used_at, expires_at")
      .eq("token", normalizedToken)
      .maybeSingle();

    if (tokenError) throw tokenError;
    if (!tokenRow) {
      return json({
        success: false,
        error: "invalid_token",
        message: "連携コードが正しくありません。",
      });
    }

    const context: LinkContext = {
      ownerId: tokenRow.owner_id,
      customerId: tokenRow.customer_id,
      lineUserId,
    };

    if (tokenRow.used_at) {
      return fail(supabase, "token_used", "この連携コードは既に使用済みです。", context);
    }

    if (tokenRow.expires_at && new Date(tokenRow.expires_at).getTime() <= Date.now()) {
      return fail(supabase, "token_expired", "連携コードの有効期限が切れています。", context);
    }

    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .select("id, owner_id, location_id, full_name, line_user_id")
      .eq("id", tokenRow.customer_id)
      .eq("owner_id", tokenRow.owner_id)
      .maybeSingle();

    if (customerError) throw customerError;
    if (!customer) {
      return fail(supabase, "invalid_token", "連携コードが正しくありません。", context);
    }

    context.locationId = customer.location_id;

    const { data: duplicateCustomer, error: duplicateError } = await supabase
      .from("customers")
      .select("id, full_name")
      .eq("owner_id", tokenRow.owner_id)
      .eq("line_user_id", lineUserId)
      .neq("id", customer.id)
      .limit(1)
      .maybeSingle();

    if (duplicateError) throw duplicateError;
    if (duplicateCustomer) {
      return fail(
        supabase,
        "line_user_conflict",
        "別の顧客がこのLINEアカウントと既に連携されています。",
        context,
      );
    }

    if (customer.line_user_id && customer.line_user_id !== lineUserId) {
      return fail(
        supabase,
        "customer_already_linked",
        "別のLINEアカウントと既に連携されています。",
        context,
      );
    }

    const alreadyLinked = customer.line_user_id === lineUserId;
    const { error: updateCustomerError } = await supabase
      .from("customers")
      .update({ line_user_id: lineUserId, line_unfollowed_at: null })
      .eq("id", customer.id)
      .eq("owner_id", tokenRow.owner_id);

    if (updateCustomerError) throw updateCustomerError;

    const { error: updateTokenError } = await supabase
      .from("customer_line_link_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("id", tokenRow.id);

    if (updateTokenError) throw updateTokenError;

    await supabase
      .from("line_pending_friends")
      .delete()
      .eq("owner_id", tokenRow.owner_id)
      .eq("line_user_id", lineUserId);

    await supabase.from("line_registration_logs").insert({
      owner_id: tokenRow.owner_id,
      location_id: customer.location_id ?? null,
      customer_id: customer.id,
      line_user_id: lineUserId,
      action: alreadyLinked ? "liff_link_customer_already_linked" : "liff_link_customer",
      success: true,
    });

    return json({
      success: true,
      already_linked: alreadyLinked,
      customer_name: customer.full_name,
      message: "LINE連携が完了しました。",
    });
  } catch (error) {
    console.error("line-link-complete failed", error);
    return json(
      {
        success: false,
        error: "internal_error",
        message: "連携に失敗しました。店舗スタッフへお知らせください。",
      },
      500,
    );
  }
});
