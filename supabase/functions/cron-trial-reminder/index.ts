import { createClient } from "npm:@supabase/supabase-js@2";
import { invokeInternal } from "../_shared/invoke-internal.ts";
import { requireInternalRequest } from "../_shared/request-auth.ts";

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const identity = await requireInternalRequest(req, supabase);
  if (identity instanceof Response) return identity;

  // 7日前と1日前のトライアル終了通知（クレカ未登録のみ）
  const now = new Date();
  const in7Days = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
  const in1Day = new Date(now.getTime() + 24 * 3600 * 1000);

  const { data: subs } = await supabase
    .from("subscriptions")
    .select("owner_id, trial_ends_at, stripe_customer_id, profiles!inner(salon_name)")
    .eq("status", "trialing")
    .is("stripe_customer_id", null);

  const results: any[] = [];
  for (const s of (subs as any) ?? []) {
    if (!s.trial_ends_at) continue;
    const ends = new Date(s.trial_ends_at);
    const daysLeft = Math.ceil((ends.getTime() - now.getTime()) / (24 * 3600 * 1000));

    let sendDay: number | null = null;
    if (daysLeft === 7) sendDay = 7;
    else if (daysLeft === 1) sendDay = 1;
    else continue;

    const { data: user } = await supabase.auth.admin.getUserById(s.owner_id);
    if (!user.user?.email) continue;

    const appOrigin = (Deno.env.get("PUBLIC_APP_ORIGIN") ?? Deno.env.get("APP_URL") ?? "https://saronboost.com").replace(/\/+$/, "");
    const er = await invokeInternal("send-transactional-email", {
      templateName: "internal-notification",
      recipientEmail: user.user.email,
      idempotencyKey: `trial-reminder-${s.owner_id}-${sendDay}d`,
      templateData: {
        subject: `【SalonBoost】無料期間があと${sendDay}日で終了します`,
        title: `無料トライアル終了まであと${sendDay}日です`,
        salonName: s.profiles?.salon_name ?? "サロン",
        message: `トライアル終了日は${ends.toLocaleDateString("ja-JP")}です。継続利用にはお支払い情報をご登録ください。未登録の場合もデータは保持されます。`,
        actionLabel: "お支払い情報を登録する",
        actionUrl: `${appOrigin}/billing`,
      },
    }, { idempotencyKey: `trial-reminder-${s.owner_id}-${sendDay}d` });
    results.push({ owner_id: s.owner_id, daysLeft, sent: er.ok, status: er.status });
  }

  return new Response(JSON.stringify({ ok: true, sent: results.length, results }), {
    headers: { "Content-Type": "application/json" },
  });
});
