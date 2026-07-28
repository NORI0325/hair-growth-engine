import { useState } from "react";
import { Link } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { publicAppUrl } from "@/lib/public-origin";

const schema = z.object({
  email: z.string().email("有効なメールアドレスを入力してください"),
});

const ForgotPassword = () => {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ email });
    if (!parsed.success) {
      toast.error(parsed.error.errors[0].message);
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: publicAppUrl("/reset-password"),
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSent(true);
    toast.success("再設定メールを送信しました");
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-8 bg-background">
      <div className="w-full max-w-sm animate-fade-up">
        <p className="eyebrow mb-3">— Reset Password —</p>
        <h1 className="display text-3xl mb-2">パスワード再設定</h1>
        <p className="text-sm text-muted-foreground mb-8">
          ご登録のメールアドレス宛に、再設定用のリンクをお送りします。
        </p>

        {sent ? (
          <div className="space-y-6">
            <div className="p-6 border border-border rounded-md bg-muted/30">
              <p className="text-sm leading-relaxed">
                <span className="font-medium">{email}</span> 宛に再設定メールを送信しました。
                メール内のリンクをクリックして、新しいパスワードをご設定ください。
              </p>
            </div>
            <Link to="/auth" className="block text-sm text-center text-muted-foreground underline">
              ログインページへ戻る
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <Label htmlFor="email" className="mb-2 block text-sm">メールアドレス</Label>
              <Input id="email" type="email" value={email}
                onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              再設定メールを送る
            </Button>
            <Link to="/auth" className="block text-sm text-center text-muted-foreground underline">
              ログインページへ戻る
            </Link>
          </form>
        )}
      </div>
    </div>
  );
};

export default ForgotPassword;
