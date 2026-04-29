
-- 重複削除（新しい trg_ プレフィックスを残し、古い名前を削除）
DROP TRIGGER IF EXISTS bookings_thank_you_trigger ON public.bookings;
DROP TRIGGER IF EXISTS trg_thank_you_on_complete ON public.bookings;
DROP TRIGGER IF EXISTS trg_bookings_updated ON public.bookings;
DROP TRIGGER IF EXISTS on_customer_created ON public.customers;
DROP TRIGGER IF EXISTS trg_customers_updated ON public.customers;
DROP TRIGGER IF EXISTS customer_message_templates_updated_at ON public.customer_message_templates;
DROP TRIGGER IF EXISTS update_incentives_updated_at ON public.incentives;
DROP TRIGGER IF EXISTS trg_menu_items_updated ON public.menu_items;
DROP TRIGGER IF EXISTS create_default_incentives_trigger ON public.profiles;
DROP TRIGGER IF EXISTS profiles_default_message_templates ON public.profiles;
DROP TRIGGER IF EXISTS profiles_ensure_slug ON public.profiles;
DROP TRIGGER IF EXISTS trg_profiles_updated ON public.profiles;
DROP TRIGGER IF EXISTS staff_default_schedule ON public.staff;
DROP TRIGGER IF EXISTS staff_updated_at ON public.staff;
DROP TRIGGER IF EXISTS staff_schedules_updated_at ON public.staff_schedules;
