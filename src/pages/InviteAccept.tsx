import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Loader2, Check } from "lucide-react";
import { toast } from "sonner";

const InviteAccept = () => {
  const { token } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triedRef = useRef(false);

  // マジックリンクからの遷移：URLハッシュにaccess_tokenが含まれている場合、Supabase SDKが自動でセッションを確立する
  // → useAuth が user を返してきたら自動で受諾処理を実行
  useEffect(() => {
    if (authLoading) return;
    if (!token) return;

    if (!user) {
      // 万が一未ログインなら従来のログインフローへ（招待トークンを保持）
      navigate(`/auth?invite=${token}`);
      return;
    }

    if (triedRef.current) return;
    triedRef.current = true;

    (async () => {
      const { data, error } = await supabase.functions.invoke("accept-tenant-invitation", { body: { token } });
      if (error || !data?.success) {
        setError(data?.error ?? "招待の受諾に失敗しました");
        return;
      }
      setDone(true);
      toast.success("チームに参加しました。続けてパスワードを設定してください。");
      setTimeout(() => navigate("/reset-password?initial=1", { replace: true }), 1200);
    })();
  }, [user, authLoading, token, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="max-w-md w-full p-8 space-y-4 text-center">
        <h1 className="text-2xl font-bold">サロンへの招待</h1>
        {done ? (
          <div className="space-y-3">
            <Check className="w-12 h-12 text-green-600 mx-auto" />
            <p>チームに参加しました。</p>
            <p className="text-sm text-muted-foreground">続けてログイン用パスワードを設定する画面へ移動します...</p>
          </div>
        ) : error ? (
          <p className="text-red-600 text-sm">{error}</p>
        ) : (
          <div className="space-y-3">
            <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto" />
            <p className="text-muted-foreground">ログインして招待を受諾しています...</p>
          </div>
        )}
      </Card>
    </div>
  );
};

export default InviteAccept;
