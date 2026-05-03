
ALTER TABLE public.help_articles
  ADD COLUMN IF NOT EXISTS cover_image_url text,
  ADD COLUMN IF NOT EXISTS video_url text,
  ADD COLUMN IF NOT EXISTS reading_minutes integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS related_slugs text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS helpful_yes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS helpful_no integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.help_article_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_slug text NOT NULL,
  user_id uuid NOT NULL,
  helpful boolean NOT NULL,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (article_slug, user_id)
);

ALTER TABLE public.help_article_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own help feedback"
  ON public.help_article_feedback FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "users write own help feedback"
  ON public.help_article_feedback FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "users update own help feedback"
  ON public.help_article_feedback FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.update_help_article_helpful_counts()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.helpful THEN
      UPDATE public.help_articles SET helpful_yes = helpful_yes + 1 WHERE slug = NEW.article_slug;
    ELSE
      UPDATE public.help_articles SET helpful_no = helpful_no + 1 WHERE slug = NEW.article_slug;
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.helpful <> NEW.helpful THEN
    IF NEW.helpful THEN
      UPDATE public.help_articles SET helpful_yes = helpful_yes + 1, helpful_no = GREATEST(helpful_no - 1, 0) WHERE slug = NEW.article_slug;
    ELSE
      UPDATE public.help_articles SET helpful_no = helpful_no + 1, helpful_yes = GREATEST(helpful_yes - 1, 0) WHERE slug = NEW.article_slug;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_help_feedback_counts ON public.help_article_feedback;
CREATE TRIGGER trg_help_feedback_counts
  AFTER INSERT OR UPDATE ON public.help_article_feedback
  FOR EACH ROW EXECUTE FUNCTION public.update_help_article_helpful_counts();

CREATE INDEX IF NOT EXISTS idx_help_articles_tags ON public.help_articles USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_help_articles_keywords ON public.help_articles USING GIN (keywords);
