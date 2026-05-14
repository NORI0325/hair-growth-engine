Deno.serve(() => {
  const data = {
    has_anon: !!Deno.env.get("SUPABASE_ANON_KEY"),
    anon_prefix: (Deno.env.get("SUPABASE_ANON_KEY") || "").slice(0, 12),
    has_pub: !!Deno.env.get("SUPABASE_PUBLISHABLE_KEY"),
    pub_prefix: (Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "").slice(0, 12),
    sr_prefix: (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").slice(0, 12),
  };
  return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
});
