import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, Check } from "lucide-react";
import { toast } from "sonner";

const InviteAccept = () => {
  const { token } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async () => {
    if (!token) return;
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("accept-tenant-invitation", { body: { token } });
    setLoading(false);
    if (error || !data?.success) { setError(data?.error ?? "招待の受諾に失敗しました"); return; }
    setDone(true);
    toast.success("チームに参加しました");
    setTimeout(() => navigate("/dashboard"), 1500);
  };

  useEffect(() => {
    if (!authLoading && !user) {
      // 未ログインなら登録/ログインへ
      navigate(`/auth?invite=${token}`);
    }
  }, [user, authLoading, token, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="max-w-md w-full p-8 space-y-4 text-center">
        <h1 className="text-2xl font-bold">サロンへの招待</h1>
        {done ? (
          <div className="space-y-3">
            <Check className="w-12 h-12 text-green-600 mx-auto" />
            <p>チームに参加しました。ダッシュボードへ移動します...</p>
          </div>
        ) : error ? (
          <p className="text-red-600 text-sm">{error}</p>
        ) : (
          <>
            <p className="text-muted-foreground">招待を受諾してチームに参加します。</p>
            <Button className="w-full" onClick={accept} disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}招待を受諾する
            </Button>
          </>
        )}
      </Card>
    </div>
  );
};

export default InviteAccept;
