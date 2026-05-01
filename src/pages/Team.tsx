import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId, useTenantRole, hasMinRole } from "@/hooks/useTenant";
import { useLocations } from "@/hooks/useLocations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Trash2, Mail } from "lucide-react";
import AppLayout from "@/components/AppLayout";

interface Member { user_id: string; role: string; accepted_at: string | null; email?: string | null; full_name?: string | null }
interface Invitation { id: string; email: string; role: string; expires_at: string; accepted_at: string | null; location_ids: string[] | null }

const Team = () => {
  const tenantId = useTenantId();
  const role = useTenantRole();
  const canManage = hasMinRole(role, "owner");
  const { data: locations = [] } = useLocations();
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("staff");
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [allLocations, setAllLocations] = useState(true);

  const load = async () => {
    if (!tenantId) return;
    const { data: m } = await supabase
      .from("tenant_members")
      .select("user_id, role, accepted_at, profiles!inner(full_name)")
      .eq("tenant_id", tenantId);
    setMembers((m as any) ?? []);
    const { data: i } = await supabase
      .from("tenant_invitations")
      .select("id, email, role, expires_at, accepted_at, location_ids")
      .eq("tenant_id", tenantId)
      .is("accepted_at", null)
      .order("created_at", { ascending: false });
    setInvites((i as any) ?? []);
  };

  useEffect(() => { load(); }, [tenantId]);

  const sendInvite = async () => {
    if (!inviteEmail.trim()) { toast.error("メールアドレスを入力してください"); return; }
    const locIds = allLocations ? null : selectedLocationIds;
    if (!allLocations && selectedLocationIds.length === 0) {
      toast.error("アクセスを許可する店舗を選択してください"); return;
    }
    setLoading(true);
    const { error } = await supabase.functions.invoke("send-team-invitation", {
      body: { email: inviteEmail.trim(), role: inviteRole, tenant_id: tenantId, location_ids: locIds },
    });
    setLoading(false);
    if (error) { toast.error("招待送信に失敗しました"); return; }
    toast.success("招待メールを送信しました");
    setInviteEmail("");
    setSelectedLocationIds([]);
    setAllLocations(true);
    load();
  };

  const toggleLocation = (id: string) => {
    setSelectedLocationIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const removeInvite = async (id: string) => {
    await supabase.from("tenant_invitations").delete().eq("id", id);
    load();
  };

  const removeMember = async (userId: string) => {
    if (!confirm("本当に削除しますか？")) return;
    await supabase.from("tenant_members").delete().eq("tenant_id", tenantId!).eq("user_id", userId);
    load();
  };

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">チームメンバー</h1>
          <p className="text-muted-foreground">サロンスタッフをアプリに招待して、一緒に運用できます。</p>
        </div>

        {canManage && (
          <Card className="p-6 space-y-4">
            <h2 className="font-semibold">新しいメンバーを招待</h2>
            <div className="flex gap-2">
              <Input placeholder="email@example.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} className="flex-1" />
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="staff">スタッフ</SelectItem>
                  <SelectItem value="manager">マネージャー</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={sendInvite} disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4 mr-2" />}招待
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              スタッフ：日常業務のみ / マネージャー：設定変更まで可能
            </p>
            {locations.length > 1 && (
              <div className="space-y-2 pt-2 border-t">
                <Label className="text-sm font-medium">アクセスを許可する店舗</Label>
                <div className="flex items-center gap-2">
                  <Checkbox id="all-locs" checked={allLocations} onCheckedChange={(v) => setAllLocations(!!v)} />
                  <label htmlFor="all-locs" className="text-sm cursor-pointer">全店舗にアクセス可</label>
                </div>
                {!allLocations && (
                  <div className="space-y-2 pl-6">
                    {locations.map((loc) => (
                      <div key={loc.id} className="flex items-center gap-2">
                        <Checkbox
                          id={`loc-${loc.id}`}
                          checked={selectedLocationIds.includes(loc.id)}
                          onCheckedChange={() => toggleLocation(loc.id)}
                        />
                        <label htmlFor={`loc-${loc.id}`} className="text-sm cursor-pointer">{loc.name}</label>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>
        )}

        <Card className="p-6">
          <h2 className="font-semibold mb-4">現在のメンバー</h2>
          <div className="space-y-3">
            {members.map((m) => (
              <div key={m.user_id} className="flex items-center justify-between border-b pb-3 last:border-0">
                <div>
                  <p className="font-medium">{(m as any).profiles?.full_name ?? m.user_id.slice(0, 8)}</p>
                  <p className="text-xs text-muted-foreground">{m.user_id}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge>{m.role}</Badge>
                  {canManage && m.role !== "owner" && (
                    <Button size="sm" variant="ghost" onClick={() => removeMember(m.user_id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>

        {invites.length > 0 && (
          <Card className="p-6">
            <h2 className="font-semibold mb-4">送信済み招待</h2>
            <div className="space-y-3">
              {invites.map((i) => (
                <div key={i.id} className="flex items-center justify-between border-b pb-3 last:border-0">
                  <div>
                    <p className="font-medium">{i.email}</p>
                    <p className="text-xs text-muted-foreground">
                      期限: {new Date(i.expires_at).toLocaleDateString("ja-JP")}
                      {" / "}
                      {i.location_ids && i.location_ids.length > 0
                        ? `${i.location_ids.length}店舗のみ`
                        : "全店舗アクセス"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{i.role}</Badge>
                    {canManage && (
                      <Button size="sm" variant="ghost" onClick={() => removeInvite(i.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </AppLayout>
  );
};

export default Team;
