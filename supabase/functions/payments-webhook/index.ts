import { createClient } from "npm:@supabase/supabase-js@2";
import { type StripeEnv, verifyWebhook } from "../_shared/stripe.ts";

let _supabase: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  }
  return _supabase;
}

async function upsertSubscription(sub: any) {
  const tenantId = sub.metadata?.tenant_id;
  if (!tenantId) {
    console.error("No tenant_id in subscription metadata", sub.id);
    return;
  }
  const item = sub.items?.data?.[0];
  const periodEnd = item?.current_period_end ?? sub.current_period_end;

  const update: Record<string, any> = {
    status: sub.status,
    stripe_customer_id: sub.customer,
    stripe_subscription_id: sub.id,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    updated_at: new Date().toISOString(),
  };

  await getSupabase()
    .from("subscriptions")
    .update(update)
    .eq("owner_id", tenantId);
}

async function handleSubscriptionDeleted(sub: any) {
  const tenantId = sub.metadata?.tenant_id;
  if (!tenantId) return;
  await getSupabase().from("subscriptions").update({
    status: "canceled", updated_at: new Date().toISOString(),
  }).eq("owner_id", tenantId);
}

async function handleWebhook(req: Request, env: StripeEnv) {
  const event = await verifyWebhook(req, env);

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "subscription.created":
    case "subscription.updated":
      await upsertSubscription(event.data.object);
      break;
    case "customer.subscription.deleted":
    case "subscription.canceled":
      await handleSubscriptionDeleted(event.data.object);
      break;
    case "invoice.payment_failed":
    case "transaction.payment_failed":
      const failed = event.data.object;
      const tenantId = failed.subscription_metadata?.tenant_id ?? failed.metadata?.tenant_id;
      if (tenantId) {
        await getSupabase().from("subscriptions").update({
          status: "past_due", updated_at: new Date().toISOString(),
        }).eq("owner_id", tenantId);
      }
      break;
    default:
      console.log("Unhandled event:", event.type);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const rawEnv = new URL(req.url).searchParams.get("env");
  if (rawEnv !== "sandbox" && rawEnv !== "live") {
    return new Response(JSON.stringify({ received: true, ignored: "invalid env" }), { status: 200 });
  }
  try {
    await handleWebhook(req, rawEnv);
    return new Response(JSON.stringify({ received: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("Webhook error:", e);
    return new Response("Webhook error", { status: 400 });
  }
});
