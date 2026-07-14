-- T-20260715-foot-MASKPII-TABLE-TRIGGER-DURABLE — 마스킹 PII write-path 정본 폐쇄 (durable fix)
-- ════════════════════════════════════════════════════════════════════════════
-- 문제(재발): per-RPC 마스킹-reject 가드가 포렌식 심화마다 문이 늘어나 불변식을 bound 못함
--   (8→4→11 anon customers-write, RESCOPE apply 8h 後 신규 masked customer e3216e83 재유입).
-- 정본: 데이터가 사는 곳(customers 테이블)에서 강제 → BEFORE INSERT OR UPDATE 트리거 한 곳으로
--   현재 11 INSERT경로 + 미래 전경로 + UPDATE 4경로(update_personal_info / save_customer_address /
--   complete_prescreen_checklist / rrn_match)를 동시 폐쇄. per-RPC 가드(CLOSE-R2 계열)는
--   door-level defense-in-depth 로 잔존(제거 X).
--
-- DA decision 근거: da_decision_foot_maskreject_writepath_rescope_20260715.md (Durable fix 섹션).
--   · 旣GO helper `_fn_is_masked_pii(name, phone)` 재사용 — 신규 predicate 0, 신규 컬럼/enum/테이블 0.
--   · UPDATE 4경로 = 본 trigger 로 흡수. 별도 per-RPC 4가드/4티켓 신설 금지(DA 지시·중복방지).
--   · trigger 는 customers.name/phone **최종값(NEW)** 만 검사 → rrn_match(masked RRN 을 비교 입력으로만
--     받고 name/phone 은 raw persist) 자연 면제.
--
-- ── UPDATE unchanged-short-circuit (false-positive 회귀0 보장) ──────────────────
--   착지 前 감사(fp_audit, READ-ONLY prod): 기존 customers 353행 중 9행이 helper flagged
--     (name_star 7행 = e3216e83-type 마스킹 오염 / phone_short 2행 = phone 유효자릿수 4).
--   pure-NEW 트리거는 이 9행의 **무관 필드 UPDATE**(주소/방문정보 등)도 NEW.name/phone 이 여전히
--   flagged → 전면 차단 = false-positive 회귀. 이를 막고 write-time 불변식만 강제하기 위해:
--     UPDATE 이면서 name·phone 이 **양축 모두 미변경**이면 재검사 면제(grandfathered 값 재-reject 방지).
--   → SET-to-masked(정상행을 masked 로 덮는 corruption) 은 여전히 차단 / masked→raw 정정도 통과 /
--     grandfathered 9행의 무관 UPDATE 는 통과 = 회귀0. INSERT 는 항상 전수 검사.
--   ※ 본 규약(판정항 3: UPDATE NEW 최종값 규약)은 DA CONSULT 판정 대상 — apply 는 CONSULT-REPLY GO 후.
--
-- 분류/게이트: ADDITIVE(신규 트리거 함수 + 트리거 · 스키마/컬럼/enum 무변경).
--   1차게이트 = DA blast-radius CONSULT(apply 前 의무). §S2.4 = CONSULT-REPLY GO 前 apply·deploy-ready 금지.
--   §3.1 대표게이트 = ADDITIVE + false-positive 회귀0 실증 시 면제 → supervisor DDL-diff(pg_proc/pg_trigger) 단일게이트.
--   롤백 = 20260715130000_..._table_trigger.rollback.sql (트리거 + 함수 DROP).
-- author: dev-foot / 2026-07-15 · ticket: T-20260715-foot-MASKPII-TABLE-TRIGGER-DURABLE
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1) 트리거 함수 — customers 마스킹-PII fail-closed reject (旣GO helper 재사용)
--    PHI 위생: 에러 메시지에 raw name/phone 값 미노출(축 표시만). 로그 유출 방지.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._trg_customers_reject_masked_pii()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  -- UPDATE 이면서 name·phone 양축 미변경 → grandfathered 값 재검사 면제(false-positive 회귀0).
  IF TG_OP = 'UPDATE'
     AND NEW.name  IS NOT DISTINCT FROM OLD.name
     AND NEW.phone IS NOT DISTINCT FROM OLD.phone THEN
    RETURN NEW;
  END IF;

  IF public._fn_is_masked_pii(NEW.name, NEW.phone) THEN
    RAISE EXCEPTION 'customers 마스킹-PII persist 거부: name/phone 은 raw 값이어야 함(마스킹값 저장 금지)'
      USING ERRCODE = '22023',
            HINT = 'T-20260715-foot-MASKPII-TABLE-TRIGGER-DURABLE / _fn_is_masked_pii: '
                   'name(* 포함) 또는 phone(* 포함 OR 유효자릿수 1~7) 감지. 원본 PII 로 write 하세요.';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public._trg_customers_reject_masked_pii() IS
  'T-20260715-foot-MASKPII-TABLE-TRIGGER-DURABLE / DA durable-fix: customers BEFORE INSERT OR UPDATE '
  '트리거 함수. 旣GO _fn_is_masked_pii(NEW.name,NEW.phone) fail-closed RAISE 22023. write-path 정본 폐쇄 '
  '(11 INSERT + 미래 전경로 + UPDATE 4경로). UPDATE name/phone 미변경 시 재검사 면제(grandfathered 회귀0). '
  'per-RPC 가드는 door-level defense-in-depth 로 잔존. 에러 메시지 raw PII 미노출.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2) 트리거 부착 — BEFORE INSERT OR UPDATE, FOR EACH ROW
--    (재적용 안전: 동명 트리거 선제 DROP)
-- ────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_customers_reject_masked_pii ON public.customers;
CREATE TRIGGER trg_customers_reject_masked_pii
  BEFORE INSERT OR UPDATE ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public._trg_customers_reject_masked_pii();

COMMIT;
