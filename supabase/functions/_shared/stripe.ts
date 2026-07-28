import { encode } from "https://deno.land/std@0.168.0/encoding/hex.ts";
import Stripe from "https://esm.sh/stripe@22.0.2";

const getEnv = (key: string): string => {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`${key} is not configured`);
  return value;
};

export type StripeEnv = "sandbox" | "live";

const GATEWAY_STRIPE_BASE = "https://connector-gateway.lovable.dev/stripe";

export function getConnectionApiKey(env: StripeEnv): string {
  return env === "sandbox"
    ? getEnv("STRIPE_SANDBOX_API_KEY")
    : getEnv("STRIPE_LIVE_API_KEY");
}

export function createStripeClient(env: StripeEnv): Stripe {
  const connectionApiKey = getConnectionApiKey(env);
  const lovableApiKey = getEnv("LOVABLE_API_KEY");

  return new Stripe(connectionApiKey, {
    apiVersion: "2026-03-25.dahlia",
    httpClient: Stripe.createFetchHttpClient((url: string | URL, init?: RequestInit) => {
      const gatewayUrl = url.toString().replace("https://api.stripe.com", GATEWAY_STRIPE_BASE);
      return fetch(gatewayUrl, {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init?.headers).entries()),
          "X-Connection-Api-Key": connectionApiKey,
          "Lovable-API-Key": lovableApiKey,
        },
      });
    }),
  });
}

export async function setAdditionalLocationQuantity(
  env: StripeEnv,
  subscriptionId: string,
  quantity: number,
  idempotencyKey: string,
): Promise<boolean> {
  const stripe = createStripeClient(env);
  const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
  const prices = await stripe.prices.list({
    lookup_keys: ["salon_boost_additional_location_monthly"],
    active: true,
    limit: 1,
  });
  const additionalPriceId = prices.data[0]?.id;
  if (!additionalPriceId) throw new Error("additional_price_not_found");

  const existingItem = stripeSubscription.items.data.find((item) => item.price.id === additionalPriceId);
  const normalizedQuantity = Math.max(0, Math.trunc(quantity));

  if (existingItem && normalizedQuantity === 0) {
    await stripe.subscriptions.update(subscriptionId, {
      items: [{ id: existingItem.id, deleted: true }],
      proration_behavior: "create_prorations",
    }, { idempotencyKey });
    return true;
  }
  if (existingItem) {
    await stripe.subscriptions.update(subscriptionId, {
      items: [{ id: existingItem.id, quantity: normalizedQuantity }],
      proration_behavior: "create_prorations",
    }, { idempotencyKey });
    return true;
  }
  if (normalizedQuantity > 0) {
    await stripe.subscriptions.update(subscriptionId, {
      items: [{ price: additionalPriceId, quantity: normalizedQuantity }],
      proration_behavior: "create_prorations",
    }, { idempotencyKey });
    return true;
  }
  return false;
}

export async function verifyWebhook(req: Request, env: StripeEnv): Promise<{ type: string; data: { object: any } }> {
  const signature = req.headers.get("stripe-signature");
  const body = await req.text();
  const secret = env === "sandbox"
    ? getEnv("PAYMENTS_SANDBOX_WEBHOOK_SECRET")
    : getEnv("PAYMENTS_LIVE_WEBHOOK_SECRET");

  if (!signature || !body) throw new Error("Missing signature or body");

  let timestamp: string | undefined;
  const v1Signatures: string[] = [];
  for (const part of signature.split(",")) {
    const [key, value] = part.split("=", 2);
    if (key === "t") timestamp = value;
    if (key === "v1") v1Signatures.push(value);
  }
  if (!timestamp || v1Signatures.length === 0) throw new Error("Invalid signature format");

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 300) throw new Error("Webhook timestamp too old");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  const expected = new TextDecoder().decode(encode(new Uint8Array(signed)));

  if (!v1Signatures.includes(expected)) throw new Error("Invalid webhook signature");

  return JSON.parse(body);
}
