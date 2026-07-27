-- DRY-RUN (무영속) — T-20260727-foot-PMW-REFUND200-DOCUNPAID-2BUG 요건(1) FLOOR 정합 검증
--
-- 목적: (1) 산식 정정의 산술 근거를 결정적으로 assert(요건1 RC 재현+참값), (2) 마이그레이션 DDL 이
--       파싱/적용 가능함을 트랜잭션 내에서 확인한 뒤 ROLLBACK 하여 **영속 없이** 검증한다.
-- 실행: psql "$FOOT_DB_URL" -v ON_ERROR_STOP=1 -f 이 파일  (supervisor prod-preflight)
--       → 마지막 ROLLBACK 으로 함수 정의는 실제로 바뀌지 않는다(무영속). 실적용은 up.sql 로.
--
-- ⚠ No-Persistence: 본 파일에는 COMMIT 이 없다. 어떤 경로로도 함수를 영속 교체하지 않는다.

-- ── (1) 산식 assert: 요건1 케이스 base×0.30 = 8,812.5 ─────────────────────────
--   base = 29,375 (진료비 총액 269,375 중 급여 base 예시). ×0.30 = 8,812.5.
--   FLOOR(정정) = 8,800 (실 잠정청구·화면표시 정합) / CEIL(drift) = 8,900 (RC).
--   확정 본인부담 = 8,700 → 환불: FLOOR경로 100원(참값) vs CEIL경로 200원(오산정).
DO $assert$
DECLARE
  v_base        NUMERIC := 29375;
  v_confirmed   INTEGER := 8700;
  v_floor_prov  INTEGER := (FLOOR((29375 * 0.30) / 100.0) * 100)::INTEGER;  -- 8800
  v_ceil_prov   INTEGER := (CEIL ((29375 * 0.30) / 100.0) * 100)::INTEGER;  -- 8900
  v_floor_refund INTEGER;
  v_ceil_refund  INTEGER;
BEGIN
  v_floor_refund := GREATEST(0, v_floor_prov - v_confirmed);  -- 참값 100
  v_ceil_refund  := GREATEST(0, v_ceil_prov  - v_confirmed);  -- RC   200
  IF v_floor_prov <> 8800 THEN
    RAISE EXCEPTION 'DRYRUN FAIL: FLOOR 기징수 재구성 기대 8800, got %', v_floor_prov;
  END IF;
  IF v_ceil_prov <> 8900 THEN
    RAISE EXCEPTION 'DRYRUN FAIL: CEIL(drift) 재현 기대 8900, got %', v_ceil_prov;
  END IF;
  IF v_floor_refund <> 100 THEN
    RAISE EXCEPTION 'DRYRUN FAIL: FLOOR 경로 환불 참값 기대 100, got %', v_floor_refund;
  END IF;
  IF v_ceil_refund <> 200 THEN
    RAISE EXCEPTION 'DRYRUN FAIL: CEIL 경로 환불 RC 기대 200(오산정), got %', v_ceil_refund;
  END IF;
  RAISE NOTICE 'DRYRUN OK: base=% ×0.30=8812.5 → FLOOR기징수=% (환불 %원, 참값) vs CEIL기징수=% (환불 %원, RC). 정정=FLOOR.',
    v_base, v_floor_prov, v_floor_refund, v_ceil_prov, v_ceil_refund;
END $assert$;

-- ── (2) DDL 적용가능성 확인 (트랜잭션 내, 무영속) ────────────────────────────
BEGIN;
  \i 20260727213000_foot_resettle_provisional_floor_align.sql
  -- 적용 후 함수 정의에 FLOOR 가 실렸는지(CEIL 잔존 없는지) 검증
  DO $verify$
  DECLARE
    v_def TEXT;
  BEGIN
    SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'resettle_insurance_grade';
    IF v_def IS NULL THEN
      RAISE EXCEPTION 'DRYRUN FAIL: resettle_insurance_grade 함수 미존재';
    END IF;
    IF position('FLOOR((v_calc.base_amount * 0.30)' IN v_def) = 0 THEN
      RAISE EXCEPTION 'DRYRUN FAIL: 정정 함수에 FLOOR 재구성 라인 부재';
    END IF;
    IF position('CEIL((v_calc.base_amount * 0.30)' IN v_def) > 0 THEN
      RAISE EXCEPTION 'DRYRUN FAIL: CEIL(drift) 라인 잔존 — 정정 미반영';
    END IF;
    RAISE NOTICE 'DRYRUN OK: resettle_insurance_grade 정의에 FLOOR 재구성 반영·CEIL 제거 확인.';
  END $verify$;
ROLLBACK;  -- ★ 무영속: 함수 정의 실제 교체 없음. 실적용은 up.sql.
