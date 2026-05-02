import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import PageHeader from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Search, ChevronLeft, BookOpen } from "lucide-react";
import ReactMarkdown from "react-markdown";

type Article = {
  slug: string;
  category: string;
  title: string;
  summary: string | null;
  body: string;
  sort_order: number;
};

const HelpCenter = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [articles, setArticles] = useState<Article[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("help_articles")
        .select("slug,category,title,summary,body,sort_order")
        .eq("published", true)
        .order("sort_order");
      setArticles(data ?? []);
    })();
  }, []);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? articles.filter((a) =>
          (a.title + a.summary + a.body).toLowerCase().includes(q),
        )
      : articles;
    const map = new Map<string, Article[]>();
    for (const a of filtered) {
      if (!map.has(a.category)) map.set(a.category, []);
      map.get(a.category)!.push(a);
    }
    return Array.from(map.entries());
  }, [articles, query]);

  const current = slug ? articles.find((a) => a.slug === slug) : null;

  return (
    <AppLayout>
      <PageHeader
        eyebrow="— Help Center —"
        title="ヘルプ"
        description="マニュアル・よくある質問・サポートへの問い合わせ"
      />

      {!current && (
        <>
          <div className="mb-8 max-w-xl">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="キーワードで検索..."
                className="pl-9"
              />
            </div>
          </div>

          {grouped.length === 0 && (
            <p className="text-sm text-muted-foreground">該当する記事が見つかりませんでした。</p>
          )}

          <div className="space-y-10">
            {grouped.map(([cat, items]) => (
              <section key={cat}>
                <p className="eyebrow text-[10px] text-gold mb-4">— {cat} —</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {items.map((a) => (
                    <Link key={a.slug} to={`/help/${a.slug}`}>
                      <Card className="p-5 hover:border-gold transition-colors h-full">
                        <div className="flex items-start gap-3">
                          <BookOpen className="w-4 h-4 text-gold mt-1 shrink-0" />
                          <div className="flex-1">
                            <h3 className="font-serif text-base mb-1">{a.title}</h3>
                            {a.summary && (
                              <p className="text-xs text-muted-foreground line-clamp-2">{a.summary}</p>
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
        <article className="max-w-3xl">
          <button
            onClick={() => navigate("/help")}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-gold mb-6"
          >
            <ChevronLeft className="w-3 h-3" /> ヘルプ一覧へ
          </button>
          <p className="eyebrow text-[10px] text-gold mb-2">— {current.category} —</p>
          <h2 className="font-serif text-3xl mb-3">{current.title}</h2>
          {current.summary && (
            <p className="text-sm text-muted-foreground mb-8">{current.summary}</p>
          )}
          <div className="prose prose-sm max-w-none">
            <ReactMarkdown>{current.body}</ReactMarkdown>
          </div>
        </article>
      )}
    </AppLayout>
  );
};

export default HelpCenter;
