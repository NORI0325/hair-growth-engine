import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

const Index = () => {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ヘッダー */}
      <header className="border-b border-border/60">
        <div className="container mx-auto px-8 py-6 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="font-serif-en text-2xl tracking-luxury">SB</div>
            <div className="hairline-vertical h-6" />
            <div>
              <div className="font-serif text-sm tracking-wider">Salon Boost</div>
              <div className="eyebrow text-[10px]">Est. 2026</div>
            </div>
          </div>
          <nav className="hidden md:flex items-center gap-10 text-sm">
            <a href="#philosophy" className="gold-underline">Philosophy</a>
            <a href="#features" className="gold-underline">Features</a>
            <a href="#flow" className="gold-underline">Flow</a>
          </nav>
          <Link to="/auth">
            <Button variant="ghost" className="text-sm tracking-wider">
              SIGN IN
            </Button>
          </Link>
        </div>
      </header>

      {/* ヒーロー */}
      <section
        className="relative overflow-hidden"
        style={{ background: "var(--gradient-hero)" }}
      >
        <div className="container mx-auto px-8 py-32 md:py-40">
          <div className="max-w-4xl mx-auto text-center">
            <p className="eyebrow mb-8 animate-fade-up">— A New Chapter for Every Salon —</p>
            <h1 className="display text-5xl md:text-7xl mb-10 animate-fade-up animate-delay-100">
              眠っているお客様を、<br />
              <span className="text-gold font-serif-en italic">最も美しい形で</span><br />
              呼び戻す。
            </h1>
            <div className="hairline w-24 mx-auto my-10 animate-fade-up animate-delay-200" />
            <p className="text-base md:text-lg text-muted-foreground leading-loose max-w-2xl mx-auto mb-14 animate-fade-up animate-delay-200">
              一度信頼を寄せてくださったお客様こそ、美容室にとって最も尊い資産。<br />
              一人ひとりに寄り添う一通のメッセージと、ワンタップで完了する予約体験。<br />
              それは、もう一度「あの場所へ行きたい」と思わせる小さな魔法。
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center animate-fade-up animate-delay-300">
              <Link to="/auth">
                <Button size="lg" className="px-12 py-6 text-sm tracking-luxury rounded-none bg-primary hover:bg-primary-glow text-primary-foreground shadow-elegant">
                  BEGIN YOUR JOURNEY
                </Button>
              </Link>
              <a href="#philosophy" className="text-sm tracking-wider text-muted-foreground gold-underline">
                詳しく見る ↓
              </a>
            </div>
          </div>
        </div>
      </section>
              <Link to="/auth">
                <Button size="lg" className="px-12 py-6 text-sm tracking-luxury rounded-none bg-primary hover:bg-primary-glow text-primary-foreground shadow-elegant">
                  BEGIN YOUR JOURNEY
                </Button>
              </Link>
              <a href="#philosophy" className="text-sm tracking-wider text-muted-foreground gold-underline">
                詳しく見る ↓
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Philosophy */}
      <section id="philosophy" className="py-32 border-t border-border/60">
        <div className="container mx-auto px-8 max-w-5xl">
          <div className="grid md:grid-cols-12 gap-12 items-start">
            <div className="md:col-span-4">
              <p className="eyebrow mb-4">No.01 — Philosophy</p>
              <h2 className="display text-3xl md:text-4xl">
                売上は、<br />
                <span className="font-serif-en italic text-gold">関係</span>から<br />生まれる。
              </h2>
            </div>
            <div className="md:col-span-7 md:col-start-6 space-y-6 text-muted-foreground leading-loose">
              <p>
                新規客の獲得コストは、既存客の5倍と言われます。それでも、多くのサロンが「次の新規」を追い続けます。
              </p>
              <div className="hairline w-16" />
              <p>
                Salon Boostは、すでに信頼を寄せてくださったお客様との「関係」を、もう一度紡ぎ直すための道具です。
                派手な広告ではなく、静かに届く一通のメッセージ。煩わしい手続きではなく、指先一つで完結する予約。
              </p>
              <p>
                それが、選ばれ続けるサロンの作法だと、私たちは信じています。
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-32 bg-secondary/40 border-y border-border/60">
        <div className="container mx-auto px-8 max-w-6xl">
          <div className="text-center mb-20">
            <p className="eyebrow mb-4">No.02 — Capabilities</p>
            <h2 className="display text-3xl md:text-5xl">
              四つの<span className="font-serif-en italic text-gold">所作</span>
            </h2>
          </div>

          <div className="grid md:grid-cols-2 gap-x-16 gap-y-20">
            {[
              { num: "i", title: "顧客資産の継承", en: "Customer Heritage", desc: "Excel/CSVから2,000名のお客様情報を、一括で美しく整える。最終来店日に応じて自動的に分類。" },
              { num: "ii", title: "心に届く配信", en: "Mindful Outreach", desc: "メールとSMS、二つの経路で。お一人おひとりのお名前を添えた、テンプレートでない言葉を届ける。" },
              { num: "iii", title: "ワンタップ予約", en: "Effortless Booking", desc: "メッセージから、最短3タップで予約完了。お客様は会員登録もログインも不要。" },
              { num: "iv", title: "静かな計測", en: "Quiet Analytics", desc: "配信から来店、そして売上まで。数字の奥にある「物語」を可視化する。" },
            ].map((f) => (
              <div key={f.num} className="group">
                <div className="flex items-baseline gap-6 mb-4">
                  <span className="font-serif-en text-4xl text-gold italic">{f.num}.</span>
                  <div className="flex-1">
                    <h3 className="display text-xl mb-1">{f.title}</h3>
                    <p className="eyebrow text-[10px]">{f.en}</p>
                  </div>
                </div>
                <div className="hairline mb-4" />
                <p className="text-sm text-muted-foreground leading-loose pl-14">
                  {f.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Flow */}
      <section id="flow" className="py-32">
        <div className="container mx-auto px-8 max-w-5xl">
          <div className="text-center mb-20">
            <p className="eyebrow mb-4">No.03 — How It Works</p>
            <h2 className="display text-3xl md:text-5xl">
              三つの<span className="font-serif-en italic text-gold">時</span>
            </h2>
          </div>

          <div className="space-y-16">
            {[
              { step: "01", title: "資産を、整える。", desc: "お持ちのお客様リストを取り込み、休眠・離脱予備軍・優良客に静かに分類します。" },
              { step: "02", title: "言葉を、届ける。", desc: "「お久しぶりです」その一言を、最も適切なタイミングで、最も心に届く形で送ります。" },
              { step: "03", title: "再会を、迎える。", desc: "メッセージから流れるようにご予約。サロンには、懐かしい笑顔が戻ってきます。" },
            ].map((s, i) => (
              <div key={s.step} className="grid md:grid-cols-12 gap-8 items-center">
                <div className="md:col-span-3">
                  <div className="font-serif-en text-7xl text-gold/60 italic">{s.step}</div>
                </div>
                <div className="md:col-span-1 hidden md:block">
                  <div className="hairline-vertical h-20 mx-auto" />
                </div>
                <div className="md:col-span-8">
                  <h3 className="display text-2xl md:text-3xl mb-3">{s.title}</h3>
                  <p className="text-muted-foreground leading-loose">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-32 bg-primary text-primary-foreground">
        <div className="container mx-auto px-8 text-center max-w-3xl">
          <p className="eyebrow text-primary-foreground/60 mb-6">— Begin —</p>
          <h2 className="display text-4xl md:text-5xl mb-10">
            あなたのサロンの次の章を、<br />
            <span className="font-serif-en italic text-gold">今夜</span>はじめませんか。
          </h2>
          <div className="hairline w-24 mx-auto my-10 opacity-60" />
          <Link to="/auth">
            <Button size="lg" variant="outline" className="px-12 py-6 text-sm tracking-luxury rounded-none bg-transparent border-gold text-gold hover:bg-gold hover:text-primary">
              BEGIN YOUR JOURNEY
            </Button>
          </Link>
        </div>
      </section>

      <footer className="border-t border-border/60 py-10">
        <div className="container mx-auto px-8 flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-muted-foreground">
          <div className="font-serif-en tracking-luxury">SALON BOOST · EST. 2026</div>
          <div className="tracking-wider">For salons who care about every guest.</div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
