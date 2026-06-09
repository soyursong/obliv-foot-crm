-- T-20260609-foot-SELFCHECKIN-LEADSRC-UI-VISITPATH (수정2 — 고객차트 방문경로 자동 연동)
--
-- 목적: 셀프접수 워크인 동선에서 선택한 유입경로를 고객차트 방문경로(대분류/소분류)로 자동 저장.
--   - 대분류  = customers.visit_route       = '워크인' 고정 (기존 enum/CHECK 그대로, 워크인 이미 허용)
--   - 소분류  = customers.visit_route_detail = 신규 컬럼 (자유 TEXT)
--
-- DB 설계 판단 (dev-foot, GO_WARN 핵심):
--   소분류는 자유 TEXT 컬럼으로 추가하고 **CHECK constraint 를 두지 않는다**.
--   사유: (1) 지인소개_{성함} 처럼 임의 문자열(성함 인라인)을 그대로 저장해야 함.
--        (2) enum/CHECK 를 쓰면 신규 소분류 값 추가 때마다 CHECK 동기화 필요(Lovable 정책) →
--            성함 인라인과 양립 불가 + 유지보수 사고원. 따라서 CHECK 미적용으로 sync 위험 자체를 제거.
--   소분류 코드 기준 enum 값(FE 매핑 SSOT):
--     SNS_인스타그램 / SNS_페이스북 / SNS_틱톡유튜브 / SNS_블로그카페
--     검색_네이버 / 검색_구글 / 지인소개_{성함}(또는 지인소개) / 제휴기타
--
-- 변경:
--   1. customers.visit_route_detail TEXT NULL 추가 (CHECK 없음)
--   2. fn_selfcheckin_update_personal_info — p_visit_route / p_visit_route_detail 파라미터 추가
--      (기존 7-arg DROP 후 9-arg 재생성 — PostgREST 오버로드 모호성 방지)
--   3. fn_selfcheckin_rrn_match — ⑤ 병합에 visit_route / visit_route_detail 추가
--      (RRN 자동매칭으로 임시 레코드가 데스크 레코드로 병합될 때 방문경로 유실 방지)
--
-- 롤백: 20260609234500_selfcheckin_visit_route_detail.rollback.sql
--
-- 적용 방법 (supervisor DB-gate 실행):
--   supabase db push --file supabase/migrations/20260609234500_selfcheckin_visit_route_detail.sql

BEGIN;

-- ─── 1. customers.visit_route_detail 추가 (소분류, 자유 TEXT — CHECK 미적용) ───
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS visit_route_detail TEXT;

COMMENT ON COLUMN public.customers.visit_route_detail IS
  'T-20260609-foot-SELFCHECKIN-LEADSRC-UI-VISITPATH: 방문경로 소분류(유입경로).'
  ' 자유 TEXT(CHECK 미적용) — 지인소개_{성함} 인라인 + enum 확장 자유.'
  ' 값 예: SNS_인스타그램 / 검색_네이버 / 지인소개_홍길동 / 제휴기타.';

-- ─── 2. fn_selfcheckin_update_personal_info — visit_route(_detail) 파라미터 추가 ───
-- 기존 7-arg 시그니처 제거 후 9-arg 재생성 (오버로드 모호성 방지).
DROP FUNCTION IF EXISTS public.fn_selfcheckin_update_personal_info(
  UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN
);

