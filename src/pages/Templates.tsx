import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TEMPLATE_CATALOG, CATEGORY_LABEL, type TemplateChannel, type TemplateMeta } from "@/lib/templateCatalog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Sparkles, Save, RotateCcw, Eye, Send, Tag, Gift } from "lucide-react";
import { useCurrentLocationId } from "@/hooks/useLocations";
import { useTenantId } from "@/hooks/useTenant";

type Override = {
  id?: string;
  subject: string | null;
  greeting: string | null;
  body: string | null;
  cta_label: string | null;
  cta_url: string | null;
  signature: string | null;
  coupon_id: string | null;
  incentive_id: string | null;
  enabled: boolean;
};

const EMPTY: Override = {
  subject: "", greeting: "", body: "", cta_label: "", cta_url: "", signature: "", coupon_id: null, incentive_id: null, enabled: true,
};

const Templates = () => {
  const { user } = useAuth();
  const tenantId = useTenantId();
  const locationId = useCurrentLocationId();
  const [channel, setChannel] = useState<TemplateChannel>("email");
  const [selectedKey, setSelectedKey] = useState<string>(TEMPLATE_CATALOG[0].key);
  const [override, setOverride] = useState<Override>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [preview, setPreview] = useState<string>("");
  const [coupons, setCoupons] = useState<Array<{ id: string; title: string }>>([]);
  const [incentives, setIncentives] = useState<Array<{ id: string; title: string; kind: string }>>([]);

  const meta = useMemo<TemplateMeta>(
    () => TEMPLATE_CATALOG.find((t) => t.key === selectedKey)!,
    [selectedKey]
  );

  const filteredTemplates = useMemo(
    () => TEMPLATE_CATALOG.filter((t) => t.channels.includes(channel)),
    [channel]
  );

  useEffect(() => {
    if (!filteredTemplates.find((t) => t.key === selectedKey)) {
      setSelectedKey(filteredTemplates[0]?.key || "");
    }
  }, [channel, filteredTemplates, selectedKey]);

  useEffect(() => {
    if (!user || !tenantId) return;
    supabase.from("coupons").select("id, title").eq("location_id", locationId).then(({ data }) => {
      setCoupons(data || []);
    });
    supabase.from("incentives").select("id, title, kind").eq("location_id", locationId).eq("active", true).order("sort_order").then(({ data }) => {
      setIncentives(data || []);
    });
  }, [user]);

  // load override
  useEffect(() => {
    if (!user || !selectedKey) return;
    setLoading(true);
    supabase
      .from("template_overrides")
      .select("*")
      .eq("location_id", locationId)
      .eq("channel", channel)
      .eq("template_key", selectedKey)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setOverride({
            id: data.id,
            subject: data.subject ?? meta.defaultSubject ?? "",
            greeting: data.greeting ?? meta.defaultGreeting ?? "",
            body: data.body ?? meta.defaultBody ?? "",
            cta_label: data.cta_label ?? meta.defaultCtaLabel ?? "",
            cta_url: data.cta_url ?? "",
            signature: data.signature ?? "",
            coupon_id: data.coupon_id,
            incentive_id: (data as any).incentive_id ?? null,
            enabled: data.enabled,
          });
        } else {
          setOverride({
            ...EMPTY,
            subject: meta.defaultSubject ?? "",
            greeting: meta.defaultGreeting ?? "",
            body: meta.defaultBody ?? "",
            cta_label: meta.defaultCtaLabel ?? "",
          });
        }
        setLoading(false);
      });
  }, [user, channel, selectedKey, meta]);

  const refreshPreview = async () => {
    const { data, error } = await supabase.functions.invoke("preview-template-override", {
      body: { channel, template_key: selectedKey, override },
    });
    if (error) {
      toast.error("プレビュー取得失敗");
      return;
    }
    setPreview((data as any)?.preview || "");
  };

  useEffect(() => {
    const t = setTimeout(() => { refreshPreview(); }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [override, channel, selectedKey]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    const payload = {
      owner_id: tenantId,
      channel,
      template_key: selectedKey,
      ...override,
    };
    const { error } = await supabase.from("template_overrides").upsert(payload as any, { onConflict: "owner_id,channel,template_key" });
    setSaving(false);
    if (error) { toast.error("保存失敗: " + error.message); return; }
    toast.success("保存しました");
  };

  const handleReset = async () => {
    if (!user || !override.id) {
      setOverride({
        ...EMPTY,
        subject: meta.defaultSubject ?? "",
        greeting: meta.defaultGreeting ?? "",
        body: meta.defaultBody ?? "",
        cta_label: meta.defaultCtaLabel ?? "",
      });
      return;
    }
    if (!confirm("デフォルトに戻しますか？")) return;
    await supabase.from("template_overrides").delete().eq("id", override.id);
    toast.success("デフォルトに戻しました");
    setOverride({
      ...EMPTY,
      subject: meta.defaultSubject ?? "",
      greeting: meta.defaultGreeting ?? "",
      body: meta.defaultBody ?? "",
      cta_label: meta.defaultCtaLabel ?? "",
    });
  };

  const aiAssist = async (action: string, instruction?: string) => {
    if (!override.body) { toast.error("本文を入力してください"); return; }
    setAiBusy(true);
    const { data, error } = await supabase.functions.invoke("ai-template-assistant", {
      body: { text: override.body, action, channel, instruction },
    });
    setAiBusy(false);
    if (error) { toast.error("AI処理失敗"); return; }
    const result = (data as any)?.result;
    if (result) {
      setOverride((o) => ({ ...o, body: result }));
      toast.success("AIが書き換えました ✨");
    }
  };

  const insertVar = (v: string) => {
    setOverride((o) => ({ ...o, body: (o.body || "") + `{{${v}}}` }));
  };

  return (
    <AppLayout>
      <div className="mb-8">
        <div className="eyebrow text-[10px] mb-3">TEMPLATES · 編集</div>
        <h1 className="font-serif text-4xl text-foreground">メール / LINE テンプレート</h1>
        <p className="text-sm text-muted-foreground mt-2">サロンの個性を反映した文章にカスタマイズできます</p>
      </div>

      <Tabs value={channel} onValueChange={(v) => setChannel(v as TemplateChannel)} className="mb-6">
        <TabsList>
          <TabsTrigger value="email">メール</TabsTrigger>
          <TabsTrigger value="line">LINE</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid grid-cols-12 gap-6">
        {/* テンプレート一覧 */}
        <Card className="col-span-3">
          <CardHeader><CardTitle className="text-sm">テンプレート ({filteredTemplates.length})</CardTitle></CardHeader>
          <CardContent className="space-y-1 max-h-[70vh] overflow-auto">
            {(["auto", "manual", "lifecycle", "owner"] as const).map((cat) => {
              const items = filteredTemplates.filter((t) => t.category === cat);
              if (items.length === 0) return null;
              return (
                <div key={cat} className="mb-3">
                  <div className="eyebrow text-[9px] mb-1 px-2">{CATEGORY_LABEL[cat]}</div>
                  {items.map((t) => (
                    <button
                      key={t.key}
                      onClick={() => setSelectedKey(t.key)}
                      className={`w-full text-left px-2 py-2 text-xs rounded transition-colors ${selectedKey === t.key ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}
                    >
                      {t.displayName}
                    </button>
                  ))}
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* 編集 */}
        <Card className="col-span-5">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">{meta.displayName}</CardTitle>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{override.enabled ? "ON" : "OFF"}</span>
                <Switch checked={override.enabled} onCheckedChange={(v) => setOverride((o) => ({ ...o, enabled: v }))} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{meta.description}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {channel === "email" && (
              <div>
                <Label className="text-xs">件名</Label>
                <Input value={override.subject || ""} onChange={(e) => setOverride((o) => ({ ...o, subject: e.target.value }))} />
              </div>
            )}
            <div>
              <Label className="text-xs">挨拶</Label>
              <Input value={override.greeting || ""} onChange={(e) => setOverride((o) => ({ ...o, greeting: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">本文</Label>
              <Textarea rows={8} value={override.body || ""} onChange={(e) => setOverride((o) => ({ ...o, body: e.target.value }))} />
              <div className="flex flex-wrap gap-1 mt-2">
                {meta.variables.map((v) => (
                  <Button key={v} type="button" size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => insertVar(v)}>
                    {`{{${v}}}`}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">ボタン文言</Label>
                <Input value={override.cta_label || ""} onChange={(e) => setOverride((o) => ({ ...o, cta_label: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">ボタンURL（任意）</Label>
                <Input placeholder="自動で予約リンクが入ります" value={override.cta_url || ""} onChange={(e) => setOverride((o) => ({ ...o, cta_url: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label className="text-xs">署名</Label>
              <Input value={override.signature || ""} onChange={(e) => setOverride((o) => ({ ...o, signature: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1"><Tag className="w-3 h-3" /> クーポン差し込み</Label>
              <Select value={override.coupon_id || "none"} onValueChange={(v) => setOverride((o) => ({ ...o, coupon_id: v === "none" ? null : v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">なし</SelectItem>
                  {coupons.map((c) => (<SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1"><Gift className="w-3 h-3" /> 特典差し込み（割引以外も選べます）</Label>
              <Select value={override.incentive_id || "none"} onValueChange={(v) => setOverride((o) => ({ ...o, incentive_id: v === "none" ? null : v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">なし</SelectItem>
                  {incentives.map((i) => (<SelectItem key={i.id} value={i.id}>{i.title}</SelectItem>))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-1">本文に <code>{`{{incentive_title}}`}</code> <code>{`{{incentive_description}}`}</code> <code>{`{{incentive_terms}}`}</code> を挿入できます</p>
            </div>

            {/* AIアシスタント */}
            <div className="border-t pt-4">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-4 h-4 text-primary" />
                <span className="text-xs font-medium">AI アシスタント</span>
                {aiBusy && <span className="text-[10px] text-muted-foreground">処理中...</span>}
              </div>
              <div className="flex flex-wrap gap-1">
                <Button size="sm" variant="outline" disabled={aiBusy} onClick={() => aiAssist("polish")}>整える</Button>
                <Button size="sm" variant="outline" disabled={aiBusy} onClick={() => aiAssist("shorten")}>短く</Button>
                <Button size="sm" variant="outline" disabled={aiBusy} onClick={() => aiAssist("expand")}>丁寧に</Button>
                <Button size="sm" variant="outline" disabled={aiBusy} onClick={() => aiAssist("emoji")}>絵文字+</Button>
                <Button size="sm" variant="outline" disabled={aiBusy} onClick={() => aiAssist("tone", "luxury")}>高級感</Button>
                <Button size="sm" variant="outline" disabled={aiBusy} onClick={() => aiAssist("tone", "friendly")}>親しみ</Button>
              </div>
            </div>

            <div className="flex gap-2 pt-4 border-t">
              <Button onClick={handleSave} disabled={saving || loading} className="flex-1">
                <Save className="w-3.5 h-3.5 mr-2" />{saving ? "保存中..." : "保存"}
              </Button>
              <Button variant="outline" onClick={handleReset}>
                <RotateCcw className="w-3.5 h-3.5 mr-2" />リセット
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* プレビュー */}
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2"><Eye className="w-4 h-4" /> プレビュー</CardTitle>
          </CardHeader>
          <CardContent>
            {channel === "email" ? (
              <iframe srcDoc={preview} className="w-full h-[60vh] border rounded bg-white" title="preview" />
            ) : (
              <div className="bg-[#7DB342]/10 p-4 rounded text-sm whitespace-pre-wrap min-h-[60vh] font-sans">{preview}</div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default Templates;
