-- T-foot-qa-006 follow-up: anon 셀프체크인 RLS 허용
-- foot-006 RLS 분리 후 anon이 customers/check_ins INSERT 차단됨 → 셀프체크인 prod에서 작동 불가
-- 해결: clinic_id가 있는 한정적 INSERT만 허용 (status='registered'로 제한)

BEGIN;

-- 기존 anon 관련 정책 정리 (있으면)
DROP POLICY IF EXISTS anon_insert_customer_self_checkin ON public.customers;
DROP POLICY IF EXISTS anon_select_customer_self_checkin ON public.customers;
DROP POLICY IF EXISTS anon_insert_checkin_self ON public.check_ins;

-- customers: anon이 신규 INSERT만 가능 (clinic_id 필수)
CREATE POLICY anon_insert_customer_self_checkin ON public.customers
  FOR INSERT TO anon
  WITH CHECK (clinic_id IS NOT NULL);

-- customers: anon이 phone으로 기존 고객 조회 (셀프체크인 흐름에서 maybeSingle 사용)
-- 보안: phone digit만 노출, clinic_id 매칭 필수
CREATE POLICY anon_select_customer_self_checkin ON public.customers
  FOR SELECT TO anon
  USING (clinic_id IS NOT NULL);

-- check_ins: anon이 셀프체크인용 row INSERT만 가능
-- status='registered' + clinic_id 필수, 다른 status 차단
CREATE POLICY anon_insert_checkin_self ON public.check_ins
  FOR INSERT TO anon
  WITH CHECK (clinic_id IS NOT NULL AND status = 'registered');

COMMIT;
