-- T-20260611-foot-SELFCHECKIN-CONSENT-ADDR-NOTSAVED (merge-path 보강 / DB-gate: supervisor 실행)
--
-- 배경 (planner Explore value-add 후보 A, dev-foot 라이브 확인 결과):
--   본 티켓 1차 근인은 write-path(fn_selfcheckin_update_personal_info 시그니처 불일치)이며
--   20260611100000_selfcheckin_personal_info_consolidate.sql 로 이미 해소됨(DB-gate 대기).
--
--   본 마이그는 그와 별개인 merge-path 잠재 결함(A) 을 보강한다:
--     병합 RPC fn_selfcheckin_rrn_match 의 ⑤병합 UPDATE 가 birth_date/address/postal_code/
--     address_detail/hira_consent 만 데스크 레코드(dest)로 이관하고, 셀프접수 임시레코드(src)가
--     수집한 privacy_consent(+at) / sms_opt_in(+at) 은 누락 → 병합 발동(2레코드 시나리오) 시
--     임시레코드 DELETE(⑥) 과정에서 개인정보·문자 수신 동의가 유실됨.
--
--   ※ planner 후보 B("RRN-FIELD-REMOVE 로 birth_date 항상 NULL → 병합 미발동") 는 obliv-foot-crm
--     에는 미적용. FE(SelfCheckIn.tsx L1240/L1510)는 RRN 입력값에서 extractBirthDate 로
--     birth_date 를 여전히 저장하므로 병합 게이트(L63)는 정상 통과 가능. 따라서 birth_date 의존
--     게이트는 손대지 않으며, RRN 재추가(T-20260606 충돌)도 하지 않는다. 병합키 birth_date 불변.
--
-- 변경: public.fn_selfcheckin_rrn_match — ⑤병합 UPDATE 에 동의 4컬럼 이관 추가.
--   - privacy_consent : src=true 우선(동의 다운그레이드 방지), 그 외 dest 유지 (hira 패턴과 동일)
--   - privacy_consent_at : src 신규 동의 시각 이관, 기존 동의 유지
--   - sms_opt_in : src=true 우선, 그 외 dest 유지
--   - sms_opt_in_at : src 신규 동의 시각 이관, 기존 동의 유지
--   시그니처(UUID,UUID) 불변. 신규 컬럼 추가 없음(기존 컬럼만 set-list 확장) → 데이터계약 비변경.
--
-- 방어: 동의 4컬럼이 미적용(20260602190000/20260611100000 partial)인 환경 대비 idempotent ADD COLUMN.
--       (정상 순서에서는 no-op)
--
-- 백필: 없음 — 과거 병합으로 이미 유실된 동의는 소급 불가(scope 제외).
--
-- 롤백: 20260611140000_selfcheckin_rrn_match_consent_sync.rollback.sql
--       (20260609230000 버전 = 동의 이관 이전으로 복원)
--
-- 적용 방법 (supervisor DB-gate 실행):
--   supabase db push --file supabase/migrations/20260611140000_selfcheckin_rrn_match_consent_sync.sql

BEGIN;

-- ─── 0. 동의 컬럼 방어 (idempotent — partial-apply 환경 대비, 정상 순서에선 no-op) ───
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS privacy_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS sms_opt_in_at      timestamptz;

