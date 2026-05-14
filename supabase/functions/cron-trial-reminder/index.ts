import { createClient } from "npm:@supabase/supabase-js@2";
import { invokeInternal } from "../_shared/invoke-internal.ts";

Deno.serve(async (_req) => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

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

    await supabase.functions.invoke("send-transactional-email", {
      body: {
        to: user.user.email,
        subject: `【Salon Boost】無料期間があと${sendDay}日で終了します`,
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
            <h2>${s.profiles?.salon_name ?? "サロン"} 様</h2>
            <p>いつもSalon Boostをご利用いただきありがとうございます。</p>
            <p><strong>無料トライアルがあと${sendDay}日で終了します。</strong>（${ends.toLocaleDateString("ja-JP")}まで）</p>
            <p>引き続きご利用いただくには、お支払い情報のご登録をお願いします。</p>
            <p><a href="${Deno.env.get("APP_URL") ?? "https://hair-growth-engine.lovable.app"}/billing"
                  style="display:inline-block;padding:12px 24px;background:#000;color:#fff;text-decoration:none;border-radius:4px">
              お支払い情報を登録する
            </a></p>
            <p style="color:#666;font-size:12px">登録されない場合、トライアル終了時点でアプリは閲覧専用モードに移行します。データは保持されます。</p>
          </div>
        `,
      },
    });
    results.push({ owner_id: s.owner_id, daysLeft });
  }

  return new Response(JSON.stringify({ ok: true, sent: results.length, results }), {
    headers: { "Content-Type": "application/json" },
  });
});
