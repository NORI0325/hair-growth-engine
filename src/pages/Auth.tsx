import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

const loginSchema = z.object({
  email: z.string().email("有効なメールアドレスを入力してください"),
  password: z.string().min(6, "パスワードは6文字以上で入力してください"),
});

const Auth = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(false);

  const [loginForm, setLoginForm] = useState({ email: "", password: "" });

  useEffect(() => {
    if (!authLoading && user) navigate("/dashboard", { replace: true });
  }, [user, authLoading, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = loginSchema.safeParse(loginForm);
    if (!parsed.success) { toast.error(parsed.error.errors[0].message); return; }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
    setLoading(false);
    if (error) {
      toast.error(error.message === "Invalid login credentials" ? "メールアドレスまたはパスワードが間違っています" : error.message);
      return;
    }
    toast.success("ようこそ");
    navigate("/dashboard");
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left visual */}
      <div className="hidden lg:flex relative bg-primary text-primary-foreground p-16 flex-col justify-between overflow-hidden">
        <div className="font-serif-en text-2xl tracking-luxury text-gold">SB</div>
        <div className="space-y-8 max-w-md animate-fade-up">
          <p className="eyebrow text-primary-foreground/50">— A New Chapter —</p>
          <h2 className="display text-4xl leading-snug">
            眠ったお客様を、<br />
            <span className="font-serif-en italic text-gold">最も美しい形で</span><br />
            呼び戻す。
          </h2>
          <div className="hairline w-16 opacity-60" />
          <p className="text-sm text-primary-foreground/60 leading-loose">
            Salon Boostは、選ばれ続けるサロンのための、静かで力強いCRM。
          </p>
        </div>
        <div className="text-xs text-primary-foreground/40 tracking-luxury">EST. 2026</div>
      </div>

      {/* Right form */}
      <div className="flex items-center justify-center p-8 lg:p-16 bg-background">
        <div className="w-full max-w-sm animate-fade-up">
          <p className="eyebrow mb-3">— For Owners Only —</p>
          <h1 className="display text-3xl mb-2">オーナー専用</h1>
          <p className="text-sm text-muted-foreground mb-10">サロンの新しい章を始めます。</p>
          <div className="hairline mb-10" />

          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <Label htmlFor="login-email" className="mb-2 block font-serif text-sm">メールアドレス <span className="eyebrow text-[9px] text-muted-foreground ml-1">Email</span></Label>
              <Input id="login-email" type="email" value={loginForm.email}
                onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
                required autoComplete="email" className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
            </div>
            <div>
              <Label htmlFor="login-password" className="mb-2 block font-serif text-sm">パスワード <span className="eyebrow text-[9px] text-muted-foreground ml-1">Password</span></Label>
              <Input id="login-password" type="password" value={loginForm.password}
                onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                required autoComplete="current-password" className="rounded-none border-x-0 border-t-0 px-0 focus-visible:ring-0 focus-visible:border-gold" />
            </div>
            <Button type="submit" className="w-full rounded-none py-6 text-xs tracking-luxury bg-primary hover:bg-primary-glow" disabled={loading}>
              {loading && <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />}
              ログイン <span className="ml-2 opacity-60 text-[10px]">SIGN IN</span>
            </Button>
          </form>

          <p className="mt-10 text-xs text-muted-foreground leading-loose tracking-wide">
            — By Invitation Only —<br />
            新規アカウントは招待制です。ご利用をご希望の方は、運営までお問い合わせください。
          </p>
        </div>
      </div>
    </div>
  );
};

export default Auth;
