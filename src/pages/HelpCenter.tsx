import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Search, ChevronLeft, ChevronRight, BookOpen, Clock,
  ThumbsUp, ThumbsDown, Sparkles, ArrowRight, Tag,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";

type Article = {
  slug: string;
  category: string;
  title: string;
  summary: string | null;
  body: string;
  sort_order: number;
  reading_minutes: number;
  tags: string[];
  related_slugs: string[];
  cover_image_url: string | null;
  video_url: string | null;
  helpful_yes: number;
  helpful_no: number;
};

const POPULAR_SLUGS = ["getting-started", "salonboard-import", "line-setup", "inbound-email", "reactivation"];

const HelpCenter = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [articles, setArticles] = useState<Article[]>([]);
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [activeTag, setActiveTag] = useState<string | null>(params.get("tag"));
  const [feedback, setFeedback] = useState<Record<string, boolean>>({});

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("help_articles")
        .select("slug,category,title,summary,body,sort_order,reading_minutes,tags,related_slugs,cover_image_url,video_url,helpful_yes,helpful_no")
        .eq("published", true)
        .order("sort_order");
      setArticles((data as Article[]) ?? []);
    })();
  }, []);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("help_article_feedback")
        .select("article_slug,helpful")
        .eq("user_id", user.id);
      const map: Record<string, boolean> = {};
      (data ?? []).forEach((f: any) => { map[f.article_slug] = f.helpful; });
      setFeedback(map);
    })();
  }, [user]);

  // Sync query/tag to URL
  useEffect(() => {
    const next = new URLSearchParams(params);
    if (query) next.set("q", query); else next.delete("q");
    if (activeTag) next.set("tag", activeTag); else next.delete("tag");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, activeTag]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    articles.forEach((a) => a.tags?.forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [articles]);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = articles.filter((a) => {
      if (activeTag && !a.tags?.includes(activeTag)) return false;
      if (!q) return true;
      return (a.title + (a.summary ?? "") + a.body + (a.tags?.join(" ") ?? "")).toLowerCase().includes(q);
    });
    const map = new Map<string, Article[]>();
    for (const a of filtered) {
      if (!map.has(a.category)) map.set(a.category, []);
      map.get(a.category)!.push(a);
    }
    return Array.from(map.entries());
  }, [articles, query, activeTag]);

  const popular = useMemo(
    () => POPULAR_SLUGS.map((s) => articles.find((a) => a.slug === s)).filter(Boolean) as Article[],
    [articles],
  );

  const current = slug ? articles.find((a) => a.slug === slug) : null;
  const currentIndex = current ? articles.findIndex((a) => a.slug === current.slug) : -1;
  const prev = currentIndex > 0 ? articles[currentIndex - 1] : null;
  const next = currentIndex >= 0 && currentIndex < articles.length - 1 ? articles[currentIndex + 1] : null;
  const related = useMemo(() => {
    if (!current) return [];
    return (current.related_slugs ?? [])
      .map((s) => articles.find((a) => a.slug === s))
      .filter(Boolean) as Article[];
  }, [current, articles]);

  // Auto-generate TOC from h2 in body
  const toc = useMemo(() => {
    if (!current) return [];
    const lines = current.body.split("\n");
    return lines
      .filter((l) => /^##\s/.test(l))
      .map((l) => l.replace(/^##\s/, "").trim())
      .map((t) => ({ text: t, id: t.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "") }));
  }, [current]);

  const submitFeedback = async (helpful: boolean) => {
    if (!current || !user) {
      toast.error("ログインが必要です");
      return;
    }
    const { error } = await supabase
      .from("help_article_feedback")
      .upsert({ article_slug: current.slug, user_id: user.id, helpful }, { onConflict: "article_slug,user_id" });
    if (error) {
      toast.error("送信に失敗しました");
      return;
    }
    setFeedback({ ...feedback, [current.slug]: helpful });
    toast.success(helpful ? "ありがとうございます！" : "改善の参考にします");
  };

  const askAI = (q: string) => {
    window.dispatchEvent(new CustomEvent("help:openchat", { detail: { prefill: q } }));
  };

  return (
    <AppLayout>
      <PageHeader
        eyebrow="— Help Center —"
        title="ヘルプ"
        description="マニュアル・よくある質問・サポート"
      />

      {!current && (
        <>
          {/* Search + AI hero */}
          <div className="mb-8 max-w-3xl">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="キーワード・機能名・困りごとで検索（例：LINE、サロンボード、リマインダー）"
                className="pl-9 h-12 text-base"
              />
            </div>
            {query.trim() && grouped.length === 0 && (
              <Card className="mt-3 p-5 border-gold/40 bg-gold/5">
                <div className="flex items-start gap-3">
                  <Sparkles className="w-5 h-5 text-gold mt-0.5" />
                  <div className="flex-1">
                    <p className="font-serif text-sm mb-1">該当する記事がありません</p>
                    <p className="text-xs text-muted-foreground mb-3">
                      AI サポートに聞いてみませんか？マニュアル全文を学習しています。
                    </p>
                    <Button size="sm" onClick={() => askAI(query)} className="rounded-none">
                      <Sparkles className="w-3.5 h-3.5 mr-2" />
                      「{query}」をAIに質問
                    </Button>
                  </div>
                </div>
              </Card>
            )}
          </div>

          {/* Tag chips */}
          {allTags.length > 0 && (
            <div className="mb-8 flex flex-wrap gap-2">
              <button
                onClick={() => setActiveTag(null)}
                className={`text-[11px] px-3 py-1 border ${!activeTag ? "border-gold text-gold" : "border-border text-muted-foreground hover:border-foreground"}`}
              >
                すべて
              </button>
              {allTags.map((t) => (
                <button
                  key={t}
                  onClick={() => setActiveTag(activeTag === t ? null : t)}
                  className={`text-[11px] px-3 py-1 border ${activeTag === t ? "border-gold text-gold" : "border-border text-muted-foreground hover:border-foreground"}`}
                >
                  #{t}
                </button>
              ))}
            </div>
          )}

          {/* Popular */}
          {!query && !activeTag && popular.length > 0 && (
            <section className="mb-12">
              <p className="eyebrow text-[10px] text-gold mb-4">— Most Read —</p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {popular.map((a) => (
                  <Link key={a.slug} to={`/help/${a.slug}`}>
                    <Card className="p-5 h-full hover:border-gold transition-colors group">
                      <div className="flex items-start justify-between mb-2">
                        <Badge variant="outline" className="text-[9px]">{a.category}</Badge>
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {a.reading_minutes}分
                        </span>
                      </div>
                      <h3 className="font-serif text-base mb-1 group-hover:text-gold transition-colors">{a.title}</h3>
                      {a.summary && (
                        <p className="text-xs text-muted-foreground line-clamp-2">{a.summary}</p>
                      )}
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Categories */}
          <div className="space-y-10">
            {grouped.map(([cat, items]) => (
              <section key={cat}>
                <p className="eyebrow text-[10px] text-gold mb-4">— {cat} —</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {items.map((a) => (
                    <Link key={a.slug} to={`/help/${a.slug}`}>
                      <Card className="p-5 hover:border-gold transition-colors h-full group">
                        <div className="flex items-start gap-3">
                          <BookOpen className="w-4 h-4 text-gold mt-1 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <h3 className="font-serif text-base group-hover:text-gold transition-colors line-clamp-1">{a.title}</h3>
                              <span className="text-[10px] text-muted-foreground flex items-center gap-1 shrink-0">
                                <Clock className="w-3 h-3" />{a.reading_minutes}分
                              </span>
                            </div>
                            {a.summary && (
                              <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{a.summary}</p>
                            )}
                            {a.tags?.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {a.tags.slice(0, 3).map((t) => (
                                  <span key={t} className="text-[9px] px-1.5 py-0.5 bg-muted text-muted-foreground">#{t}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </Card>
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}

      {current && (
        <article className="max-w-5xl">
          {/* Breadcrumb */}
          <nav className="text-xs text-muted-foreground mb-4 flex items-center gap-2">
            <button onClick={() => navigate("/help")} className="hover:text-gold flex items-center gap-1">
              <ChevronLeft className="w-3 h-3" /> ヘルプ
            </button>
            <span>/</span>
            <span>{current.category}</span>
            <span>/</span>
            <span className="text-foreground">{current.title}</span>
          </nav>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-10">
            {/* Main */}
            <div>
              <p className="eyebrow text-[10px] text-gold mb-2">— {current.category} —</p>
              <h2 className="font-serif text-3xl mb-3">{current.title}</h2>
              <div className="flex items-center gap-4 text-xs text-muted-foreground mb-6 pb-6 border-b border-border">
                <span className="flex items-center gap-1"><Clock className="w-3 h-3" />読了 {current.reading_minutes}分</span>
                {current.tags?.length > 0 && (
                  <span className="flex items-center gap-1">
                    <Tag className="w-3 h-3" />
                    {current.tags.slice(0, 3).join(" / ")}
                  </span>
                )}
              </div>

              {current.cover_image_url && (
                <img src={current.cover_image_url} alt={current.title} className="w-full mb-6 border border-border" />
              )}

              {current.video_url && (
                <div className="aspect-video mb-6 border border-border bg-muted">
                  <iframe src={current.video_url} className="w-full h-full" allowFullScreen title={current.title} />
                </div>
              )}

              <div className="prose prose-sm max-w-none prose-headings:font-serif prose-h1:text-2xl prose-h2:text-xl prose-h3:text-base prose-img:border prose-img:border-border">
                <ReactMarkdown>{current.body}</ReactMarkdown>
              </div>

              {/* Helpful feedback */}
              <div className="mt-12 pt-6 border-t border-border">
                <p className="text-sm font-serif mb-3">この記事は役に立ちましたか？</p>
                <div className="flex gap-2">
                  <Button
                    variant={feedback[current.slug] === true ? "default" : "outline"}
                    size="sm"
                    onClick={() => submitFeedback(true)}
                    className="rounded-none"
                  >
                    <ThumbsUp className="w-3.5 h-3.5 mr-2" />
                    役に立った {current.helpful_yes > 0 && <span className="ml-1 opacity-60">({current.helpful_yes})</span>}
                  </Button>
                  <Button
                    variant={feedback[current.slug] === false ? "default" : "outline"}
                    size="sm"
                    onClick={() => submitFeedback(false)}
                    className="rounded-none"
                  >
                    <ThumbsDown className="w-3.5 h-3.5 mr-2" />
                    改善が必要 {current.helpful_no > 0 && <span className="ml-1 opacity-60">({current.helpful_no})</span>}
                  </Button>
                </div>
              </div>

              {/* Ask AI about this article */}
              <Card className="mt-6 p-5 bg-gold/5 border-gold/30">
                <div className="flex items-start gap-3">
                  <Sparkles className="w-5 h-5 text-gold mt-0.5" />
                  <div className="flex-1">
                    <p className="font-serif text-sm mb-1">この記事についてAIに質問</p>
                    <p className="text-xs text-muted-foreground mb-3">
                      手順で詰まった点や応用したいケースを、その場で AI に聞けます。
                    </p>
                    <Button size="sm" onClick={() => askAI(`「${current.title}」について教えてください`)} className="rounded-none">
                      AIサポートを開く <ArrowRight className="w-3.5 h-3.5 ml-2" />
                    </Button>
                  </div>
                </div>
              </Card>

              {/* Related */}
              {related.length > 0 && (
                <section className="mt-10">
                  <p className="eyebrow text-[10px] text-gold mb-3">— Related —</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {related.map((r) => (
                      <Link key={r.slug} to={`/help/${r.slug}`}>
                        <Card className="p-4 hover:border-gold transition-colors">
                          <p className="font-serif text-sm mb-1">{r.title}</p>
                          {r.summary && <p className="text-xs text-muted-foreground line-clamp-1">{r.summary}</p>}
                        </Card>
                      </Link>
                    ))}
                  </div>
                </section>
              )}

              {/* Prev / Next */}
              <div className="mt-10 grid grid-cols-2 gap-3">
                {prev ? (
                  <Link to={`/help/${prev.slug}`}>
                    <Card className="p-4 hover:border-gold transition-colors h-full">
                      <p className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
                        <ChevronLeft className="w-3 h-3" /> 前の記事
                      </p>
                      <p className="font-serif text-sm">{prev.title}</p>
                    </Card>
                  </Link>
                ) : <div />}
                {next ? (
                  <Link to={`/help/${next.slug}`}>
                    <Card className="p-4 hover:border-gold transition-colors h-full text-right">
                      <p className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1 justify-end">
                        次の記事 <ChevronRight className="w-3 h-3" />
                      </p>
                      <p className="font-serif text-sm">{next.title}</p>
                    </Card>
                  </Link>
                ) : <div />}
              </div>
            </div>

            {/* TOC sidebar */}
            {toc.length > 0 && (
              <aside className="hidden lg:block">
                <div className="sticky top-6 border-l border-border pl-4">
                  <p className="eyebrow text-[10px] text-gold mb-3">— Contents —</p>
                  <ul className="space-y-2">
                    {toc.map((t) => (
                      <li key={t.id}>
                        <a href={`#${t.id}`} className="text-xs text-muted-foreground hover:text-gold block">
                          {t.text}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              </aside>
            )}
          </div>
        </article>
      )}
    </AppLayout>
  );
};

export default HelpCenter;
