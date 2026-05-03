import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

const schema = z.object({
  password: z.string().min(8, "パスワードは8文字以上にしてください").max(72),
});

const ResetPassword = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initial = params.get("initial") === "1";
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Supabase puts recovery tokens in URL hash; onAuthStateChange fires PASSWORD_RECOVERY
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setReady(true);
      }
    });
    // Also check existing session in case user is already signed in via recovery link
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ password });
    if (!parsed.success) {
      toast.error(parsed.error.errors[0].message);
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("パスワードを更新しました");
    navigate("/dashboard", { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-8 bg-background">
      <div className="w-full max-w-sm animate-fade-up">
        <p className="eyebrow mb-3">— New Password —</p>
        <h1 className="display text-3xl mb-2">新しいパスワード</h1>
        <p className="text-sm text-muted-foreground mb-8">
          新しいパスワードをご設定ください。
        </p>

        {!ready ? (
          <div className="p-6 border border-border rounded-md bg-muted/30 text-sm leading-relaxed">
            このページはメール内のリンクからアクセスしてください。
            リンクの有効期限が切れている場合は、再度
            <a href="/forgot-password" className="underline mx-1">パスワード再設定</a>
            をお試しください。
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <Label htmlFor="new-password" className="mb-2 block text-sm">新しいパスワード（8文字以上）</Label>
              <Input id="new-password" type="password" value={password}
                onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              パスワードを更新
            </Button>
          </form>
        )}
      </div>
    </div>
  );
};

export default ResetPassword;