CREATE OR REPLACE FUNCTION public.fn_selfcheckin_update_personal_info(
  p_check_in_id       UUID,
  p_clinic_id         UUID,
  p_birth_date        TEXT     DEFAULT NULL,
  p_address           TEXT     DEFAULT NULL,
  p_address_detail    TEXT     DEFAULT NULL,
  p_privacy_consent   BOOLEAN  DEFAULT NULL,
  p_insurance_consent BOOLEAN  DEFAULT NULL,
  p_visit_route       TEXT     DEFAULT NULL,   -- T-20260609 신규: 방문경로 대분류('워크인')
  p_visit_route_detail TEXT    DEFAULT NULL    -- T-20260609 신규: 방문경로 소분류(유입경로)
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ci check_ins%ROWTYPE;
BEGIN
  -- check_in 존재 + clinic_id 일치 확인
  SELECT * INTO v_ci
  FROM   check_ins
  WHERE  id        = p_check_in_id
    AND  clinic_id = p_clinic_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'check_in_not_found');
  END IF;

  -- 30분 이내 생성된 체크인만 허용
  IF v_ci.checked_in_at < (now() - INTERVAL '30 minutes') THEN
    RETURN jsonb_build_object('success', false, 'error', 'too_old');
  END IF;

  -- customer_id 필수
  IF v_ci.customer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_customer_id');
  END IF;

  -- 고객 정보 업데이트 (NULL 파라미터는 기존 값 유지)
  -- AC-7: p_insurance_consent = true 일 때만 hira_consent 갱신 (false로 리셋 방지)
  -- T-20260609: visit_route/visit_route_detail COALESCE 갱신 (워크인 동선만 값 전달됨)
  UPDATE customers
  SET
    birth_date         = COALESCE(p_birth_date,        birth_date),
    address            = COALESCE(p_address,           address),
    address_detail     = COALESCE(p_address_detail,    address_detail),
    privacy_consent    = COALESCE(p_privacy_consent,   privacy_consent),
    visit_route        = COALESCE(p_visit_route,        visit_route),
    visit_route_detail = COALESCE(p_visit_route_detail, visit_route_detail),
    hira_consent       = CASE
                           WHEN p_insurance_consent = true THEN true
                           ELSE hira_consent
                         END,
    hira_consent_at    = CASE
                           WHEN p_insurance_consent = true THEN now()
                           ELSE hira_consent_at
                         END,
    updated_at         = now()
  WHERE id        = v_ci.customer_id
    AND clinic_id = p_clinic_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_selfcheckin_update_personal_info(
  UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT
) TO anon, authenticated;

COMMENT ON FUNCTION public.fn_selfcheckin_update_personal_info IS
  'T-20260529-foot-SELFCHECKIN-FLOW-REVAMP + T-20260609-foot-SELFCHECKIN-LEADSRC-UI-VISITPATH:'
  ' 초진 셀프접수 개인정보(생년월일·주소·동의·방문경로) 저장.'
  ' v3: p_visit_route(대분류)/p_visit_route_detail(소분류) 추가 — 워크인 유입경로 차트 연동.'
  ' anon SECURITY DEFINER — 30분 이내 check_in + clinic_id 이중 검증. 전체 RRN 비저장.';

-- ─── 3. fn_selfcheckin_rrn_match — ⑤ 병합에 visit_route(_detail) 추가 ───
-- 시그니처 불변 (UUID, UUID). 20260609230000(addr_sync) 위에 누적.
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
  v_self_bd        TEXT;
  v_self_cust_id   UUID;
  v_target_cust_id UUID;
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

  IF v_self_bd IS NULL OR length(v_self_bd) < 6 THEN
    RETURN jsonb_build_object('success', true, 'matched', false, 'reason', 'no_birth_date');
  END IF;

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

  IF v_target_cust_id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'matched', false);
  END IF;

  -- ④ 현재 check_in 의 customer_id 를 기존 고객으로 교체
  UPDATE check_ins
  SET    customer_id = v_target_cust_id
  WHERE  id = p_check_in_id;

  -- ⑤ 기존 고객 레코드에 selfcheckin 에서 수집한 최신 데이터 병합
  --    T-20260609-foot-SELFREG-ADDR-SYNC: postal_code/address_detail 병합.
  --    T-20260609-foot-SELFCHECKIN-LEADSRC-UI-VISITPATH: visit_route/visit_route_detail 병합 추가.
  --    COALESCE — src(셀프접수) 빈 입력 시 dest(기존) 값 유지(덮어쓰기 방지).
  UPDATE customers dest
  SET
    birth_date         = COALESCE(src.birth_date,         dest.birth_date),
    address            = COALESCE(src.address,            dest.address),
    postal_code        = COALESCE(src.postal_code,        dest.postal_code),
    address_detail     = COALESCE(src.address_detail,     dest.address_detail),
    visit_route        = COALESCE(src.visit_route,        dest.visit_route),
    visit_route_detail = COALESCE(src.visit_route_detail, dest.visit_route_detail),
    hira_consent    = CASE WHEN src.hira_consent = true THEN true ELSE dest.hira_consent END,
    hira_consent_at = CASE WHEN src.hira_consent = true AND dest.hira_consent IS DISTINCT FROM true
                            THEN src.hira_consent_at
                           ELSE dest.hira_consent_at
                      END,
    updated_at      = now()
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
  'T-20260529 AC-9 + T-20260609 SELFREG-ADDR-SYNC + LEADSRC-UI-VISITPATH: 셀프접수 주민번호 자동 매칭.'
  ' birth_date(앞6자리)+당일 check_in 으로 데스크 레코드 병합.'
  ' 병합 시 address/postal_code/address_detail/visit_route/visit_route_detail 이관(COALESCE).'
  ' anon SECURITY DEFINER — 30분 이내 check_in + clinic_id 이중 검증.';

COMMIT;