CREATE OR REPLACE FUNCTION public.fn_selfcheckin_rrn_match(
  p_check_in_id  UUID,
  p_clinic_id    UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ci             check_ins%ROWTYPE;
  v_self_bd        TEXT;             -- selfcheckin 고객의 birth_date
  v_self_cust_id   UUID;
  v_target_cust_id UUID;             -- 매칭된 기존 고객 ID
  v_today          DATE;
BEGIN
  -- ① 현재 check_in 조회 + 보안 검증
  SELECT * INTO v_ci
  FROM   check_ins
  WHERE  id        = p_check_in_id
    AND  clinic_id = p_clinic_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'check_in_not_found');
  END IF;

  IF v_ci.checked_in_at < (now() - INTERVAL '30 minutes') THEN
    RETURN jsonb_build_object('success', false, 'error', 'too_old');
  END IF;

  IF v_ci.customer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_customer_id');
  END IF;

  v_self_cust_id := v_ci.customer_id;

  -- ② 셀프접수 고객의 birth_date 조회
  SELECT birth_date INTO v_self_bd
  FROM   customers
  WHERE  id = v_self_cust_id;

  -- birth_date 미입력이면 매칭 불가 (병합키 불변 — RRN 재추가 금지, B 후보 미적용)
  IF v_self_bd IS NULL OR length(v_self_bd) < 6 THEN
    RETURN jsonb_build_object('success', true, 'matched', false, 'reason', 'no_birth_date');
  END IF;

  -- 오늘 날짜 (Asia/Seoul)
  v_today := (now() AT TIME ZONE 'Asia/Seoul')::DATE;

  -- ③ 동일 birth_date + 당일 체크인 + 다른 고객 검색 (먼저 생성된 순)
  SELECT c.id INTO v_target_cust_id
  FROM   customers c
  JOIN   check_ins ci ON ci.customer_id = c.id
  WHERE  c.clinic_id  = p_clinic_id
    AND  c.id        <> v_self_cust_id
    AND  c.birth_date = v_self_bd
    AND  (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::DATE = v_today
    AND  ci.status   <> 'cancelled'
  ORDER BY c.created_at ASC
  LIMIT 1;

  -- 매칭 없으면 그대로 반환
  IF v_target_cust_id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'matched', false);
  END IF;

  -- ④ 현재 check_in 의 customer_id 를 기존 고객으로 교체
  UPDATE check_ins
  SET    customer_id = v_target_cust_id
  WHERE  id = p_check_in_id;

  -- ⑤ 기존 고객 레코드에 selfcheckin 에서 수집한 최신 데이터 병합
  --    address/postal_code/address_detail : COALESCE — src 빈 입력 시 dest 유지(덮어쓰기 방지)
  --    hira_consent/privacy_consent/sms_opt_in : src=true 우선(동의 다운그레이드 방지),
  --      신규 동의 시각(_at) 이관. (T-20260611 CONSENT-ADDR-NOTSAVED merge-path 보강 A)
  UPDATE customers dest
  SET
    birth_date         = COALESCE(src.birth_date,      dest.birth_date),
    address            = COALESCE(src.address,         dest.address),
    postal_code        = COALESCE(src.postal_code,     dest.postal_code),
    address_detail     = COALESCE(src.address_detail,  dest.address_detail),
    hira_consent       = CASE WHEN src.hira_consent = true THEN true ELSE dest.hira_consent END,
    hira_consent_at    = CASE WHEN src.hira_consent = true AND dest.hira_consent IS DISTINCT FROM true
                              THEN src.hira_consent_at
                             ELSE dest.hira_consent_at
                        END,
    privacy_consent    = CASE WHEN src.privacy_consent = true THEN true ELSE dest.privacy_consent END,
    privacy_consent_at = CASE WHEN src.privacy_consent = true AND dest.privacy_consent IS DISTINCT FROM true
                              THEN src.privacy_consent_at
                             ELSE dest.privacy_consent_at
                        END,
    sms_opt_in         = CASE WHEN src.sms_opt_in = true THEN true ELSE dest.sms_opt_in END,
    sms_opt_in_at      = CASE WHEN src.sms_opt_in = true AND dest.sms_opt_in IS DISTINCT FROM true
                              THEN src.sms_opt_in_at
                             ELSE dest.sms_opt_in_at
                        END,
    updated_at         = now()
  FROM customers src
  WHERE dest.id   = v_target_cust_id
    AND src.id    = v_self_cust_id;

  -- ⑥ selfcheckin 으로 생성된 임시 고객 레코드 정리 (check_in 이 없으면 삭제)
  IF NOT EXISTS (
    SELECT 1 FROM check_ins WHERE customer_id = v_self_cust_id AND id <> p_check_in_id
  ) THEN
    DELETE FROM customers WHERE id = v_self_cust_id AND clinic_id = p_clinic_id;
  END IF;

  RETURN jsonb_build_object(
    'success',               true,
    'matched',               true,
    'merged_to_customer_id', v_target_cust_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_selfcheckin_rrn_match(UUID, UUID)
  TO anon, authenticated;

COMMENT ON FUNCTION public.fn_selfcheckin_rrn_match IS
  'T-20260529-FLOW-REVAMP AC-9 + T-20260609-SELFREG-ADDR-SYNC + T-20260611-CONSENT-ADDR-NOTSAVED(merge-path): '
  '셀프접수 주민번호 자동 매칭. birth_date(앞6자리)+당일 check_in 으로 데스크 레코드와 병합. '
  '병합 시 address/postal_code/address_detail(COALESCE) + hira/privacy/sms 동의(true 우선, _at 이관) 전부 이관. '
  'anon SECURITY DEFINER — 30분 이내 check_in + clinic_id 이중 검증.';

COMMIT;
