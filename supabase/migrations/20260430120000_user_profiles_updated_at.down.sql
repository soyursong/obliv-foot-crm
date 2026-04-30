-- 롤백: updated_at 컬럼 및 트리거 제거
DROP TRIGGER IF EXISTS trg_updated_at ON public.user_profiles;
ALTER TABLE public.user_profiles DROP COLUMN IF EXISTS updated_at;
ALTER TABLE public.daily_closings DROP COLUMN IF EXISTS updated_at;
ALTER TABLE public.consent_templates DROP COLUMN IF EXISTS updated_at;
ALTER TABLE public.staff DROP COLUMN IF EXISTS updated_at;
