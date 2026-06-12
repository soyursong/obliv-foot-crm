-- ============================================================
-- T-20260612-foot-KOH-REPORT-PHASE15 (A-1): 균검사지 발톱부위(KOH 검사부위)
-- ============================================================
-- 엔티티 식별(게이트 순서 1): KOH 검사 인스턴스(1검사=1행) = check_in_services 의 한 행.
--   Phase1 본체(T-20260611-foot-KOH-REPORT-TAB)는 check_in_services 를 read-only 로 집계하며,
--   KOH row 판정 = service_name ILIKE '%KOH%' OR '%진균검사%'(denormalized name SSOT).
--   → 발톱부위는 그 검사 행에 귀속되므로 check_in_services 에 koh_nail_sites 1컬럼 ADD.
--   ⚠ customers.nail_locations(환자 통증 자기보고)와 별개 — 재사용 금지(planner 명시).
--
-- 컬럼: koh_nail_sites jsonb NOT NULL DEFAULT '[]'::jsonb
--   원소 shape(closed enum 2축): {"side":"Rt"|"Lt","toe":1-5}.
--   DB엔 '구조만' 저장(표시문자열 'Rt 1지 조갑' 저장 금지 — FE 파생). status 필드 없음(drop 확정).
--   UI 단일 선택(R/L 1 + 발가락 1) → 길이 0 또는 1 배열. jsonb 배열 유지(forward-compat).
--
-- 쓰기 경로(write path) — 왜 RPC 인가:
--   check_in_services 의 UPDATE 는 현 RLS 상 admin/manager/consultant 만 허용
--   (coordinator/therapist/technician = SELECT only, 20260426 role_separation E.11).
--   본 기능 요구 = "치료사 접근 경로 우선, 누구나(승인 사용자) 입력 가능".
--   → check_in_services 의 가격(price 등) 쓰기 격리를 깨지 않으면서 koh_nail_sites '한 필드'만
--     승인 사용자에게 개방하기 위해 SECURITY DEFINER RPC(set_koh_nail_sites)를 둔다.
--     RPC 내부에서 is_approved_user() 게이트 + closed-enum shape 검증(구조만 저장 강제).
--   (테이블 RLS 를 넓히지 않음 → 가격/패키지 등 기존 쓰기 격리 회귀 0.)
--
-- 안전성:
--   · 컬럼 ADD 는 DEFAULT '[]' NOT NULL → 기존 행 즉시 백필(전부 빈배열), 신규 쓰기 무영향.
--   · RPC 1개만 신설 — 기존 테이블 RLS/정책 무변경(회귀 0).
--   · 과거 검사분 backfill 불가(검사 시점 입력 동선 부재) → 적용시점 이후만 채워짐(명단 과거분=빈값).
-- 롤백: 20260612160000_koh_nail_sites.rollback.sql (RPC DROP + 컬럼 DROP)
-- ⚠️ supervisor DB게이트(Gate3) 경유. 통과 후 dev-foot 직접 apply.
-- ============================================================

BEGIN;

-- ── A. 컬럼 ADD ──
ALTER TABLE check_in_services
  ADD COLUMN IF NOT EXISTS koh_nail_sites jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN check_in_services.koh_nail_sites IS
  '균검사지 발톱부위(KOH 검사부위). jsonb 배열, 원소 {side:Rt|Lt, toe:1-5}. UI 단일선택(길이 0|1). 표시문자열 저장 금지(구조만, FE 파생). status 없음. (T-20260612-foot-KOH-REPORT-PHASE15)';

-- ── B. 쓰기 RPC (승인 사용자 = 누구나 입력 가능, 한 필드만) ──
--   shape 검증: 배열 + 각 원소 {side ∈ (Rt,Lt), toe ∈ 1..5} 만 허용. 그 외 입력은 예외.
--   p_sites 가 빈 배열([])이면 선택 해제(미선택) — 허용(선택 항목, 강제 아님).
CREATE OR REPLACE FUNCTION set_koh_nail_sites(p_service_id uuid, p_sites jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  elem jsonb;
BEGIN
  -- 권한: 승인된 사용자 누구나(치료사 포함). 미승인은 차단.
  IF NOT is_approved_user() THEN
    RAISE EXCEPTION 'not authorized: koh_nail_sites write requires approved user'
      USING ERRCODE = '42501';
  END IF;

  -- 입력 정규화: NULL → 빈배열. 반드시 jsonb array.
  IF p_sites IS NULL THEN
    p_sites := '[]'::jsonb;
  END IF;
  IF jsonb_typeof(p_sites) <> 'array' THEN
    RAISE EXCEPTION 'koh_nail_sites must be a jsonb array';
  END IF;

  -- closed-enum shape 검증 — 구조만 저장 강제(표시문자열/잡필드 거부).
  FOR elem IN SELECT * FROM jsonb_array_elements(p_sites) LOOP
    IF jsonb_typeof(elem) <> 'object'
       OR NOT (elem ? 'side') OR NOT (elem ? 'toe')
       OR (elem->>'side') NOT IN ('Rt','Lt')
       OR (elem->>'toe') !~ '^[1-5]$' THEN
      RAISE EXCEPTION 'invalid koh_nail_sites element: %, expected {"side":"Rt"|"Lt","toe":1-5}', elem;
    END IF;
  END LOOP;

  -- 정규화 저장: side(text) + toe(int) 만 남겨 잡필드 제거(구조만 저장).
  UPDATE check_in_services
     SET koh_nail_sites = COALESCE((
           SELECT jsonb_agg(jsonb_build_object('side', e->>'side', 'toe', (e->>'toe')::int))
           FROM jsonb_array_elements(p_sites) AS e
         ), '[]'::jsonb)
   WHERE id = p_service_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'check_in_services row not found: %', p_service_id;
  END IF;

  RETURN (SELECT koh_nail_sites FROM check_in_services WHERE id = p_service_id);
END;
$$;

COMMENT ON FUNCTION set_koh_nail_sites(uuid, jsonb) IS
  '균검사지 발톱부위 쓰기(승인 사용자 누구나, 한 필드만). closed-enum 검증 + 구조만 저장. check_in_services UPDATE RLS(consultant+) 우회용 정의자 RPC. (T-20260612-foot-KOH-REPORT-PHASE15)';

REVOKE ALL ON FUNCTION set_koh_nail_sites(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_koh_nail_sites(uuid, jsonb) TO authenticated;

-- ── C. 검증 ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='check_in_services' AND column_name='koh_nail_sites'
  ) THEN RAISE EXCEPTION 'koh_nail_sites 컬럼 생성 실패'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'set_koh_nail_sites'
  ) THEN RAISE EXCEPTION 'set_koh_nail_sites RPC 생성 실패'; END IF;

  RAISE NOTICE 'T-20260612-foot-KOH-REPORT-PHASE15: koh_nail_sites 컬럼 + RPC 검증 통과';
END $$;

COMMIT;
