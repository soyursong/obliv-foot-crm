-- T-20260713-foot-PHONE-E164-CHK-UNENFORCED — Step1: phone_e164 CHECK 식 재정의 + NOT VALID 재add
-- ============================================================================
-- 근본원인(DA CONSULT-REPLY MSG-20260713-191341-tq7f): 기존 식의 음성가드
--   `phone !~ '^\+?82?0?1[016789]'` 에서 `82?` = 리터럴 '8' + 옵션 '2' (≠ "82 옵션").
--   → 가드가 '8' 로 시작하는 값만 매치. 한국 로컬표기(010…/하이픈)는 '0' 로 시작 →
--     `!~` = TRUE → 3번째 분기 통과 → 전량 프리패스(enforcement 무효화). NOT VALID 문제 아님.
-- 정답: 올바른 화이트리스트 식으로 DROP + re-ADD **NOT VALID**.
--   allow = NULL / KR E.164 / DUMMY-% / placeholder / 국제환자 해외 E.164
--   reject = 로컬표기(010…) · 하이픈 · 그 외 비-E.164
-- NOT VALID: 기존 오염행(cust 21 · resv 98)은 블록 안 함(무변경). 신규 나쁜 쓰기만 즉시 거부.
--   → 오염 정정 백필/VALIDATE 는 별 티켓(T-20260713-foot-PHONE-E164-BACKFILL-VALIDATE, Step3).
-- ⚠ apply 전제: 국제환자 해외 E.164 허용 1줄(`^\+(?!82)[1-9]\d{6,14}$`)은 DA-final 예측식 pin 후.
--   (너무 엄격하면 정상 외국인 쓰기 오거부 — §78/§80 foot foreign self-checkin) build/dry-run/rollback 은 선행 OK.
-- 멱등: DROP CONSTRAINT IF EXISTS → 재실행 시 drop 후 재add 로 수렴.
-- 게이트: 대표 게이트 면제(데이터 무변경·enforcement-forward·원장 무접점). supervisor DDL-diff.
-- ============================================================================

BEGIN;

-- customers.phone
ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_phone_e164_chk;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_phone_e164_chk
  CHECK (
    phone IS NULL
    OR phone ~ '^\+82(1[016789]\d{7,8})$'   -- KR E.164 (모바일)
    OR phone LIKE 'DUMMY-%'                   -- DUMMY placeholder
    OR phone = '+821000000000'                -- 고정 placeholder
    OR phone ~ '^\+(?!82)[1-9]\d{6,14}$'      -- 국제환자 해외 E.164 (비-82, DA-final pin 대상)
  )
  NOT VALID;

-- reservations.customer_phone
ALTER TABLE public.reservations
  DROP CONSTRAINT IF EXISTS reservations_customer_phone_e164_chk;
ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_customer_phone_e164_chk
  CHECK (
    customer_phone IS NULL
    OR customer_phone ~ '^\+82(1[016789]\d{7,8})$'
    OR customer_phone LIKE 'DUMMY-%'
    OR customer_phone = '+821000000000'
    OR customer_phone ~ '^\+(?!82)[1-9]\d{6,14}$'
  )
  NOT VALID;

COMMIT;

-- 사후 검증(오토커밋):
--   SELECT conname, pg_get_constraintdef(oid), convalidated FROM pg_constraint
--     WHERE conname IN ('customers_phone_e164_chk','reservations_customer_phone_e164_chk');
--   → 새 식 · convalidated=false(NOT VALID) 기대.
--   신규 나쁜 쓰기 거부 확인: INSERT ... phone='01012345678' → check_violation 기대.
--   기존 오염행 무변경: SELECT count(*) ... phone !~ E.164 → cust 21 / resv 98 유지 기대.
