import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { HelpCircle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Link } from "react-router-dom";

type Article = { slug: string; title: string; summary: string | null; body: string; category: string };

// ページヘッダーに置く「？このページの使い方」リンク
// 現在のルートに related_routes が紐づいた記事を取得して右からスライドで表示
const PageHelpButton = () => {
  const { pathname } = useLocation();
  const [articles, setArticles] = useState<Article[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("help_articles")
        .select("slug,title,summary,body,category")
        .eq("published", true)
        .contains("related_routes", [pathname])
        .order("sort_order");
      setArticles(data ?? []);
    })();
  }, [pathname]);

  if (articles.length === 0) return null;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <button className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-gold transition-colors">
          <HelpCircle className="w-3.5 h-3.5" />
          このページの使い方
        </button>
      </SheetTrigger>
      <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto">
        <SheetHeader className="mb-6">
          <p className="eyebrow text-[10px] text-gold mb-1">— Manual —</p>
          <SheetTitle className="font-serif text-2xl">このページの使い方</SheetTitle>
        </SheetHeader>
        <div className="space-y-8">
          {articles.map((a) => (
            <article key={a.slug}>
              <p className="eyebrow text-[10px] mb-1">{a.category}</p>
              <h3 className="font-serif text-lg mb-2">{a.title}</h3>
              {a.summary && <p className="text-sm text-muted-foreground mb-3">{a.summary}</p>}
              <div className="prose prose-sm max-w-none [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_h1]:font-serif [&_h2]:font-serif">
                <ReactMarkdown>{a.body}</ReactMarkdown>
              </div>
              <Link to={`/help/${a.slug}`} className="text-xs text-gold hover:underline mt-3 inline-block">
                › 全文をヘルプセンターで開く
              </Link>
            </article>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default PageHelpButton;
