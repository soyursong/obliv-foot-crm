-- ============================================================
-- T-20260702-foot-FOREIGN-SELFREG-FLOW-CONSENT-SPEC  [STAGE2 (a)+(b)+(c)]
--   foot.customers phone_dummy 1급 플래그 + is_dummy_phone() 판정함수(dopamine 정본 복제) + 드리프트-가드 트리거
-- SSOT: planner NEW-TASK MSG-20260709-175622-rk4d
--       + data-architect CONSULT-REPLY DA-20260709-foot-FOREIGN-SELFREG-PHONE-DUMMY-STAGE2
--         (Q1 GO `DUMMY-<randomUUID>` + Q2 A안(트리거파생) 택일. change-class=ADDITIVE,
--          대표게이트 면제, supervisor DDL-diff DB-GATE만.)
-- 작성: dev-foot / 2026-07-09
-- 롤백: 20260709120000_foot_customers_phone_dummy_add_trigger.rollback.sql
-- 게이트: supervisor DDL-diff DB-GATE. prod apply 금지 — DDL-diff sign-off 後 적용.
--
-- ── 목적 ──────────────────────────────────────────────────────────────────────
--   무전화 외국인 셀프접수 write-path(soyursong/foot-checkin)가 phone='DUMMY-<uuid>' 를 저장할 때,
--   phone_dummy(전화 아님) 를 phone 값에서 client-agnostic 하게 자동 파생(A안 = §68 line 77 strong form).
--   쓰기측(FE/EF/CSV/수동/미래 신규경로)이 phone_dummy 를 명시 set 할 필요 없음. 명시해도 트리거가 override.
--
-- ── 순서(DA 확정) ────────────────────────────────────────────────────────────
--   (a) 컬럼 ADD (NOT NULL DEFAULT false, IF NOT EXISTS 멱등). ADD 시점 全행 false.
--   (b) is_dummy_phone() IMMUTABLE — ⚠ dopamine.customers 정본과 문자 그대로 동일(4곳 동치·gap0).
--       predicate 무변경. legacy "000..." 편입 위한 확장 절대 금지(=§68 4곳 동시갱신 게이트=cross-fork blast).
--       + customers_set_phone_dummy() BEFORE INSERT/UPDATE OF phone 트리거.
--   (b') 멱등 backfill(dopamine 정본 step3 동형): phone_dummy := is_dummy_phone(phone). loss-zero(파생 플래그만).
--       ⚠ STAGE1 "drift 0" 정정 — dry-run 실측 진성 placeholder 2행('+821011111111','+821000000000') 존재.
--       phone 값 무변경(신규 파생컬럼 초기화=ADDITIVE). legacy "000..." CORRECTIVE(별도 스텝)와 무관.
--   (c) backfill 검증 DO 블록(dopamine 동형): phone_dummy IS DISTINCT FROM is_dummy_phone(phone) = 0 assert.
--
-- ── dopamine 정본 복제 근거(predicate 무변경 검증용) ────────────────────────────
--   is_dummy_phone() 본문 = tm-flow(dopamine) 정본과 문자 그대로 동일:
--     · 최종 canonical = 20260706130000_customers_is_dummy_phone_placeholder_ssot_variants.sql
--       (base 20260623183000 + 계약 §6-8-6 SSOT 4-변종 리터럴 확장분).
--   customers_set_phone_dummy() 트리거 함수 = 20260623183000 정본 문자 동일.
--   ⚠ foot 신규 판단·리스트 발명 0. legacy "000-"/"000"/"0" 는 predicate 에 미편입(별도 CORRECTIVE 로 정규화).
--
-- ── 가드레일(불변식) ──────────────────────────────────────────────────────────
--   · ADDITIVE: NOT NULL 승격 0(신규컬럼 DEFAULT only). 기존 컬럼·타 테이블·enum 무변경.
--   · foot.customers = LOCAL(글로벌 조인키 계약 불변, cross-CRM blast=0. convene 불요 — DA).
--   · 롤백 = DROP TRIGGER + DROP FUNCTION(2) + DROP COLUMN phone_dummy.
-- ============================================================

-- (a) 컬럼 ADD ─────────────────────────────────────────────────────────────────
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS phone_dummy BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.customers.phone_dummy IS
  'true=더미/placeholder/식별자(전화 아님). is_dummy_phone() 규칙 = dopamine 정본 4곳 동치(gap0). '
  'BEFORE INSERT/UPDATE OF phone 트리거가 phone 에서 자동 파생(쓰기측 set 불필요·명시해도 override). '
  '무전화 외국인 셀프접수 DUMMY-<uuid> 토큰 자동 분류. [FOREIGN-SELFREG STAGE2 20260702 / §68 line77]';

-- (b) 판정함수 — ⚠ dopamine 정본(20260706130000) 문자 그대로 복제. predicate 무변경 ───────────
--   isDummyPhone 단일 규칙(SQL): 빈값/NULL · 알려진 placeholder(정규형 2 + 계약 §6-8-6 SSOT 4-변종) ·
--   DUMMY- 자리표시자 · E.164 한국모바일 가입자번호 전부 동일숫자.
CREATE OR REPLACE FUNCTION public.is_dummy_phone(p_phone text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT
    p_phone IS NULL
    OR btrim(p_phone) = ''
    -- 알려진 placeholder(정규형) + 계약 §6-8-6 SSOT 4-변종 리터럴(정규화 우회 방어).
    --   [+821000000000, +82000000000] = 기존 정규형(무변경).
    --   [01000000000, 821000000000, 82100000000, 8201000000000] = §6-8-6 write-invariant 추가분.
    OR btrim(p_phone) IN (
      '+821000000000', '+82000000000',
      '01000000000', '821000000000', '82100000000', '8201000000000'
    )
    OR p_phone LIKE 'DUMMY-%'
    -- +82 + 캐리어(1[016789]) + 가입자(7~8자리). 가입자가 전부 동일숫자면 placeholder.
    OR btrim(p_phone) ~ '^\+82(1[016789])(\d)\2{6,7}$'
$$;

COMMENT ON FUNCTION public.is_dummy_phone(text) IS
  'phone 이 더미/placeholder(전화 아님)인지 판정. dopamine 정본(is_dummy_phone) 4곳 동치 복제(predicate 무변경). '
  'customers.phone_dummy 파생(트리거). 값-술어에 계약 §6-8-6 SSOT 4-변종 리터럴 포함(정규화 우회 방어). '
  '[FOREIGN-SELFREG STAGE2 20260702 / PHONE-DUMMY-WRITE-INVARIANT 20260706 / PHONEDUMMY-DRIFT 20260623]';

-- (b) 드리프트-가드 트리거 — dopamine 정본(20260623183000) 문자 동일 ──────────────────────────
CREATE OR REPLACE FUNCTION public.customers_set_phone_dummy()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- phone 이 SSOT. 명시값 무시하고 항상 파생(드리프트 0). UPDATE 는 phone 변경시에만 발화(아래 트리거 조건).
  NEW.phone_dummy := public.is_dummy_phone(NEW.phone);
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_customers_set_phone_dummy ON public.customers;
CREATE TRIGGER trg_customers_set_phone_dummy
  BEFORE INSERT OR UPDATE OF phone ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.customers_set_phone_dummy();

-- (b') 멱등 backfill — dopamine 정본 20260623183000 step(3) 동형. loss-zero(파생 플래그만 변경, phone 값 무변경) ──
--   ⚠ STAGE1(MSG-yrdc) findings 정정: "drift 0" 주장은 불완전했음(E.164 all-same-subscriber 정규형 누락).
--   2026-07-09 dry-run(BEGIN;ROLLBACK) 실측 = is_dummy_phone(phone)=true 인 기존행 2건:
--     · '+821011111111' (id 66c08e48…, 가입자 all-same → regex 매칭) = 진성 placeholder
--     · '+821000000000' (id 3488652f…, 정규형 리터럴+regex) = 진성 placeholder
--   둘 다 명백한 placeholder(실번호 아님) → canonical predicate 가 정확히 분류. phone_dummy 를 그 파생값으로 초기화.
--   ⚠ 이는 legacy "000..." 4행(별도 CORRECTIVE, phone 값 변경)과 무관 — 여기선 phone 값 미변경, 신규 파생컬럼 초기화(ADDITIVE)뿐.
--   predicate 무변경(dopamine 정본). planner FOLLOWUP 로 STAGE1 drift 정정 보고 동반.
UPDATE public.customers
   SET phone_dummy = true
 WHERE public.is_dummy_phone(phone)
   AND phone_dummy IS DISTINCT FROM true;   -- 멱등(재실행 무해)

NOTIFY pgrst, 'reload schema';

-- (c) backfill 검증 DO 블록(dopamine 동형) — 컬럼·함수·트리거 반영 + 드리프트 0 assert ──────────
--   ADD 시점 backfill 0(§54). 기존행은 트리거 소급 無 → 전부 phone_dummy=false 이고 is_dummy_phone(phone)=false
--   (DUMMY-%=0 / ''=0 / NULL=0 / legacy "000..." 는 predicate 미등재→false) → 드리프트 0 이 정상 통과값.
DO $$
DECLARE
  v_drift INT;
BEGIN
  PERFORM 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='customers' AND column_name='phone_dummy';
  IF NOT FOUND THEN RAISE EXCEPTION 'FOREIGN-SELFREG STAGE2 검증 실패: phone_dummy 컬럼 미생성'; END IF;

  PERFORM 1 FROM pg_trigger WHERE tgname='trg_customers_set_phone_dummy' AND NOT tgisinternal;
  IF NOT FOUND THEN RAISE EXCEPTION 'FOREIGN-SELFREG STAGE2 검증 실패: 드리프트-가드 트리거 미생성'; END IF;

  SELECT count(*) INTO v_drift
    FROM public.customers
   WHERE phone_dummy IS DISTINCT FROM public.is_dummy_phone(phone);
  IF v_drift > 0 THEN
    RAISE EXCEPTION 'FOREIGN-SELFREG STAGE2 검증 실패: 백필 후 드리프트 % 건(phone_dummy ≠ is_dummy_phone)', v_drift;
  END IF;

  RAISE NOTICE 'FOREIGN-SELFREG STAGE2 [a+b+c]: 컬럼+함수(dopamine 정본 복제)+트리거+정합 검증 통과(드리프트 0). legacy "000..." 4행 정규화=별도 CORRECTIVE 스텝.';
END $$;
