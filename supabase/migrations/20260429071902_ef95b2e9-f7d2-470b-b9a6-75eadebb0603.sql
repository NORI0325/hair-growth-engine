
-- profiles
DROP TRIGGER IF EXISTS trg_ensure_public_slug ON public.profiles;
CREATE TRIGGER trg_ensure_public_slug
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.ensure_public_slug();

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_create_default_coupons ON public.profiles;
CREATE TRIGGER trg_create_default_coupons
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.create_default_coupons();

DROP TRIGGER IF EXISTS trg_create_default_incentives ON public.profiles;
CREATE TRIGGER trg_create_default_incentives
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.create_default_incentives();

DROP TRIGGER IF EXISTS trg_create_default_message_templates ON public.profiles;
CREATE TRIGGER trg_create_default_message_templates
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.create_default_message_templates();

-- auth.users → handle_new_user (must be on auth schema)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- customers
DROP TRIGGER IF EXISTS trg_create_customer_token ON public.customers;
CREATE TRIGGER trg_create_customer_token
  AFTER INSERT ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.create_customer_token();

DROP TRIGGER IF EXISTS trg_customers_updated_at ON public.customers;
CREATE TRIGGER trg_customers_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- bookings: schedule reminder on insert
DROP TRIGGER IF EXISTS trg_schedule_reminder ON public.bookings;
CREATE TRIGGER trg_schedule_reminder
  AFTER INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.schedule_reminder_on_booking();

-- bookings: thank-you / aftercare / next / review on completed
DROP TRIGGER IF EXISTS trg_schedule_thank_you ON public.bookings;
CREATE TRIGGER trg_schedule_thank_you
  AFTER UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.schedule_thank_you_on_complete();

-- bookings: cancel reminder on cancel/no_show
DROP TRIGGER IF EXISTS trg_cancel_reminder ON public.bookings;
CREATE TRIGGER trg_cancel_reminder
  AFTER UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.cancel_reminder_on_status_change();

DROP TRIGGER IF EXISTS trg_bookings_updated_at ON public.bookings;
CREATE TRIGGER trg_bookings_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- staff: default schedule
DROP TRIGGER IF EXISTS trg_create_default_staff_schedule ON public.staff;
CREATE TRIGGER trg_create_default_staff_schedule
  AFTER INSERT ON public.staff
  FOR EACH ROW EXECUTE FUNCTION public.create_default_staff_schedule();

DROP TRIGGER IF EXISTS trg_staff_updated_at ON public.staff;
CREATE TRIGGER trg_staff_updated_at
  BEFORE UPDATE ON public.staff
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- staff_schedules / menu_items / coupons / templates updated_at
DROP TRIGGER IF EXISTS trg_staff_schedules_updated_at ON public.staff_schedules;
CREATE TRIGGER trg_staff_schedules_updated_at
  BEFORE UPDATE ON public.staff_schedules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_menu_items_updated_at ON public.menu_items;
CREATE TRIGGER trg_menu_items_updated_at
  BEFORE UPDATE ON public.menu_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_incentives_updated_at ON public.incentives;
CREATE TRIGGER trg_incentives_updated_at
  BEFORE UPDATE ON public.incentives
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_template_overrides_updated_at ON public.template_overrides;
CREATE TRIGGER trg_template_overrides_updated_at
  BEFORE UPDATE ON public.template_overrides
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_line_templates_updated_at ON public.line_templates;
CREATE TRIGGER trg_line_templates_updated_at
  BEFORE UPDATE ON public.line_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_customer_message_templates_updated_at ON public.customer_message_templates;
CREATE TRIGGER trg_customer_message_templates_updated_at
  BEFORE UPDATE ON public.customer_message_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
