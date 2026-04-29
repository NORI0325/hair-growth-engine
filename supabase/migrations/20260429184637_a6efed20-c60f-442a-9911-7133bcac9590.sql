
DO $$
DECLARE
  base TEXT := 'https://miyedioemkzhetphjzzg.supabase.co/storage/v1/object/public/menu-images/_defaults/';
BEGIN
  -- 順序が重要：より具体的なものを先に判定
  UPDATE public.menu_items SET image_url = base || 'kids.jpg'
    WHERE image_url IS NULL AND name ~ 'キッズ|子供|こども';

  UPDATE public.menu_items SET image_url = base || 'mens.jpg'
    WHERE image_url IS NULL AND name ~ 'メンズ|男性';

  UPDATE public.menu_items SET image_url = base || 'kimono.jpg'
    WHERE image_url IS NULL AND name ~ '着付|振袖|訪問着|袴';

  UPDATE public.menu_items SET image_url = base || 'hairset.jpg'
    WHERE image_url IS NULL AND name ~ 'セット|アップ|パーティ|イベント|ブライダル|結婚';

  UPDATE public.menu_items SET image_url = base || 'eyebrow.jpg'
    WHERE image_url IS NULL AND name ~ '眉|アイブロウ';

  UPDATE public.menu_items SET image_url = base || 'spa.jpg'
    WHERE image_url IS NULL AND name ~ 'スパ|ヘッドスパ|マッサージ';

  UPDATE public.menu_items SET image_url = base || 'treatment.jpg'
    WHERE image_url IS NULL AND name ~ 'トリートメント|艶|ケア';

  UPDATE public.menu_items SET image_url = base || 'straight.jpg'
    WHERE image_url IS NULL AND name ~ '縮毛|ストレート|矯正';

  UPDATE public.menu_items SET image_url = base || 'perm.jpg'
    WHERE image_url IS NULL AND name ~ 'パーマ';

  UPDATE public.menu_items SET image_url = base || 'highlight.jpg'
    WHERE image_url IS NULL AND name ~ 'ハイライト|ブリーチ|バレイヤージュ';

  UPDATE public.menu_items SET image_url = base || 'color.jpg'
    WHERE image_url IS NULL AND name ~ 'カラー|染め|リタッチ|イルミナ';

  UPDATE public.menu_items SET image_url = base || 'shampoo.jpg'
    WHERE image_url IS NULL AND name ~ 'シャンプー|ブロー|ドライ';

  UPDATE public.menu_items SET image_url = base || 'cut.jpg'
    WHERE image_url IS NULL AND name ~ 'カット|前髪';

  -- それ以外はデフォルトとしてカット画像
  UPDATE public.menu_items SET image_url = base || 'cut.jpg'
    WHERE image_url IS NULL;
END $$;
