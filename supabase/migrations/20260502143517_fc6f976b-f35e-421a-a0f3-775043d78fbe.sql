ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS notification_recipients jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.profiles.notification_recipients IS 
'予約通知先リスト: [{name, email, line_user_id, channels: ["email","line"]}]';