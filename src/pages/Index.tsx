import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import hero1 from "@/assets/hero-1.jpg";
import hero2 from "@/assets/hero-2.jpg";
import hero3 from "@/assets/hero-3.jpg";

const HERO_SLIDES = [
  {
    image: hero1,
    eyebrow: "Chapter 01 — Reconnect",
    headline: ["眠ったお客様を、", "もう一度、", "灯す。"],
    accent: "灯す。",
  },
  {
    image: hero2,
    eyebrow: "Chapter 02 — One Tap",
    headline: ["指先ひとつで、", "再会までの距離を", "ゼロに。"],
    accent: "ゼロに。",
  },
  {
    image: hero3,
    eyebrow: "Chapter 03 — Boost",
    headline: ["売上を加速させる、", "サロンのための", "ブーストシステム。"],
    accent: "ブーストシステム。",
  },
];

const Index = () => {
  const [activeSlide, setActiveSlide] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setActiveSlide((prev) => (prev + 1) % HERO_SLIDES.length);
    }, 5500);
    return () => clearInterval(id);
  }, []);

  const current = HERO_SLIDES[activeSlide];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ヘッダー */}
      <header className="absolute top-0 left-0 right-0 z-50">
        <div className="container mx-auto px-8 py-6 flex justify-between items-center">
          <div className="flex items-center gap-3 text-primary-foreground">
            <div className="font-serif-en text-2xl tracking-luxury">SB</div>
            <div className="w-px h-6 bg-primary-foreground/30" />
            <div>
              <div className="font-serif text-sm tracking-wider">Salon Boost</div>
              <div className="eyebrow text-[10px] text-primary-foreground/60">Est. 2026</div>
            </div>
          </div>
          <nav className="hidden md:flex items-center gap-10 text-sm text-primary-foreground/90">
            <a href="#philosophy" className="gold-underline">Philosophy</a>
            <a href="#features" className="gold-underline">Features</a>
            <a href="#flow" className="gold-underline">Flow</a>
          </nav>
          <Link to="/auth">
            <Button variant="ghost" className="text-sm tracking-wider text-primary-foreground hover:text-gold hover:bg-transparent">
              SIGN IN
            </Button>
          </Link>
        </div>
      </header>

      {/* ヒーロー: フルスクリーン画像スライドショー */}
      <section className="relative h-screen min-h-[720px] overflow-hidden bg-primary">
        {/* 画像レイヤー */}
        <div className="absolute inset-0">
          {HERO_SLIDES.map((slide, idx) => (
            <div
              key={idx}
              className="absolute inset-0 transition-opacity duration-[1800ms] ease-in-out"
              style={{ opacity: idx === activeSlide ? 1 : 0 }}
            >
              <img
                src={slide.image}
                alt=""
                className="w-full h-full object-cover"
                style={{
                  animation: idx === activeSlide ? "ken-burns 8s ease-out forwards" : "none",
                }}
              />
              {/* オーバーレイ */}
              <div className="absolute inset-0 bg-gradient-to-r from-primary/90 via-primary/60 to-primary/30" />
              <div className="absolute inset-0 bg-gradient-to-t from-primary via-primary/20 to-transparent" />
            </div>
          ))}
        </div>

        {/* ノイズ/グレイン質感 */}
        <div
          className="absolute inset-0 opacity-[0.08] mix-blend-overlay pointer-events-none"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          }}
        />

        {/* 縦の罫線（サイバーエージェント風グリッド） */}
        <div className="absolute inset-0 grid grid-cols-12 pointer-events-none opacity-20">
          {Array.from({ length: 13 }).map((_, i) => (
            <div key={i} className="border-l border-primary-foreground/20 h-full" />
          ))}
        </div>

        {/* コンテンツ */}
        <div className="relative z-10 h-full container mx-auto px-8 flex flex-col justify-end pb-32 md:pb-40">
          <div className="max-w-5xl text-primary-foreground">
            {/* スライド番号 */}
            <div className="flex items-center gap-4 mb-6 animate-fade-in">
              <span className="font-serif-en text-gold text-sm tracking-luxury">
                {String(activeSlide + 1).padStart(2, "0")}
              </span>
              <div className="w-12 h-px bg-gold animate-glow-pulse" />
              <span className="font-serif-en text-primary-foreground/60 text-sm tracking-luxury">
                {String(HERO_SLIDES.length).padStart(2, "0")}
              </span>
            </div>

            {/* Eyebrow */}
            <p
              key={`eb-${activeSlide}`}
              className="eyebrow text-gold mb-6 animate-fade-up"
            >
              — {current.eyebrow} —
            </p>

            {/* メインコピー */}
            <h1
              key={`h-${activeSlide}`}
              className="display text-5xl md:text-7xl lg:text-8xl leading-[1.1] mb-10 animate-fade-up animate-delay-100"
            >
              {current.headline.map((line, i) => (
                <span key={i} className="block">
                  {line === current.accent ? (
                    <span className="font-serif-en italic text-gold">{line}</span>
                  ) : (
                    line
                  )}
                </span>
              ))}
            </h1>

            <div className="flex flex-col sm:flex-row gap-6 items-start sm:items-center animate-fade-up animate-delay-300">
              <Link to="/auth">
                <Button
                  size="lg"
                  className="px-12 py-7 text-sm tracking-luxury rounded-none bg-gold hover:bg-gold-light text-primary shadow-gold border-0"
                >
                  BOOST YOUR SALON →
                </Button>
              </Link>
              <a
                href="#philosophy"
                className="text-sm tracking-luxury text-primary-foreground/80 gold-underline"
              >
                SCROLL TO DISCOVER ↓
              </a>
            </div>
          </div>

          {/* スライドインジケーター */}
          <div className="absolute bottom-12 right-8 hidden md:flex flex-col gap-3">
            {HERO_SLIDES.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setActiveSlide(idx)}
                className="group flex items-center gap-3"
                aria-label={`Slide ${idx + 1}`}
              >
                <span
                  className={`font-serif-en text-xs tracking-luxury transition-all ${
                    idx === activeSlide ? "text-gold" : "text-primary-foreground/40"
                  }`}
                >
                  {String(idx + 1).padStart(2, "0")}
                </span>
                <span
                  className={`block h-px transition-all duration-500 ${
                    idx === activeSlide
                      ? "w-16 bg-gold"
                      : "w-8 bg-primary-foreground/30 group-hover:bg-primary-foreground/60"
                  }`}
                />
              </button>
            ))}
          </div>
        </div>

        {/* 下部マーキー（流れるテキスト） */}
        <div className="absolute bottom-0 left-0 right-0 border-t border-primary-foreground/10 bg-primary/80 backdrop-blur-sm py-4 overflow-hidden">
          <div className="flex animate-marquee whitespace-nowrap">
            {Array.from({ length: 2 }).map((_, dup) => (
              <div key={dup} className="flex items-center shrink-0">
                {[
                  "REACTIVATE DORMANT GUESTS",
                  "ONE-TAP BOOKING",
                  "AI-POWERED MESSAGING",
                  "REVENUE BOOST",
                  "LINE × EMAIL × SMS",
                  "FOR EVERY SALON",
                ].map((txt, i) => (
                  <span key={`${dup}-${i}`} className="flex items-center">
                    <span className="font-serif-en text-xs tracking-luxury text-primary-foreground/60 mx-8">
                      {txt}
                    </span>
                    <span className="text-gold">✦</span>
                  </span>
                ))}
              </div>
            ))}
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
                Salon Boostは、すでに信頼を寄せてくださったお客様との「関係」を、もう一度紡ぎ直すための魔法の道具です。
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
              { num: "i", title: "顧客資産の継承", en: "Customer Heritage", desc: "今までのお客様情報を、ワンタップで一括取込。\n紛らわしい作業は不要。\n最終来店日に応じて自動的に分類。" },
              { num: "ii", title: "心に届く配信", en: "Mindful Outreach", desc: "LINE・メール・SMS、二つの経路で。お一人おひとりのお名前を添えた、テンプレートでない言葉を届ける。温かみのある言葉は最強の武器です。" },
              { num: "iii", title: "ワンタップ予約", en: "Effortless Booking", desc: "メッセージから、最短3タップで予約完了。お客様は会員登録もログインも不要。" },
              { num: "iv", title: "静かな計測", en: "Quiet Analytics", desc: "配信から来店、そして売上まで。数字の奥にある「物語」を可視化する。Salon Boostでは１％の取りこぼしも許しません。" },
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
              { step: "01", title: "資産を、整える。", desc: "お持ちのお客様リストを取り込み、休眠・離脱予備軍・優良客に分類します。" },
              { step: "02", title: "言葉を、届ける。", desc: "「お久しぶりです」その一言を、最も適切なタイミングで、最も心に届く形で送ります。" },
              { step: "03", title: "再会を、迎える。", desc: "メッセージから流れるようにご予約。サロンには、懐かしい笑顔が戻ってきます。" },
            ].map((s) => (
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
          <h2 className="display text-4xl md:text-5xl mb-10 leading-relaxed">
            眠れる資産を、<span className="font-serif-en italic text-gold">今</span>、目覚めさせよ。
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
