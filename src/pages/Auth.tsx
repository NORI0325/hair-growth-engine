import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { publicAppUrl } from "@/lib/public-origin";

const loginSchema = z.object({
  email: z.string().email("有効なメールアドレスを入力してください"),
  password: z.string().min(6, "パスワードは6文字以上で入力してください"),
});

const signupSchema = z.object({
  email: z.string().email("有効なメールアドレスを入力してください"),
  password: z.string().min(8, "パスワードは8文字以上にしてください").max(72),
  full_name: z.string().min(1, "お名前を入力してください").max(100),
  salon_name: z.string().min(1, "サロン名を入力してください").max(100),
  agree: z.literal(true, { errorMap: () => ({ message: "利用規約への同意が必要です" }) }),
});

const Auth = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"login" | "signup">("login");

  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [signupForm, setSignupForm] = useState({ email: "", password: "", full_name: "", salon_name: "", agree: false });

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

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = signupSchema.safeParse(signupForm);
    if (!parsed.success) { toast.error(parsed.error.errors[0].message); return; }
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        emailRedirectTo: publicAppUrl("/onboarding"),
        data: { full_name: parsed.data.full_name, salon_name: parsed.data.salon_name },
      },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message.includes("already registered") ? "このメールアドレスは既に登録済みです" : error.message);
      return;
    }
    toast.success("確認メールを送信しました。メール内のリンクをクリックしてください。");
  };

  const handleGoogle = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: publicAppUrl("/onboarding") },
    });
    if (error) { setLoading(false); toast.error(error.message); }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex relative bg-primary text-primary-foreground p-16 flex-col justify-between overflow-hidden">
        <div className="font-serif-en text-2xl tracking-luxury text-gold">SB</div>
        <div className="space-y-8 max-w-md animate-fade-up">
          <p className="eyebrow text-primary-foreground/50">— A New Chapter —</p>
          <h2 className="display text-4xl leading-snug">
            眠ったお客様を、<br />
            <span className="font-serif-en italic text-gold">おもてなしで</span><br />
            呼び戻す。
          </h2>
          <div className="hairline w-16 opacity-60" />
          <p className="text-sm text-primary-foreground/60 leading-loose">
            Salon Boostは、選ばれ続けるサロンのためにつくられた、最強のCRM。
          </p>
          <div className="text-xs text-primary-foreground/50 leading-loose space-y-1 pt-4">
            <p>✓ 60日間 無料トライアル</p>
            <p>✓ 月額 ¥9,800（シンプル1プラン）</p>
            <p>✓ いつでもキャンセル可能</p>
          </div>
        </div>
        <div className="text-xs text-primary-foreground/40 tracking-luxury">EST. 2026</div>
      </div>

      <div className="flex items-center justify-center p-8 lg:p-16 bg-background">
        <div className="w-full max-w-sm animate-fade-up">
          <p className="eyebrow mb-3">— Salon Boost —</p>
          <h1 className="display text-3xl mb-2">サロンオーナー専用</h1>
          <p className="text-sm text-muted-foreground mb-8">サロンの新しい章を始めます。</p>

          <Tabs value={tab} onValueChange={(v) => setTab(v as "login" | "signup")} className="w-full">
            <TabsList className="grid grid-cols-2 w-full mb-6">
              <TabsTrigger value="login">ログイン</TabsTrigger>
              <TabsTrigger value="signup">新規登録</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <form onSubmit={handleLogin} className="space-y-5">
                <div>
                  <Label htmlFor="login-email" className="mb-2 block text-sm">メールアドレス</Label>
                  <Input id="login-email" type="email" value={loginForm.email}
                    onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })} required autoComplete="email" />
                </div>
                <div>
                  <Label htmlFor="login-password" className="mb-2 block text-sm">パスワード</Label>
                  <Input id="login-password" type="password" value={loginForm.password}
                    onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} required autoComplete="current-password" />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}ログイン
                </Button>
                <div className="text-center">
                  <Link to="/forgot-password" className="text-xs text-muted-foreground underline hover:text-foreground transition-colors">
                    パスワードをお忘れですか？
                  </Link>
                </div>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={handleSignup} className="space-y-4">
                <div>
                  <Label htmlFor="su-salon" className="mb-2 block text-sm">サロン名</Label>
                  <Input id="su-salon" value={signupForm.salon_name}
                    onChange={(e) => setSignupForm({ ...signupForm, salon_name: e.target.value })} required placeholder="例: ARUNE Hair" />
                </div>
                <div>
                  <Label htmlFor="su-name" className="mb-2 block text-sm">オーナー氏名</Label>
                  <Input id="su-name" value={signupForm.full_name}
                    onChange={(e) => setSignupForm({ ...signupForm, full_name: e.target.value })} required placeholder="山田 太郎" />
                </div>
                <div>
                  <Label htmlFor="su-email" className="mb-2 block text-sm">メールアドレス</Label>
                  <Input id="su-email" type="email" value={signupForm.email}
                    onChange={(e) => setSignupForm({ ...signupForm, email: e.target.value })} required autoComplete="email" />
                </div>
                <div>
                  <Label htmlFor="su-password" className="mb-2 block text-sm">パスワード（8文字以上）</Label>
                  <Input id="su-password" type="password" value={signupForm.password}
                    onChange={(e) => setSignupForm({ ...signupForm, password: e.target.value })} required autoComplete="new-password" />
                </div>
                <div className="flex items-start gap-2 pt-2">
                  <Checkbox id="agree" checked={signupForm.agree}
                    onCheckedChange={(c) => setSignupForm({ ...signupForm, agree: !!c })} />
                  <label htmlFor="agree" className="text-xs text-muted-foreground leading-relaxed">
                    <Link to="/terms" target="_blank" className="underline">利用規約</Link>と
                    <Link to="/privacy" target="_blank" className="underline">プライバシーポリシー</Link>に同意します
                  </label>
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}60日間 無料で始める
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          <div className="my-6 flex items-center gap-3">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground">または</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          <Button variant="outline" className="w-full" onClick={handleGoogle} disabled={loading}>
            <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            Googleで続ける
          </Button>

          <p className="mt-8 text-xs text-muted-foreground text-center">
            ご質問は <a href="mailto:support@saronboost.com" className="underline">support@saronboost.com</a> まで
          </p>
        </div>
      </div>
    </div>
  );
};

export default Auth;
