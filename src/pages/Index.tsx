import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Scissors, Users, Mail, Calendar, TrendingUp, Sparkles } from "lucide-react";

const Index = () => {
  return (
    <div className="min-h-screen" style={{ background: "var(--gradient-soft)" }}>
      <header className="container mx-auto px-6 py-6 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "var(--gradient-primary)" }}>
            <Scissors className="w-5 h-5 text-primary-foreground" />
          </div>
          <h1 className="text-xl font-bold">Salon Boost</h1>
        </div>
        <Link to="/auth">
          <Button variant="outline">ログイン</Button>
        </Link>
      </header>

      <main className="container mx-auto px-6 py-16 text-center">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
          <Sparkles className="w-4 h-4" />
          美容室の売上を確実にアップ
        </div>
        <h2 className="text-5xl md:text-6xl font-bold mb-6 leading-tight">
          休眠客を呼び戻し、<br />
          <span style={{ background: "var(--gradient-primary)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            売上を最大化
          </span>
        </h2>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-10">
          眠っている顧客リストにメール＋SMSでクーポンを配信。<br />
          ワンタップ予約で来店までスムーズに繋げます。
        </p>
        <Link to="/auth">
          <Button size="lg" className="text-base px-8 py-6 shadow-lg" style={{ background: "var(--gradient-primary)" }}>
            無料で始める
          </Button>
        </Link>

        <div className="grid md:grid-cols-4 gap-6 mt-20">
          {[
            { icon: Users, title: "顧客一括管理", desc: "Excel/CSVから2000人を簡単インポート" },
            { icon: Mail, title: "メール＋SMS配信", desc: "セグメント別に最適な配信を自動化" },
            { icon: Calendar, title: "ワンタップ予約", desc: "顧客はメールから3タップで予約完了" },
            { icon: TrendingUp, title: "効果測定", desc: "配信→来店→売上を可視化" },
          ].map(({ icon: Icon, title, desc }) => (
            <Card key={title} className="p-6 text-left shadow-soft border-border/50">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                <Icon className="w-6 h-6 text-primary" />
              </div>
              <h3 className="font-bold mb-2">{title}</h3>
              <p className="text-sm text-muted-foreground">{desc}</p>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
};

export default Index;
