import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Store, Star, ExternalLink } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import RequireRole from "@/components/RequireRole";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLocations, type Location } from "@/hooks/useLocations";
import { useTenantId } from "@/hooks/useTenant";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const getEnvironment = (): "sandbox" | "live" => {
  const token = (import.meta as any).env?.VITE_PAYMENTS_CLIENT_TOKEN;
  return token?.startsWith("pk_live_") ? "live" : "sandbox";
};

const Locations = () => {
  const tenantId = useTenantId();
  const { data: locations = [], isLoading } = useLocations();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<Location | null>(null);

  const additionalCount = Math.max(0, locations.length - 1);
  const monthlyTotal = 9800 + additionalCount * 7800;

  const addLocation = useMutation({
    mutationFn: async () => {
      if (!tenantId || !newName.trim()) throw new Error("店舗名を入力してください");
      const { data, error } = await supabase.functions.invoke("add-location", {
        body: { tenant_id: tenantId, name: newName.trim(), environment: getEnvironment() },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      toast.success("店舗を追加しました");
      setAddOpen(false);
      setNewName("");
      queryClient.invalidateQueries({ queryKey: ["locations"] });
      queryClient.invalidateQueries({ queryKey: ["subscription"] });
    },
    onError: (e: Error) => toast.error(`追加に失敗しました: ${e.message}`),
  });

  const removeLocation = useMutation({
    mutationFn: async (location: Location) => {
      const { data, error } = await supabase.functions.invoke("remove-location", {
        body: { location_id: location.id, environment: getEnvironment() },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      toast.success("店舗を削除しました");
      setConfirmDelete(null);
      queryClient.invalidateQueries({ queryKey: ["locations"] });
      queryClient.invalidateQueries({ queryKey: ["subscription"] });
    },
    onError: (e: Error) => toast.error(`削除に失敗しました: ${e.message}`),
  });

  return (
    <RequireRole role="owner">
      <AppLayout>
        <div className="space-y-8">
          <div>
            <div className="eyebrow text-[10px] text-muted-foreground mb-2">Locations</div>
            <h1 className="font-serif text-3xl mb-2">店舗管理</h1>
            <p className="text-sm text-muted-foreground">
              複数店舗を1つのアカウントで管理できます。1店舗目は¥9,800/月、2店舗目以降は¥7,800/月。
            </p>
          </div>

          {/* 料金サマリー */}
          <Card className="p-6 bg-muted/30">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <div className="eyebrow text-[10px] text-muted-foreground mb-1">Monthly Total</div>
                <div className="font-serif text-2xl">
                  ¥{monthlyTotal.toLocaleString()}
                  <span className="text-sm text-muted-foreground ml-2">/ 月（税抜）</span>
                </div>
                <div className="text-xs text-muted-foreground mt-2">
                  Standard ¥9,800 + 追加店舗 ¥7,800 × {additionalCount}
                </div>
              </div>
              <Button onClick={() => setAddOpen(true)} className="gap-2">
                <Plus className="w-4 h-4" />
                店舗を追加
              </Button>
            </div>
          </Card>

          {/* 店舗一覧 */}
          {isLoading ? (
            <div className="text-sm text-muted-foreground">読み込み中...</div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {locations.map((loc) => (
                <Card key={loc.id} className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded bg-gold/10 flex items-center justify-center">
                        <Store className="w-5 h-5 text-gold" />
                      </div>
                      <div>
                        <div className="font-serif text-lg">{loc.name}</div>
                        {loc.is_primary && (
                          <Badge variant="secondary" className="mt-1 gap-1">
                            <Star className="w-3 h-3" />
                            本店
                          </Badge>
                        )}
                      </div>
                    </div>
                    {!loc.is_primary && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setConfirmDelete(loc)}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    )}
                  </div>

                  {loc.public_slug && (
                    <a
                      href={`/salon/${loc.public_slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                    >
                      <ExternalLink className="w-3 h-3" />
                      /salon/{loc.public_slug}
                    </a>
                  )}
                </Card>
              ))}
            </div>
          )}

          <Card className="p-6 bg-amber-50 border-amber-200">
            <div className="text-sm">
              <div className="font-medium mb-2">📌 ご注意</div>
              <ul className="space-y-1 text-muted-foreground list-disc list-inside">
                <li>店舗追加・削除の課金は日割りで即時反映されます。</li>
                <li>本店（最初の店舗）は削除できません。本店を変更したい場合はサポートまで。</li>
                <li>各店舗ごとに営業時間・スタッフ・メニュー・公開URLを個別管理できます。</li>
              </ul>
            </div>
          </Card>
        </div>

        {/* 追加ダイアログ */}
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>新しい店舗を追加</DialogTitle>
              <DialogDescription>
                追加店舗は¥7,800/月（税抜）です。日割りで即時課金されます。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="name">店舗名</Label>
                <Input
                  id="name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="例: 渋谷店"
                  maxLength={50}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddOpen(false)}>キャンセル</Button>
              <Button
                onClick={() => addLocation.mutate()}
                disabled={!newName.trim() || addLocation.isPending}
              >
                {addLocation.isPending ? "追加中..." : "追加する"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 削除確認 */}
        <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>店舗を削除しますか？</AlertDialogTitle>
              <AlertDialogDescription>
                「{confirmDelete?.name}」を削除します。日割りで返金され、月額料金が¥7,800減額されます。
                <br />
                <strong className="text-destructive">この操作は元に戻せません。</strong>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>キャンセル</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => confirmDelete && removeLocation.mutate(confirmDelete)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                削除する
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </AppLayout>
    </RequireRole>
  );
};

export default Locations;
